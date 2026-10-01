import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ADDRESSES, DEFAULTS } from "./chain";
import type {
  Cadence,
  DeskConfig,
  PaperWallet,
  RotationState,
  TradeLog,
  TradeSide,
} from "./types";

const INITIAL_PAPER: PaperWallet = { eth: 0.18, token: 0 };

type DeskStore = {
  config: DeskConfig;
  paper: PaperWallet;
  rotation: RotationState;
  logs: TradeLog[];
  lastBuyAt: number | null;
  lastSellAt: number | null;
  patchConfig: (partial: Partial<DeskConfig>) => void;
  setCadence: (cadence: Cadence) => void;
  setScheduler: (on: boolean) => void;
  nextAmount: (side: TradeSide) => number;
  recordTrade: (log: TradeLog) => void;
  applyPaperFill: (side: TradeSide, eth: number, token: number) => PaperWallet;
  resetPaper: () => void;
  clearLogs: () => void;
};

export const useDeskStore = create<DeskStore>()(
  persist(
    (set, get) => ({
      config: {
        rpcUrl: "",
        walletAddress: "",
        tokenAddress: ADDRESSES.cdx,
        slippage: DEFAULTS.slippage,
        buyAmountsUsd: [...DEFAULTS.buyAmountsUsd],
        sellAmountsUsd: [...DEFAULTS.sellAmountsUsd],
        maxGasGwei: DEFAULTS.maxGasGwei,
        cadence: "demo",
        schedulerOn: false,
      },
      paper: { ...INITIAL_PAPER },
      rotation: { buyIndex: 0, sellIndex: 0 },
      logs: [],
      lastBuyAt: null,
      lastSellAt: null,
      patchConfig: (partial) =>
        set((state) => ({ config: { ...state.config, ...partial } })),
      setCadence: (cadence) =>
        set((state) => ({ config: { ...state.config, cadence } })),
      setScheduler: (on) =>
        set((state) => ({ config: { ...state.config, schedulerOn: on } })),
      nextAmount: (side) => {
        const { config, rotation } = get();
        const list = side === "buy" ? config.buyAmountsUsd : config.sellAmountsUsd;
        const key = side === "buy" ? "buyIndex" : "sellIndex";
        const index = rotation[key] % Math.max(list.length, 1);
        const amount = list[index] ?? 10;
        set({
          rotation: {
            ...rotation,
            [key]: (index + 1) % Math.max(list.length, 1),
          },
        });
        return amount;
      },
      recordTrade: (log) =>
        set((state) => ({
          logs: [log, ...state.logs].slice(0, 200),
          lastBuyAt: log.side === "buy" ? log.ts : state.lastBuyAt,
          lastSellAt: log.side === "sell" ? log.ts : state.lastSellAt,
        })),
      applyPaperFill: (side, eth, token) => {
        const paper = get().paper;
        const next =
          side === "buy"
            ? { eth: Math.max(0, paper.eth - eth), token: paper.token + token }
            : { eth: paper.eth + eth, token: Math.max(0, paper.token - token) };
        set({ paper: next });
        return next;
      },
      resetPaper: () => set({ paper: { ...INITIAL_PAPER } }),
      clearLogs: () => set({ logs: [], lastBuyAt: null, lastSellAt: null }),
    }),
    {
      name: "cdx-pulse-desk",
      skipHydration: true,
      partialize: (state) => ({
        config: state.config,
        paper: state.paper,
        rotation: state.rotation,
        logs: state.logs,
        lastBuyAt: state.lastBuyAt,
        lastSellAt: state.lastSellAt,
      }),
    },
  ),
);

export function peekAmount(side: TradeSide): number {
  const { config, rotation } = useDeskStore.getState();
  const list = side === "buy" ? config.buyAmountsUsd : config.sellAmountsUsd;
  const key = side === "buy" ? "buyIndex" : "sellIndex";
  return list[rotation[key] % Math.max(list.length, 1)] ?? 10;
}
