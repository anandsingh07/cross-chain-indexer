import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger.child ? logger.child({ component: 'stream' }) : logger;

/**
 * Redis Streams transport that decouples ingestion (producer) from enrichment/persistence
 * (consumer group). This replaces the previous in-process direct call, which awaited
 * processEvent() inline and let pending promises pile up unbounded under a block spike —
 * an OOM risk with no backpressure toward the source.
 *
 * Why Redis Streams (and how the memory limit is handled):
 *  - A stream lives in RAM, so an UNBOUNDED stream grows forever. We cap it with
 *    `MAXLEN ~ STREAM_MAXLEN` (approximate trimming, which is cheaper), bounding memory.
 *  - Consumer groups give at-least-once delivery with explicit XACK; entries that a dead
 *    consumer never acked sit in the Pending Entries List and can be reclaimed (XAUTOCLAIM).
 *  - Backpressure: the producer checks stream depth (XLEN) and, when it exceeds a high-water
 *    mark, awaits before publishing more — so a burst slows ingestion instead of OOMing.
 *
 * Postgres remains the durable store; the stream is only the in-flight buffer.
 */

export const EVENT_STREAM = 'chainpulse:events';
export const CONSUMER_GROUP = 'enrichers';

export interface StreamEvent {
  type: 'ERC20_TRANSFER' | 'NFT_EVENT' | 'DEX_SWAP';
  chainId: number;
  [key: string]: unknown;
}

export function createRedis(): Redis {
  return new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  });
}

export class StreamProducer {
  private highWaterMark = env.STREAM_MAXLEN;
  private groupReady = false;
  constructor(private redis: Redis) {}

  /**
   * Create the consumer group up front so that events published before any consumer is
   * online are still captured by the group (otherwise a group created later at '$' would
   * skip them). Idempotent.
   */
  private async ensureGroup(): Promise<void> {
    if (this.groupReady) return;
    try {
      await this.redis.xgroup('CREATE', EVENT_STREAM, CONSUMER_GROUP, '0', 'MKSTREAM');
    } catch (err: any) {
      if (!String(err?.message).includes('BUSYGROUP')) throw err;
    }
    this.groupReady = true;
  }

  /**
   * Publish one event. Applies backpressure: if the stream is already at/above its cap,
   * wait (bounded) for consumers to drain before adding more, so we never let the buffer
   * grow without limit.
   */
  async publish(event: StreamEvent): Promise<void> {
    await this.ensureGroup();
    await this.applyBackpressure();
    // Approximate-trim keeps the stream bounded; '~' lets Redis trim efficiently in blocks.
    await this.redis.xadd(
      EVENT_STREAM,
      'MAXLEN',
      '~',
      String(env.STREAM_MAXLEN),
      '*',
      'data',
      JSON.stringify(event)
    );
  }

  private async applyBackpressure(): Promise<void> {
    // Poll depth; if over the high-water mark, pause briefly and re-check. Bounded by a
    // max wait so a permanently-stuck consumer doesn't deadlock ingestion forever.
    const maxWaitMs = 30_000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const len = await this.redis.xlen(EVENT_STREAM);
      if (len < this.highWaterMark) return;
      log.warn(`stream at capacity (${len}/${this.highWaterMark}); applying backpressure`);
      await new Promise((r) => setTimeout(r, 100));
    }
    log.error('backpressure wait exceeded; publishing anyway to avoid stalling ingestion');
  }
}

export interface ConsumerOptions {
  consumerName: string;
  batchSize?: number;
  blockMs?: number;
}

export class StreamConsumer {
  private running = false;
  constructor(
    private redis: Redis,
    private handler: (event: StreamEvent) => Promise<void>,
    private opts: ConsumerOptions
  ) {}

  /** Create the consumer group if it doesn't already exist (idempotent). */
  async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', EVENT_STREAM, CONSUMER_GROUP, '$', 'MKSTREAM');
      log.info(`created consumer group ${CONSUMER_GROUP}`);
    } catch (err: any) {
      if (!String(err?.message).includes('BUSYGROUP')) throw err;
    }
  }

  async start(): Promise<void> {
    await this.ensureGroup();
    this.running = true;
    const batchSize = this.opts.batchSize ?? 10;
    const blockMs = this.opts.blockMs ?? 5000;
    log.info(`consumer ${this.opts.consumerName} started`);

    while (this.running) {
      try {
        const res = (await this.redis.xreadgroup(
          'GROUP',
          CONSUMER_GROUP,
          this.opts.consumerName,
          'COUNT',
          batchSize,
          'BLOCK',
          blockMs,
          'STREAMS',
          EVENT_STREAM,
          '>'
        )) as [string, [string, string[]][]][] | null;

        if (!res) continue;

        for (const [, entries] of res) {
          for (const [id, fields] of entries) {
            await this.processEntry(id, fields);
          }
        }
      } catch (err: any) {
        if (!this.running) break;
        log.error(`consumer loop error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async processEntry(id: string, fields: string[]): Promise<void> {
    // fields is a flat [key, value, key, value...] array; find the 'data' value.
    const dataIdx = fields.indexOf('data');
    if (dataIdx === -1) {
      await this.redis.xack(EVENT_STREAM, CONSUMER_GROUP, id);
      return;
    }
    try {
      const event = JSON.parse(fields[dataIdx + 1]) as StreamEvent;
      await this.handler(event);
      // Only ACK after successful processing (at-least-once: a crash before ACK -> redelivery).
      await this.redis.xack(EVENT_STREAM, CONSUMER_GROUP, id);
    } catch (err: any) {
      log.error(`failed processing entry ${id}: ${err.message}`);
      // Leave unacked so it stays in the Pending Entries List for reclaim/retry.
    }
  }

  stop(): void {
    this.running = false;
  }
}
