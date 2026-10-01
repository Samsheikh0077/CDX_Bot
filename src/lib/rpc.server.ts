import {
  createPublicClient,
  http,
  isAddress,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";
import {
  ADDRESSES,
  CHAINLINK_ABI,
  ERC20_ABI,
  FACTORY_V2_ABI,
  FACTORY_V3_ABI,
  PUBLIC_RPCS,
  QUOTER_V2_ABI,
  ROUTER_V2_ABI,
  V3_FEE_TIERS,
  ZERO_ADDRESS,
} from "./chain";

const clients = new Map<string, PublicClient>();

function clientFor(rpcUrl: string): PublicClient {
  const existing = clients.get(rpcUrl);
  if (existing) return existing;
  const client = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl, { timeout: 12_000, retryCount: 1 }),
  });
  clients.set(rpcUrl, client);
  return client;
}

export async function connectClient(preferred?: string): Promise<{
  client: PublicClient;
  rpcUsed: string;
}> {
  const ordered = [
    ...(preferred ? [preferred] : []),
    ...PUBLIC_RPCS.filter((url) => url !== preferred),
  ];
  let lastError: unknown;
  for (const url of ordered) {
    try {
      const client = clientFor(url);
      await client.getBlockNumber();
      return { client, rpcUsed: url };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `All Ethereum RPCs failed${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

export async function readEthUsd(client: PublicClient): Promise<{
  price: number;
  updatedAt: number;
}> {
  const [round, decimals] = await Promise.all([
    client.readContract({
      address: ADDRESSES.chainlinkEthUsd,
      abi: CHAINLINK_ABI,
      functionName: "latestRoundData",
    }),
    client.readContract({
      address: ADDRESSES.chainlinkEthUsd,
      abi: CHAINLINK_ABI,
      functionName: "decimals",
    }),
  ]);
  const answer = round[1];
  const updatedAt = Number(round[3]) * 1000;
  const price = Number(answer) / 10 ** Number(decimals);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Chainlink ETH/USD returned an invalid price");
  }
  return { price, updatedAt };
}

export async function readTokenMeta(
  client: PublicClient,
  token: `0x${string}`,
): Promise<{ symbol: string; decimals: number; name: string }> {
  const [symbol, decimals, name] = await Promise.all([
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
    client
      .readContract({ address: token, abi: ERC20_ABI, functionName: "name" })
      .catch(() => "Token"),
  ]);
  return { symbol, decimals: Number(decimals), name };
}

export async function readV2Pair(
  client: PublicClient,
  token: `0x${string}`,
): Promise<`0x${string}` | null> {
  const pair = await client.readContract({
    address: ADDRESSES.factoryV2,
    abi: FACTORY_V2_ABI,
    functionName: "getPair",
    args: [ADDRESSES.weth, token],
  });
  if (!pair || pair.toLowerCase() === ZERO_ADDRESS.toLowerCase()) return null;
  return pair;
}

export async function readV3Pool(
  client: PublicClient,
  token: `0x${string}`,
): Promise<{ pool: `0x${string}`; fee: number } | null> {
  for (const fee of V3_FEE_TIERS) {
    const pool = await client.readContract({
      address: ADDRESSES.factoryV3,
      abi: FACTORY_V3_ABI,
      functionName: "getPool",
      args: [ADDRESSES.weth, token, fee],
    });
    if (pool && pool.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) {
      return { pool, fee };
    }
  }
  return null;
}

export async function quoteV2(
  client: PublicClient,
  amountIn: bigint,
  path: readonly `0x${string}`[],
): Promise<bigint | null> {
  try {
    const amounts = await client.readContract({
      address: ADDRESSES.routerV2,
      abi: ROUTER_V2_ABI,
      functionName: "getAmountsOut",
      args: [amountIn, [...path]],
    });
    const out = amounts[amounts.length - 1];
    return typeof out === "bigint" ? out : null;
  } catch {
    return null;
  }
}

export async function quoteV3ExactIn(
  client: PublicClient,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  fee: number,
): Promise<bigint | null> {
  try {
    const { result } = await client.simulateContract({
      address: ADDRESSES.quoterV2,
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn,
          tokenOut,
          amountIn,
          fee,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    return result[0];
  } catch {
    return null;
  }
}

export async function readBalances(
  client: PublicClient,
  token: `0x${string}`,
  wallet: `0x${string}`,
): Promise<{ ethWei: bigint; tokenRaw: bigint; allowanceRaw: bigint }> {
  const [ethWei, tokenRaw, allowanceRaw] = await Promise.all([
    client.getBalance({ address: wallet }),
    client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [wallet],
    }),
    client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [wallet, ADDRESSES.routerV2],
    }),
  ]);
  return { ethWei, tokenRaw, allowanceRaw };
}

export async function readGas(client: PublicClient): Promise<{
  maxFeeGwei: number;
  priorityGwei: number;
}> {
  try {
    const fees = await client.estimateFeesPerGas();
    const maxFee = fees.maxFeePerGas ?? 0n;
    const prio = fees.maxPriorityFeePerGas ?? 0n;
    return {
      maxFeeGwei: Number(maxFee) / 1e9,
      priorityGwei: Number(prio) / 1e9,
    };
  } catch {
    const gasPrice = await client.getGasPrice();
    return { maxFeeGwei: Number(gasPrice) / 1e9, priorityGwei: 0 };
  }
}

export function asAddress(value: string, label: string): `0x${string}` {
  const trimmed = value.trim();
  if (!isAddress(trimmed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return trimmed;
}
