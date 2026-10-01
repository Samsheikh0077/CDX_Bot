import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddress(value: string, size = 4): string {
  if (!value || value.length < size * 2 + 2) return value;
  return `${value.slice(0, 2 + size)}…${value.slice(-size)}`;
}

export function formatUsd(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatEth(value: number, digits = 5): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)} ETH`;
}

export function formatToken(value: number, symbol: string, digits = 4): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  })} ${symbol}`;
}

export function formatGwei(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(value >= 10 ? 1 : 2)} gwei`;
}

export function weiToEth(wei: bigint): number {
  return formatUnits(wei, 18);
}

export function ethToWei(eth: number): bigint {
  if (!Number.isFinite(eth) || eth <= 0) return 0n;
  return parseUnits(eth, 18);
}

export function parseUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  const [whole = "0", frac = ""] = amount.toFixed(Math.min(decimals, 8)).split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

export function formatUnits(raw: bigint, decimals: number): number {
  const neg = raw < 0n;
  const value = neg ? -raw : raw;
  const base = 10n ** BigInt(Math.max(decimals, 0));
  const whole = value / base;
  const frac = value % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 8);
  const num = Number(`${whole}.${fracStr || "0"}`);
  return neg ? -num : num;
}

export function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}
