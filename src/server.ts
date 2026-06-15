import * as http from 'http';
import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { initSocket } from './websocket/socket-broadcaster.js';
import { BlockchainListener } from './blockchain/listener.js';
import { eventProcessor } from './workers/event-worker.js';
import prisma from './db/index.js';
import pruner from './services/pruner.js';
import { initGraphQLServer } from './api/graphql.js';
import { expressMiddleware } from '@apollo/server/express4';
import { startConsumers } from './streaming/consumer.js';
import type { StreamConsumer } from './streaming/redis-stream.js';

let server: http.Server;
let listener: BlockchainListener;
let consumers: StreamConsumer[] = [];
/**
 * Main application bootstrapping sequence.
 * Connects dependencies, runs worker pipelines, starts live event streams, and launches listener ports.
 */
async function bootstrap() {
  logger.info('🚀 Initializing ChainPulse Engine bootstrap sequence...');

  try {
    // 1. Establish PostgreSQL database connectivity
    await prisma.$connect();
    logger.info('✅ PostgreSQL database connection established.');

    // 2. Initialize core HTTP Server
    server = http.createServer(app);

    // 3. Bind WebSocket servers with Redis Adapter support
    initSocket(server);

    // 3.5. Mount Apollo GraphQL Server middleware
    const apolloServer = await initGraphQLServer();
    app.use('/graphql', expressMiddleware(apolloServer) as any);

    // 4. Start stream consumers (the enrichment/persistence half of the pipeline).
    // In production these run as a separate `consumer` process; in single-process/dev mode
    // we run them in-process so one `npm run dev` boots the full pipeline.
    if (env.USE_STREAMING) {
      consumers = startConsumers();
      logger.info('✅ Redis Stream consumers bound to event stream (decoupled pipeline).');
    } else {
      logger.info('ℹ️  Streaming disabled; using in-process event processing.');
    }

    // 6. Listen for REST HTTP queries (bind port BEFORE starting chain listener so API is available immediately)
    await new Promise<void>((resolve) => {
      server.listen(env.PORT, () => {
        // Optional startup console logs for development visibility
        if (env.NODE_ENV !== 'production') {
          const baseUrl = env.API_BASE_URL || `http://localhost:${env.PORT}`;
          logger.info(`🚀 Express REST API server listening at ${baseUrl}/api`);
          logger.info(`📘 Interactive Swagger API documentation: ${baseUrl}/docs`);
          logger.info(`🚀 Apollo GraphQL endpoint: ${baseUrl}/graphql`);
          logger.info(`📊 Prometheus scraper endpoint: ${baseUrl}/metrics`);
        }
        resolve();
      });
    });

    // 7. Start live Ethereum WebSocket Ingestion Listener (runs async in background)
    listener = new BlockchainListener();
    listener.start().catch((err: any) => {
      logger.error('❌ Blockchain listener crashed:', { error: err.message });
    });

    // 8. Start daily midnight data retention pruner
    pruner.start();

    // 7. Graceful Shutdown Handlers
    const shutdown = async (signal: string) => {
      logger.warn(`🛑 Received shutdown notification: ${signal}. Commencing graceful exit sequence...`);

      // Set force exit watchdog timeout
      const forceExit = setTimeout(() => {
        logger.error('❌ Graceful shutdown timed out. Executing force termination...');
        process.exit(1);
      }, 10000); // 10-second timeout buffer

      try {
        if (listener) {
          await listener.stop();
          logger.info('✅ Live Blockchain WebSocket event listeners closed.');
        }

        if (consumers.length) {
          consumers.forEach((c) => c.stop());
          logger.info('✅ Stream consumers stopped.');
        }

        if (server) {
          server.close();
          logger.info('✅ REST HTTP server connection closed.');
        }

        pruner.stop();
        logger.info('✅ Data Retention Pruner service terminated.');

        await prisma.$disconnect();
        logger.info('✅ PostgreSQL client session disconnected.');

        clearTimeout(forceExit);
        logger.info('✨ Graceful shutdown completed. Exiting cleanly.');
        process.exit(0);
      } catch (error: any) {
        logger.error('❌ Failed executing standard graceful shutdown procedures', { error: error.message });
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error: any) {
    console.error('CRITICAL BOOTSTRAP ERROR:', error);
    logger.error('❌ Failed bootstrapping the ChainPulse container services:', { 
      context: { error: error.message, stack: error.stack }
    });
    process.exit(1);
  }
}

bootstrap();
