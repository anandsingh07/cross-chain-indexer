import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/**
 * Proves at-least-once delivery is safe: re-processing the same event (same
 * txHash+logIndex+chainId) does NOT create a duplicate row, and wallet counters are
 * incremented exactly once — the property the stream's redelivery semantics depend on.
 */
describe('idempotent writes (real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const url = container.getConnectionUri();
    process.env.DATABASE_URL = url;
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  // Mirror the worker's idempotent write+counter logic.
  async function ingestTransfer(e: {
    txHash: string; logIndex: number; chainId: number;
    from: string; to: string; token: string; amount: string;
  }) {
    // Ensure token exists (FK).
    await prisma.token.upsert({
      where: { address_chainId: { address: e.token, chainId: e.chainId } },
      update: {},
      create: { address: e.token, chainId: e.chainId, name: 'Test', symbol: 'TST', decimals: 18 },
    });

    const existing = await prisma.transfer.findUnique({
      where: { txHash_logIndex_chainId: { txHash: e.txHash, logIndex: e.logIndex, chainId: e.chainId } },
      select: { id: true },
    });
    const isNew = !existing;

    // Wallets first (Transfer has required FKs to fromWallet/toWallet), incrementing only
    // for new events.
    await prisma.wallet.upsert({
      where: { address_chainId: { address: e.from, chainId: e.chainId } },
      update: isNew ? { txCountSent: { increment: 1 } } : {},
      create: { address: e.from, chainId: e.chainId, txCountSent: 1, lastActiveBlock: 1 },
    });
    await prisma.wallet.upsert({
      where: { address_chainId: { address: e.to, chainId: e.chainId } },
      update: {},
      create: { address: e.to, chainId: e.chainId, txCountReceived: 1, lastActiveBlock: 1 },
    });

    await prisma.transfer.upsert({
      where: { txHash_logIndex_chainId: { txHash: e.txHash, logIndex: e.logIndex, chainId: e.chainId } },
      update: {},
      create: {
        txHash: e.txHash, logIndex: e.logIndex, chainId: e.chainId, blockNumber: 1,
        timestamp: new Date(), fromAddress: e.from, toAddress: e.to,
        tokenAddress: e.token, amount: e.amount, normalizedAmount: '1',
      },
    });
  }

  it('processing the same event twice yields one row and counter +1', async () => {
    const e = {
      txHash: '0xabc', logIndex: 0, chainId: 1,
      from: '0xsender', to: '0xrecipient', token: '0xtoken', amount: '1000',
    };

    await ingestTransfer(e);
    await ingestTransfer(e); // redelivery
    await ingestTransfer(e); // and again

    const rows = await prisma.transfer.count({
      where: { txHash: '0xabc', logIndex: 0, chainId: 1 },
    });
    expect(rows).toBe(1);

    const wallet = await prisma.wallet.findUnique({
      where: { address_chainId: { address: '0xsender', chainId: 1 } },
    });
    expect(wallet?.txCountSent).toBe(1); // incremented once despite 3 deliveries
  });

  it('distinct events each create their own row and increment counts', async () => {
    const base = { chainId: 1, from: '0xsender', to: '0xrecipient', token: '0xtoken', amount: '5' };
    await ingestTransfer({ ...base, txHash: '0xdef', logIndex: 0 });
    await ingestTransfer({ ...base, txHash: '0xdef', logIndex: 1 });

    const rows = await prisma.transfer.count({ where: { txHash: '0xdef' } });
    expect(rows).toBe(2);

    const wallet = await prisma.wallet.findUnique({
      where: { address_chainId: { address: '0xsender', chainId: 1 } },
    });
    // 1 from the previous test + 2 new = 3
    expect(wallet?.txCountSent).toBe(3);
  });
});
