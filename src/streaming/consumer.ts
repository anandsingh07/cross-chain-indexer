import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { createRedis, StreamConsumer, EVENT_STREAM, type StreamEvent } from './redis-stream.js';
import { eventProcessor } from '../workers/event-worker.js';
import { streamDepthGauge } from '../observability/metrics.js';

const log = logger.child ? logger.child({ component: 'consumer' }) : logger;

/**
 * Runs a pool of stream consumers that drain the event stream and enrich+persist each event
 * through the existing EventProcessor. This is the consumer half of the decoupled pipeline:
 * the listener publishes raw decoded events, these consumers do the heavy DB/RPC work.
 *
 * Concurrency comes from running N named consumers in the same group — Redis distributes
 * entries across them, giving horizontal scale within and across processes.
 */
export function startConsumers(): StreamConsumer[] {
  const redis = createRedis();
  const handler = (event: StreamEvent) => eventProcessor.processEvent(event as any);

  const consumers: StreamConsumer[] = [];
  for (let i = 0; i < env.CONSUMER_CONCURRENCY; i++) {
    const consumer = new StreamConsumer(redis, handler, { consumerName: `enricher-${i}` });
    void consumer.start();
    consumers.push(consumer);
  }

  // Periodically sample the in-flight stream depth so the backpressure buffer is observable.
  const depthSampler = createRedis();
  setInterval(() => {
    depthSampler.xlen(EVENT_STREAM).then((len) => streamDepthGauge.set(len)).catch(() => {});
  }, 5000);

  log.info(`started ${env.CONSUMER_CONCURRENCY} stream consumers`);
  return consumers;
}

// Allow running the consumer as its own process: `node dist/streaming/consumer.js`
const isEntrypoint = process.argv[1]?.includes('consumer');
if (isEntrypoint) {
  startConsumers();
  const shutdown = () => {
    log.info('consumer process shutting down');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
