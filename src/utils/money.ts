import { ethers } from 'ethers';
import { Decimal } from 'decimal.js';

/**
 * Precise money math for on-chain amounts.
 *
 * Token amounts are uint256 — they routinely exceed JS Number's 2^53 safe-integer range,
 * and 18-decimal values lose precision the moment they touch `parseFloat`. The previous
 * code did `parseFloat(formatUnits(amount, decimals))`, silently corrupting large values
 * before they hit the Decimal(65,18) columns. Here we keep everything as exact decimals.
 *
 * `ethers.formatUnits` returns an EXACT decimal string (no float involved), so we wrap it
 * in Decimal and never convert through a JS number. Prisma accepts Decimal/strings for its
 * Decimal columns, so the precision is preserved end to end.
 */

// Configure Decimal for the widest column (Decimal(65,18)).
Decimal.set({ precision: 80 });

/** Normalize a raw uint256 amount by its token decimals, exactly. */
export function normalizeAmount(rawAmount: bigint | string, decimals: number): Decimal {
  const asString = ethers.formatUnits(rawAmount, decimals); // exact decimal string
  return new Decimal(asString);
}

/** Multiply a normalized amount by a USD price, exactly. Returns a Decimal. */
export function toUsd(normalized: Decimal, priceUsd: number | string | Decimal): Decimal {
  return normalized.mul(new Decimal(priceUsd.toString()));
}

/**
 * Convert a Decimal to a string suitable for Prisma Decimal columns (lossless).
 * Use this when writing; never pass a JS number for a money field.
 */
export function toDbDecimal(value: Decimal): string {
  return value.toFixed();
}

/** For API/WebSocket payloads where a JS number is acceptable (display only). */
export function toDisplayNumber(value: Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}
