export const CHAIN_ID = 1;

export const ADDRESSES = {
  routerV2: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  factoryV2: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
  weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  cdx: "0x27DdDb492c9e593472D28722ED762c04f3d7221f",
  chainlinkEthUsd: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  factoryV3: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  quoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
} as const satisfies Record<string, `0x${string}`>;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const DEFAULTS = {
  slippage: 0.05,
  gasLimitSwap: 300_000,
  gasLimitApprove: 100_000,
  maxGasGwei: 50,
  retryCount: 3,
  receiptTimeout: 180,
  buyAmountsUsd: [10, 5, 20],
  sellAmountsUsd: [10, 5, 20],
  gasBufferEth: 0.005,
  deadlineSec: 600,
} as const;

export const PUBLIC_RPCS = [
  "https://eth.drpc.org",
  "https://eth-mainnet.public.blastapi.io",
  "https://mainnet.gateway.tenderly.co",
  "https://rpc.mevblocker.io",
  "https://rpc.flashbots.net",
  "https://eth.meowrpc.com",
  "https://0xrpc.io/eth",
  "https://eth-pokt.nodies.app",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
  "https://1rpc.io/eth",
  "https://cloudflare-eth.com",
] as const;


export const V3_FEE_TIERS = [10_000, 3_000, 500, 100] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

export const ROUTER_V2_ABI = [
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "WETH",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export const FACTORY_V2_ABI = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ name: "pair", type: "address" }],
  },
] as const;

export const FACTORY_V3_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

export const CHAINLINK_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

export const QUOTER_V2_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;
