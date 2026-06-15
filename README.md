# ⚡ ChainPulse — Real-Time Event-Streaming & Analytics Platform

A horizontally-scalable backend that ingests high-throughput event streams, decodes and enriches them with external reference data, persists them **idempotently** to PostgreSQL, automatically **compensates for out-of-order / retracted upstream events**, and serves live data over REST, GraphQL, and WebSocket — with Prometheus observability throughout.

The reference data source shipped here is an **EVM blockchain connector** (decoding ERC-20/721/1155 transfers and DEX swaps), but the engine is source-agnostic: the connector is just the producer in front of a generic streaming pipeline. The hard parts — backpressured ingestion, idempotent storage, ordered-stream correction, exactly-once-effect aggregation — are domain-independent.

> **What makes it interesting as a systems project:** the "reorg handler" is really an implementation of **out-of-order / retraction handling in an ordered event stream** — when the upstream source revises history, a rolling sequence ledger detects the divergence and atomically emits compensating deletes, then resets the read cursor to the fork point. That's a genuinely hard distributed-systems problem (the same shape Kafka/Flink call "retractions").

## 📌 About

**What it is:** a horizontally-scalable event-streaming & analytics backend that ingests high-throughput events, enriches them, stores them idempotently, corrects out-of-order/retracted history, and serves them over REST, GraphQL, and WebSocket.

**How it works:** a source connector (an EVM blockchain by default) decodes raw frames into typed events and publishes them to a **bounded Redis Stream**. A **consumer group** of enrichers drains the stream with at-least-once delivery (`XREADGROUP`/`XACK`), backpressuring ingestion instead of OOMing under bursts. Each event is enriched (price oracle + TTL cache) and **upserted idempotently** on `(txHash, logIndex, chainId)`, with wallet counters incrementing exactly once even under redelivery. When the upstream revises history, a rolling block-ledger detects the fork and atomically rolls back affected rows. Money is exact `decimal.js` end-to-end (never `parseFloat` on a uint256).

**Tech:** Node 22 · TypeScript · Express · Apollo GraphQL · Socket.IO · Redis Streams · PostgreSQL/Prisma · decimal.js · prom-client · Vitest + Testcontainers · Docker.

## ✨ Highlights

- **Decoupled, backpressured pipeline.** Ingestion publishes to a **Redis Stream** (bounded via `MAXLEN`); a **consumer group** of enrichers drains it with at-least-once delivery (XACK), so a burst slows ingestion instead of OOMing the process. Producer and consumers scale independently.
- **Idempotent storage.** Every event upserts on `(txHash, logIndex, chainId)`, and wallet counters increment **exactly once per event** even under redelivery. Proven by an integration test.
- **Precise money math.** Amounts are handled as exact `decimal.js` values end-to-end — never `parseFloat` on a uint256 (which silently corrupts large/18-decimal values).
- **Ordered-stream correction.** A rolling block-history ledger detects upstream history rewrites and atomically rolls back affected rows + resets the sync cursor.
- **Real observability.** Prometheus `/metrics` that are actually recorded: event throughput by type/outcome, processing-duration histogram, stream depth, source lag, reorg count, enrichment-cache hit ratio.
- **Three API surfaces** — REST (cursor-paginated), Apollo GraphQL, and Socket.IO live streaming — over a shared analytics layer.
- **Tested & CI'd** — unit tests (decoding, money precision) + integration tests (idempotency on real Postgres via Testcontainers), GitHub Actions.

## 🏗️ Architecture

```mermaid
flowchart LR
  subgraph src [Source Connector]
    EVM[EVM WS/HTTP] --> DEC[Decode raw logs -> typed events]
  end
  subgraph stream [Transport]
    S[(Redis Stream\nbounded MAXLEN + consumer group)]
  end
  subgraph enrich [Enrichment / Persistence]
    C[Consumer group\nN enrichers]
    PR[Reference-data enrichment\nprice oracle + TTL cache]
    RB[Ordered-stream correction\nreorg/retraction handler]
  end
  PG[(PostgreSQL\nidempotent upserts)]
  subgraph api [Serving]
    REST[REST]
    GQL[GraphQL]
    WS[Socket.IO]
    M[/metrics, /health/]
  end

  DEC -->|publish + backpressure| S
  S -->|XREADGROUP / XACK| C
  C --> PR --> PG
  C --> RB --> PG
  PG --> REST
  PG --> GQL
  C -->|live| WS
```

