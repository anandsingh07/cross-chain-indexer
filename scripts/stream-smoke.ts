/**
 * Standalone smoke test for the Redis Streams transport: produce N events, consume them via
 * a consumer group, assert every one is handled exactly via the group and acked (PEL drains).
 * Run: tsx scripts/stream-smoke.ts
 */
import { createRedis, StreamProducer, StreamConsumer, EVENT_STREAM, CONSUMER_GROUP, type StreamEvent } from '../src/streaming/redis-stream.js';

async function main() {
  const redis = createRedis();
  await redis.del(EVENT_STREAM);

  const producer = new StreamProducer(redis);
  const N = 50;
  const handled: string[] = [];

  const consumer = new StreamConsumer(
    createRedis(),
    async (e: StreamEvent) => { handled.push(String(e.txHash)); },
    { consumerName: 'smoke-0', batchSize: 10, blockMs: 500 }
  );
  // Ensure the consumer group exists BEFORE producing, so no early events are missed.
  await consumer.ensureGroup();
  void consumer.start();

  for (let i = 0; i < N; i++) {
    await producer.publish({ type: 'ERC20_TRANSFER', chainId: 1, txHash: `0x${i}` });
  }

  // Wait for the consumer to drain.
  const deadline = Date.now() + 20_000;
  while (handled.length < N && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  consumer.stop();

  // Check pending entries list is empty (everything acked).
  const pending = (await redis.xpending(EVENT_STREAM, CONSUMER_GROUP)) as any[];
  const pendingCount = pending?.[0] ?? 0;
  const streamLen = await redis.xlen(EVENT_STREAM);

  console.log(JSON.stringify({ produced: N, handled: handled.length, pendingCount, streamLen }));

  const ok = handled.length === N && Number(pendingCount) === 0;
  await redis.quit();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
