import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { router } from './api/routes.js';
// Shared metrics registry — the canonical source of truth, now actually recorded at the
// ingestion/processing sites (the old in-app metrics were declared but never observed).
import { register } from './observability/metrics.js';

export const app = express();
export { register };

// 2. Request Logging Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.http(`${req.method} ${req.originalUrl} - Status: ${res.statusCode} | Duration: ${duration}ms`);
  });
  next();
});

// 3. Security & Parser Middlewares
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());

const limiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(limiter);

// 5. REST Routes
app.use('/api', router);

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error: any) {
    res.status(500).end(error.message);
  }
});

// 6. Swagger API Specifications UI Configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ChainPulse Indexer & Analytics API Docs',
      version: '1.0.0',
      description: 'Production-grade real-time ERC20 blockchain indexer API specifications'
    },
    servers: [
      {
        url: env.API_BASE_URL ? `${env.API_BASE_URL}/api` : `http://localhost:${env.PORT}/api`,
        description: 'REST API server Gateway'
      }
    ]
  },
  apis: [] // We maintain standard swagger schema references to prevent ESM build parsing exceptions
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Custom Fallback Routes & Global Error Handlers
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint Not Found' });
});

app.use((err: any, req: any, res: any, next: any) => {
  logger.error('🔥 Express Unhandled Error Catch:', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
