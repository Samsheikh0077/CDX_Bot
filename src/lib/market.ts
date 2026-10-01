import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ADDRESSES } from "./chain";
import {
  asAddress,
  connectClient,
  quoteV2,
  quoteV3ExactIn,
  readBalances,
  readEthUsd,
  readGas,
  readTokenMeta,
  readV2Pair,
  readV3Pool,
} from "./rpc.server";
import type { MarketSnapshot, QuotePreview, QuoteSource } from "./types";

const inputSchema = z.object({
  rpcUrl: z.string().optional(),
  walletAddress: z.string().optional(),
  tokenAddress: z.string().optional(),
  buyUsd: z.number().positive().max(10_000),
  sellUsd: z.number().positive().max(10_000),
  slippage: z.number().min(0).max(0.5),
});

function applySlippage(amount: bigint, slippage: number): bigint {
  const bps = BigInt(Math.round((1 - slippage) * 10_000));
  return (amount * bps) / 10_000n;
}

async function quoteExactIn(args: {
  client: Awaited<ReturnType<typeof connectClient>>["client"];
  token: `0x${string}`;
  amountIn: bigint;
  tokenInIsWeth: boolean;
  v2Ok: boolean;
  v3Fee: number | null;
}): Promise<{ out: bigint; source: QuoteSource }> {
  const { client, token, amountIn, tokenInIsWeth, v2Ok, v3Fee } = args;
  const tokenIn = tokenInIsWeth ? ADDRESSES.weth : token;
  const tokenOut = tokenInIsWeth ? token : ADDRESSES.weth;

  if (v2Ok) {
    const v2 = await quoteV2(client, amountIn, [tokenIn, tokenOut]);
    if (v2 && v2 > 0n) return { out: v2, source: "v2" };
  }
  if (v3Fee != null) {
    const v3 = await quoteV3ExactIn(client, tokenIn, tokenOut, amountIn, v3Fee);
    if (v3 && v3 > 0n) return { out: v3, source: "v3" };
  }
  return { out: 0n, source: "none" };
}

export const getMarketSnapshot = createServerFn({ method: "POST" })
  .validator(inputSchema)
  .handler(async ({ data }): Promise<MarketSnapshot> => {
    const token = asAddress(data.tokenAddress || ADDRESSES.cdx, "token address");
    const { client, rpcUsed } = await connectClient(
      data.rpcUrl && data.rpcUrl.length > 8 ? data.rpcUrl : undefined,
    );

    const [ethUsd, meta, v2Pair, v3, gas, blockNumber] = await Promise.all([
      readEthUsd(client),
      readTokenMeta(client, token),
      readV2Pair(client, token),
      readV3Pool(client, token),
      readGas(client),
      client.getBlockNumber(),
    ]);

    const wallet =
      data.walletAddress && data.walletAddress.length > 8
        ? asAddress(data.walletAddress, "wallet address")
        : null;

    const onchain = wallet
      ? await readBalances(client, token, wallet).catch(() => null)
      : null;

    const ethIn = BigInt(Math.floor((data.buyUsd / ethUsd.price) * 1e18));
    const buyResult = await quoteExactIn({
      client,
      token,
      amountIn: ethIn,
      tokenInIsWeth: true,
      v2Ok: Boolean(v2Pair),
      v3Fee: v3?.fee ?? null,
    });

    let sellQuote: QuotePreview | null = null;
    let sellSource: QuoteSource = "none";
    if (buyResult.out > 0n && ethIn > 0n) {
      const probe = (buyResult.out * BigInt(Math.round(data.sellUsd * 1e6))) /
        BigInt(Math.round(data.buyUsd * 1e6));
      const sellIn = probe > 0n ? probe : 10n ** BigInt(meta.decimals);
      const sellResult = await quoteExactIn({
        client,
        token,
        amountIn: sellIn,
        tokenInIsWeth: false,
        v2Ok: Boolean(v2Pair),
        v3Fee: v3?.fee ?? null,
      });
      sellSource = sellResult.source;
      if (sellResult.out > 0n) {
        const tokenAmount = Number(sellIn) / 10 ** meta.decimals;
        const ethOut = Number(sellResult.out) / 1e18;
        sellQuote = {
          usdAmount: data.sellUsd,
          ethWei: sellResult.out.toString(),
          tokenRaw: sellIn.toString(),
          amountOutMin: applySlippage(sellResult.out, data.slippage).toString(),
          midPriceUsd: tokenAmount > 0 ? (ethOut * ethUsd.price) / tokenAmount : null,
        };
      }
    }

    const source: QuoteSource =
      buyResult.source !== "none" ? buyResult.source : sellSource;

    const buyQuote: QuotePreview | null =
      buyResult.out > 0n
        ? {
            usdAmount: data.buyUsd,
            ethWei: ethIn.toString(),
            tokenRaw: buyResult.out.toString(),
            amountOutMin: applySlippage(buyResult.out, data.slippage).toString(),
            midPriceUsd: (() => {
              const tokenOut = Number(buyResult.out) / 10 ** meta.decimals;
              return tokenOut > 0 ? data.buyUsd / tokenOut : null;
            })(),
          }
        : null;

    let warning: string | null = null;
    if (!v2Pair && !v3) {
      warning =
        "No Uniswap V2 or V3 WETH pool found for this token. Quotes cannot be priced.";
    } else if (!v2Pair && v3) {
      warning =
        "No Uniswap V2 pair. The VPS pack is V2-only and will skip live swaps until a V2 pool exists. This desk is quoting the V3 pool.";
    }

    return {
      ethUsd: ethUsd.price,
      ethUsdUpdatedAt: ethUsd.updatedAt,
      token,
      tokenSymbol: meta.symbol,
      tokenName: meta.name,
      tokenDecimals: meta.decimals,
      v2Pair,
      v3Pool: v3?.pool ?? null,
      v3Fee: v3?.fee ?? null,
      quoteSource: source,
      buyQuote,
      sellQuote,
      gas,
      onchain: onchain
        ? {
            ethWei: onchain.ethWei.toString(),
            tokenRaw: onchain.tokenRaw.toString(),
            allowanceRaw: onchain.allowanceRaw.toString(),
          }
        : null,
      rpcUsed,
      blockNumber: Number(blockNumber),
      fetchedAt: Date.now(),
      warning,
    };
  });
