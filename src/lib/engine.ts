import { DEFAULTS } from "./chain";
import { getMarketSnapshot } from "./market";
import { peekAmount, useDeskStore } from "./store";
import type { MarketSnapshot, TradeLog, TradeSide } from "./types";
import { formatUnits, weiToEth } from "./utils";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nextScheduled(side: TradeSide, from = Date.now()): number {
  const { cadence, schedulerOn } = useDeskStore.getState().config;
  const { lastBuyAt, lastSellAt } = useDeskStore.getState();
  if (cadence === "demo") {
    if (side === "buy") {
      if (!lastBuyAt) return schedulerOn ? from : from + 90_000;
      return lastBuyAt + 90_000;
    }
    if (!lastBuyAt) return from + 45_000;
    if (!lastSellAt || lastSellAt < lastBuyAt) return lastBuyAt + 45_000;
    return lastSellAt + 90_000;
  }
  const d = new Date(from);
  d.setSeconds(0, 0);
  const target = side === "buy" ? 0 : 30;
  if (d.getMinutes() < target) {
    d.setMinutes(target);
    return d.getTime();
  }
  if (d.getMinutes() === target && d.getTime() >= from) return d.getTime();
  d.setHours(d.getHours() + 1);
  d.setMinutes(target, 0, 0);
  return d.getTime();
}

export async function fetchSnapshot(overrides?: {
  buyUsd?: number;
  sellUsd?: number;
}): Promise<MarketSnapshot> {
  const { config } = useDeskStore.getState();
  return getMarketSnapshot({
    data: {
      rpcUrl: config.rpcUrl || undefined,
      walletAddress: config.walletAddress || undefined,
      tokenAddress: config.tokenAddress,
      buyUsd: overrides?.buyUsd ?? peekAmount("buy"),
      sellUsd: overrides?.sellUsd ?? peekAmount("sell"),
      slippage: config.slippage,
    },
  });
}

export async function runPaperTrade(side: TradeSide): Promise<TradeLog> {
  const store = useDeskStore.getState();
  const usd = store.nextAmount(side);
  const snapshot = await fetchSnapshot({
    buyUsd: side === "buy" ? usd : peekAmount("buy"),
    sellUsd: side === "sell" ? usd : peekAmount("sell"),
  });

  const quote = side === "buy" ? snapshot.buyQuote : snapshot.sellQuote;
  const gas = snapshot.gas.maxFeeGwei;

  const skip = (note: string, extra?: Partial<TradeLog>): TradeLog => {
    const log: TradeLog = {
      id: uid(),
      ts: Date.now(),
      side,
      status: extra?.status ?? "skipped",
      usdAmount: usd,
      ethAmount: 0,
      tokenAmount: 0,
      tokenSymbol: snapshot.tokenSymbol,
      amountOutMin: 0,
      slippage: store.config.slippage,
      source: snapshot.quoteSource,
      note,
      gasGwei: gas,
      paperEthAfter: store.paper.eth,
      paperTokenAfter: store.paper.token,
      ...extra,
    };
    useDeskStore.getState().recordTrade(log);
    return log;
  };

  if (gas > store.config.maxGasGwei) {
    return skip(
      `Skipped: maxFee ${gas.toFixed(1)} gwei exceeds cap ${store.config.maxGasGwei} gwei.`,
    );
  }
  if (!quote) {
    return skip("Skipped: no Uniswap quote for this size. Check pool liquidity.");
  }

  const ethAmount = weiToEth(BigInt(quote.ethWei));
  const tokenAmount = formatUnits(BigInt(quote.tokenRaw), snapshot.tokenDecimals);
  const minOut =
    side === "buy"
      ? formatUnits(BigInt(quote.amountOutMin), snapshot.tokenDecimals)
      : weiToEth(BigInt(quote.amountOutMin));

  if (side === "buy") {
    const need = ethAmount + DEFAULTS.gasBufferEth;
    if (store.paper.eth < need) {
      return skip(
        `Skipped: paper ETH ${store.paper.eth.toFixed(5)} < ${need.toFixed(5)} (size + 0.005 gas buffer).`,
      );
    }
    const filledToken = minOut + (tokenAmount - minOut) * 0.4;
    const paper = useDeskStore.getState().applyPaperFill("buy", ethAmount, filledToken);
    const log: TradeLog = {
      id: uid(),
      ts: Date.now(),
      side: "buy",
      status: "simulated",
      usdAmount: usd,
      ethAmount,
      tokenAmount: filledToken,
      tokenSymbol: snapshot.tokenSymbol,
      amountOutMin: minOut,
      slippage: store.config.slippage,
      source: snapshot.quoteSource,
      note: `DRY_RUN swapExactETHForTokens · path WETH → ${snapshot.tokenSymbol} · ${snapshot.quoteSource.toUpperCase()} quote`,
      gasGwei: gas,
      paperEthAfter: paper.eth,
      paperTokenAfter: paper.token,
    };
    useDeskStore.getState().recordTrade(log);
    return log;
  }

  const sellToken = Math.min(tokenAmount, store.paper.token);
  if (sellToken <= 0) {
    return skip("Skipped: paper CDX balance is 0. Run a buy first.");
  }
  const scale = tokenAmount > 0 ? sellToken / tokenAmount : 1;
  const filledEth = (minOut + (ethAmount - minOut) * 0.4) * scale;
  const paper = useDeskStore.getState().applyPaperFill("sell", filledEth, sellToken);
  const log: TradeLog = {
    id: uid(),
    ts: Date.now(),
    side: "sell",
    status: "simulated",
    usdAmount: usd * scale,
    ethAmount: filledEth,
    tokenAmount: sellToken,
    tokenSymbol: snapshot.tokenSymbol,
    amountOutMin: minOut * scale,
    slippage: store.config.slippage,
    source: snapshot.quoteSource,
    note: `DRY_RUN swapExactTokensForETH · path ${snapshot.tokenSymbol} → WETH · ${snapshot.quoteSource.toUpperCase()} quote`,
    gasGwei: gas,
    paperEthAfter: paper.eth,
    paperTokenAfter: paper.token,
  };
  useDeskStore.getState().recordTrade(log);
  return log;
}

export function shouldFire(side: TradeSide, now = Date.now()): boolean {
  const { config, lastBuyAt, lastSellAt } = useDeskStore.getState();
  if (!config.schedulerOn) return false;
  if (config.cadence === "hourly") {
    const minute = new Date(now).getMinutes();
    const target = side === "buy" ? 0 : 30;
    if (minute !== target) return false;
    const last = side === "buy" ? lastBuyAt : lastSellAt;
    if (last && now - last < 50_000) return false;
    return true;
  }
  if (side === "buy") {
    if (!lastBuyAt) return true;
    return now - lastBuyAt >= 90_000;
  }
  if (!lastBuyAt) return false;
  if (!lastSellAt || lastSellAt < lastBuyAt) return now - lastBuyAt >= 45_000;
  return now - lastSellAt >= 90_000;
}
