import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  // money.ts imports config/env transitively via nothing, but be safe for any env reads.
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://x:x@localhost:5432/x';
  process.env.RPC_WS_URL_SEPOLIA = process.env.RPC_WS_URL_SEPOLIA ?? 'wss://x.invalid';
  process.env.RPC_HTTP_URL_SEPOLIA = process.env.RPC_HTTP_URL_SEPOLIA ?? 'https://x.invalid';
  process.env.RPC_WS_URL_BASE_SEPOLIA = process.env.RPC_WS_URL_BASE_SEPOLIA ?? 'wss://x.invalid';
  process.env.RPC_HTTP_URL_BASE_SEPOLIA = process.env.RPC_HTTP_URL_BASE_SEPOLIA ?? 'https://x.invalid';
});

describe('money precision (decimal.js, no float corruption)', () => {
  it('normalizes a large 18-decimal uint256 without precision loss', async () => {
    const { normalizeAmount, toDbDecimal } = await import('../../src/utils/money.js');
    // 1,234,567.123456789012345678 tokens at 18 decimals.
    const raw = 1234567123456789012345678n;
    const norm = normalizeAmount(raw, 18);
    // The old parseFloat path would round this; decimal.js keeps every digit.
    expect(toDbDecimal(norm)).toBe('1234567.123456789012345678');
  });

  it('does NOT lose precision the way parseFloat does', async () => {
    const { normalizeAmount, toDbDecimal } = await import('../../src/utils/money.js');
    const raw = 123456789012345678901234567n; // 26-digit value
    const norm = normalizeAmount(raw, 18);
    const exact = toDbDecimal(norm);
    // Demonstrate the bug we fixed: float path corrupts the low-order digits.
    const floatPath = parseFloat('123456789.012345678901234567').toString();
    expect(exact).toBe('123456789.012345678901234567');
    expect(exact).not.toBe(floatPath); // proves float would have differed
  });

  it('computes USD value exactly', async () => {
    const { normalizeAmount, toUsd, toDbDecimal } = await import('../../src/utils/money.js');
    const norm = normalizeAmount(1500000000n, 6); // 1500 USDC (6 decimals)
    const usd = toUsd(norm, '0.999');
    expect(toDbDecimal(usd)).toBe('1498.5');
  });

  it('handles zero and small amounts', async () => {
    const { normalizeAmount, toDbDecimal } = await import('../../src/utils/money.js');
    expect(toDbDecimal(normalizeAmount(0n, 18))).toBe('0');
    expect(toDbDecimal(normalizeAmount(1n, 18))).toBe('0.000000000000000001');
  });
});