### The pipeline, concretely
1. **Source connector** subscribes to the source and decodes raw frames into typed events (`ERC20_TRANSFER` / `NFT_EVENT` / `DEX_SWAP`).
2. It **publishes** each event to a bounded Redis Stream. If the stream is at capacity, the producer applies backpressure instead of buffering unbounded promises in memory.
3. A **consumer group** of enrichers reads batches (`XREADGROUP`), enriches (reference-data lookup with TTL cache), and **persists idempotently**. Each entry is `XACK`'d only after success — a crash before ACK means redelivery, which the idempotent writes make safe.
4. On upstream history revision, the **correction handler** rolls back affected rows in a transaction and resets the cursor to the fork point.

## 🚀 Quick Start (Docker)

```bash
# create a .env from the template in "Configuration" below, then:
docker compose up -d --build
```

- REST → http://localhost:3000/api · GraphQL → `/graphql` · Metrics → `/metrics` · Docs → `/docs`
- Scale enrichers: `docker compose up -d --scale consumer=4`

## 💻 Local Development

```bash
npm install
# create a .env from the template in "Configuration" below
npx prisma migrate deploy
npm run dev          # API + listener + in-process consumers
# or run the consumer separately:
npm run build && npm run consumer
```

## ✅ Testing

```bash
npm test                   # unit: decoding + money precision
npm run test:integration   # idempotency on real Postgres (Testcontainers; needs Docker)
```

| Test | Proves |
|------|--------|
| `money.test.ts` | exact decimal math; float path would have corrupted values |
| `topic-decode.test.ts` | event-signature hashes & log decoding are correct |
| `idempotency.test.ts` | re-processing an event → one row + counter incremented once |

## ⚙️ Configuration

Key environment variables:

| Var | Purpose |
|-----|---------|
| `USE_STREAMING` | `true` = decoupled Redis-Streams pipeline; `false` = legacy in-process |
| `STREAM_MAXLEN` | bound on the in-flight stream buffer (backpressure threshold) |
| `CONSUMER_CONCURRENCY` | enrichers per process |
| `REDIS_HOST` / `REDIS_PORT` | stream + cache |
| `DATABASE_URL` | PostgreSQL |
| `RPC_*` | source connector endpoints |

Create a `.env` file in the project root with the following (copy this block):

```dotenv
# --- Server ---
PORT=3000
NODE_ENV=development

# --- PostgreSQL ---
DATABASE_URL=postgresql://chainpulse:chainpulse@127.0.0.1:5432/chainpulse

# --- Redis (stream transport + cache) ---
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

# --- Streaming pipeline ---
# true  = decoupled Redis-Streams pipeline (producer + consumer group)
# false = legacy in-process direct processing
USE_STREAMING=true
# Bound on the in-flight stream buffer; producer applies backpressure above this.
STREAM_MAXLEN=50000
# Enrichers per process.
CONSUMER_CONCURRENCY=4

# --- Source connector (EVM) ---
RPC_WS_URL_SEPOLIA=wss://your-sepolia-ws-endpoint
RPC_HTTP_URL_SEPOLIA=https://your-sepolia-http-endpoint
RPC_WS_URL_BASE_SEPOLIA=wss://your-base-sepolia-ws-endpoint
RPC_HTTP_URL_BASE_SEPOLIA=https://your-base-sepolia-http-endpoint

# --- Reference-data enrichment (price oracle) ---
PYTH_HERMES_URL=https://hermes.pyth.network

# --- Rate limiting ---
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# --- Optional alerting ---
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

## 🧱 Tech Stack

Node.js 22 · TypeScript · Express · Apollo GraphQL · Socket.IO · Redis Streams (ioredis) · PostgreSQL (Prisma) · decimal.js · prom-client · Zod · Vitest + Testcontainers · Docker (multi-stage, non-root).

## 📝 Notes

- The EVM connector targets testnets (Sepolia, Base Sepolia) by default; point `RPC_*` at any EVM endpoint.
- "Blockchain" is one connector. The transport, enrichment, idempotent storage, ordered-stream correction, and serving layers are generic and could front any high-throughput event source.
