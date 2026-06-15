import client from 'prom-client';

/**
 * Single Prometheus registry shared by every part of the app. Previously the metrics were
 * declared in app.ts but two of them (block lag, job processing duration) were never
 * recorded — dead series. They're now defined here and actually observed at the ingestion
 * and processing sites.
 */
export const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'chainpulse_' });

// Block-sync lag: how far behind head the indexer is, per chain. Set by the listener poller.
export const blockLagGauge = new client.Gauge({
  name: 'chainpulse_block_sync_lag',
  help: 'Indexer block lag relative to chain head',
  labelNames: ['chainId'] as const,
  registers: [register],
});

// Time to enrich + persist a single event. Observed around processEvent().
export const eventProcessingDuration = new client.Histogram({
  name: 'chainpulse_event_processing_seconds',
  help: 'Duration to enrich and persist a single event',
  labelNames: ['type'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

// Events processed, by type and outcome.
export const eventsProcessedTotal = new client.Counter({
  name: 'chainpulse_events_processed_total',
  help: 'Events processed by type and outcome',
  labelNames: ['type', 'outcome'] as const, // outcome: ok | error
  registers: [register],
});

// Current depth of the in-flight event stream (set by a periodic sampler).
export const streamDepthGauge = new client.Gauge({
  name: 'chainpulse_stream_depth',
  help: 'Current number of entries in the event stream buffer',
  registers: [register],
});

// Reorgs handled (the differentiator: out-of-order / retraction handling).
export const reorgsTotal = new client.Counter({
  name: 'chainpulse_reorgs_total',
  help: 'Chain reorganizations detected and compensated',
  labelNames: ['chainId'] as const,
  registers: [register],
});

// External enrichment (price oracle) cache hit ratio inputs.
export const priceCacheTotal = new client.Counter({
  name: 'chainpulse_price_cache_total',
  help: 'Price-enrichment lookups by cache result',
  labelNames: ['result'] as const, // hit | miss
  registers: [register],
});
