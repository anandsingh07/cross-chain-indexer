import { Router } from 'express';
import { z } from 'zod';
import { analyticsService } from '../services/analytics.js';
import prisma from '../db/index.js';
import { env } from '../config/env.js';
import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';

export const router = Router();

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, { 
  message: "Invalid EVM hexadecimal address format" 
});

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  chainId: z.coerce.number().int().optional()
});


/**
 * Health verification endpoint.
 * Performs active connection state queries on Postgres and both Sepolia JSON-RPC nodes.
 */
router.get('/health', async (req, res) => {
  const details: any = {
    postgres: 'UP',
    ethereumSepoliaRpc: 'UP',
    baseSepoliaRpc: 'UP',
    lagSepolia: 0,
    lagBaseSepolia: 0
  };

  let statusCode = 200;

  // 1. Check PostgreSQL
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    details.postgres = 'DOWN';
    statusCode = 503;
  }

  // 2. Check Ethereum Sepolia RPC & Sync checkpoint
  try {
    const providerSepolia = new ethers.JsonRpcProvider(env.RPC_HTTP_URL_SEPOLIA);
    const rpcBlockSepolia = await providerSepolia.getBlockNumber();
    const checkpointSepolia = await prisma.syncCheckpoint.findUnique({
      where: { chainId: 11155111 }
    });

    if (checkpointSepolia) {
      details.lagSepolia = Math.max(0, rpcBlockSepolia - checkpointSepolia.blockNumber);
      details.syncedBlockSepolia = checkpointSepolia.blockNumber;
    }
  } catch (err) {
    details.ethereumSepoliaRpc = 'DOWN';
    statusCode = 503;
  }

  // 3. Check Base Sepolia RPC & Sync checkpoint
  try {
    const providerBase = new ethers.JsonRpcProvider(env.RPC_HTTP_URL_BASE_SEPOLIA);
    const rpcBlockBase = await providerBase.getBlockNumber();
    const checkpointBase = await prisma.syncCheckpoint.findUnique({
      where: { chainId: 84532 }
    });

    if (checkpointBase) {
      details.lagBaseSepolia = Math.max(0, rpcBlockBase - checkpointBase.blockNumber);
      details.syncedBlockBase = checkpointBase.blockNumber;
    }
  } catch (err) {
    details.baseSepoliaRpc = 'DOWN';
    statusCode = 503;
  }

  return res.status(statusCode).json({
    status: statusCode === 200 ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    details
  });
});

/**
 * Retrieve transaction history of a specific wallet address.
 */
router.get('/wallet/:address/history', async (req, res) => {
  try {
    const addressParse = addressSchema.safeParse(req.params.address);
    if (!addressParse.success) {
      return res.status(400).json({ error: addressParse.error.issues[0].message });
    }

    const queryParse = querySchema.safeParse(req.query);
    if (!queryParse.success) {
      return res.status(400).json({ error: queryParse.error.issues });
    }

    const history = await analyticsService.getWalletHistory(
      addressParse.data,
      queryParse.data.limit,
      queryParse.data.cursor,
      queryParse.data.chainId
    );

    return res.json({
      data: history,
      nextCursor: history.length === queryParse.data.limit ? history[history.length - 1].id : null
    });
  } catch (error: any) {
    logger.error('API Error in GET /wallet/:address/history', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Retrieve transfers involving a specific token address.
 */
router.get('/token/:address/transfers', async (req, res) => {
  try {
    const addressParse = addressSchema.safeParse(req.params.address);
    if (!addressParse.success) {
      return res.status(400).json({ error: addressParse.error.issues[0].message });
    }

    const queryParse = querySchema.safeParse(req.query);
    if (!queryParse.success) {
      return res.status(400).json({ error: queryParse.error.issues });
    }

    const transfers = await analyticsService.getTokenTransfers(
      addressParse.data,
      queryParse.data.limit,
      queryParse.data.cursor,
      queryParse.data.chainId
    );

    return res.json({
      data: transfers,
      nextCursor: transfers.length === queryParse.data.limit ? transfers[transfers.length - 1].id : null
    });
  } catch (error: any) {
    logger.error('API Error in GET /token/:address/transfers', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Retrieve paginated DEX swaps (NEW).
 */
router.get('/swaps', async (req, res) => {
  try {
    const queryParse = querySchema.extend({
      poolAddress: z.string().optional(),
      tokenAddress: z.string().optional()
    }).safeParse(req.query);

    if (!queryParse.success) {
      return res.status(400).json({ error: queryParse.error.issues });
    }

    const swaps = await analyticsService.getSwaps(
      queryParse.data.limit,
      queryParse.data.cursor,
      queryParse.data.poolAddress,
      queryParse.data.chainId,
      queryParse.data.tokenAddress
    );

    return res.json({
      data: swaps,
      nextCursor: swaps.length === queryParse.data.limit ? swaps[swaps.length - 1].id : null
    });
  } catch (error: any) {
    logger.error('API Error in GET /swaps', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Retrieve paginated NFT events (NEW).
 */
router.get('/nfts', async (req, res) => {
  try {
    const queryParse = querySchema.extend({
      contractAddress: z.string().optional(),
      type: z.string().optional()
    }).safeParse(req.query);

    if (!queryParse.success) {
      return res.status(400).json({ error: queryParse.error.issues });
    }

    const nftEvents = await analyticsService.getNftEvents(
      queryParse.data.limit,
      queryParse.data.cursor,
      queryParse.data.contractAddress,
      queryParse.data.chainId,
      queryParse.data.type
    );

    return res.json({
      data: nftEvents,
      nextCursor: nftEvents.length === queryParse.data.limit ? nftEvents[nftEvents.length - 1].id : null
    });
  } catch (error: any) {
    logger.error('API Error in GET /nfts', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * List top wallets sorted by transaction interaction metrics.
 */
router.get('/analytics/top-wallets', async (req, res) => {
  try {
    const limit = z.coerce.number().int().min(1).max(100).default(10).parse(req.query.limit);
    const chainId = req.query.chainId ? z.coerce.number().int().parse(req.query.chainId) : undefined;

    const topWallets = await analyticsService.getTopWallets(limit, chainId);
    return res.json({ data: topWallets });
  } catch (error: any) {
    logger.error('API Error in GET /analytics/top-wallets', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Retrieve USD and volume aggregations grouped by token over window frames.
 */
router.get('/stats/volume', async (req, res) => {
  try {
    const tokenAddress = req.query.tokenAddress ? addressSchema.parse(req.query.tokenAddress) : undefined;
    const periodHours = z.coerce.number().int().min(1).max(720).default(24).parse(req.query.periodHours);
    const chainId = req.query.chainId ? z.coerce.number().int().parse(req.query.chainId) : undefined;

    const stats = await analyticsService.getVolumeStats(tokenAddress, periodHours, chainId);
    return res.json({ data: stats });
  } catch (error: any) {
    logger.error('API Error in GET /stats/volume', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Dashboard summary: event rate (events/min) + mean transfer USD + top sender/receiver.
 * Replaces several previously-hardcoded dashboard cards with real aggregations.
 */
router.get('/analytics/summary', async (req, res) => {
  try {
    const chainId = req.query.chainId ? z.coerce.number().int().parse(req.query.chainId) : undefined;
    const [eventsPerMinute, meanTransferUsd, topSenders, topReceivers] = await Promise.all([
      analyticsService.getEventRate(5, chainId),
      analyticsService.getMeanTransferUsd(24, chainId),
      analyticsService.getTopWallets(1, chainId),
      analyticsService.getTopReceivers(1, chainId),
    ]);
    return res.json({
      data: {
        eventsPerMinute,
        meanTransferUsd,
        topSender: topSenders[0] ?? null,
        topReceiver: topReceivers[0] ?? null,
      },
    });
  } catch (error: any) {
    logger.error('API Error in GET /analytics/summary', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Distribution of DEX swaps by trading pair (counts + percentages) for the pie chart.
 */
router.get('/stats/swap-pairs', async (req, res) => {
  try {
    const periodHours = z.coerce.number().int().min(1).max(720).default(24).parse(req.query.periodHours);
    const chainId = req.query.chainId ? z.coerce.number().int().parse(req.query.chainId) : undefined;
    const data = await analyticsService.getSwapPairDistribution(periodHours, chainId);
    return res.json({ data });
  } catch (error: any) {
    logger.error('API Error in GET /stats/swap-pairs', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Per-collection NFT sale/mint counts for the collection cards.
 */
router.get('/stats/nft-collections', async (req, res) => {
  try {
    const chainId = req.query.chainId ? z.coerce.number().int().parse(req.query.chainId) : undefined;
    const data = await analyticsService.getNftCollectionStats(chainId);
    return res.json({ data });
  } catch (error: any) {
    logger.error('API Error in GET /stats/nft-collections', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Retrieve a combined stream of latest events (transfers, swaps, NFTs) from all chains.
 */
router.get('/events', async (req, res) => {
  try {
    const queryParse = querySchema.safeParse(req.query);
    if (!queryParse.success) {
      return res.status(400).json({ error: queryParse.error.issues });
    }

    const { limit, chainId } = queryParse.data;

    // Fetch latest events from each database table concurrently
    const [transfers, swaps, nfts] = await Promise.all([
      prisma.transfer.findMany({
        where: chainId ? { chainId } : undefined,
        orderBy: { timestamp: 'desc' },
        take: limit,
        include: { token: true }
      }),
      prisma.dexSwap.findMany({
        where: chainId ? { chainId } : undefined,
        orderBy: { timestamp: 'desc' },
        take: limit,
        include: {
          tokenIn: true,
          tokenOut: true
        }
      }),
      prisma.nftEvent.findMany({
        where: chainId ? { chainId } : undefined,
        orderBy: { timestamp: 'desc' },
        take: limit,
        include: {
          collection: true
        }
      })
    ]);

    const formattedTransfers = transfers.map(t => ({
      id: t.id,
      type: 'transfer',
      chainId: t.chainId,
      txHash: t.txHash,
      tokenSymbol: t.token.symbol,
      amount: t.normalizedAmount.toNumber(),
      usdValue: t.usdValue ? t.usdValue.toNumber() : null,
      fromAddress: t.fromAddress,
      toAddress: t.toAddress,
      timestamp: t.timestamp.toISOString()
    }));

    const formattedSwaps = swaps.map(s => ({
      id: s.id,
      type: 'swap',
      chainId: s.chainId,
      txHash: s.txHash,
      poolAddress: s.poolAddress,
      protocol: s.protocol,
      tokenInSymbol: s.tokenIn.symbol,
      tokenOutSymbol: s.tokenOut.symbol,
      amountInNormalized: s.amountInNormalized.toNumber(),
      amountOutNormalized: s.amountOutNormalized.toNumber(),
      amountUsd: s.amountUsd ? s.amountUsd.toNumber() : null,
      sender: s.sender,
      recipient: s.recipient,
      timestamp: s.timestamp.toISOString()
    }));

    const formattedNfts = nfts.map(n => ({
      id: n.id,
      type: 'nft',
      chainId: n.chainId,
      txHash: n.txHash,
      contractAddress: n.contractAddress,
      collectionSymbol: n.collection.symbol,
      collectionName: n.collection.name,
      typeLabel: n.type,
      fromAddress: n.fromAddress,
      toAddress: n.toAddress,
      tokenId: n.tokenId,
      amount: n.amount,
      timestamp: n.timestamp.toISOString()
    }));

    // Combine all events, sort descending by timestamp, and slice the top `limit`
    const combined = [
      ...formattedTransfers,
      ...formattedSwaps,
      ...formattedNfts
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    return res.json({ data: combined });
  } catch (error: any) {
    logger.error('API Error in GET /events', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- Alert Rules Configurations Endpoints (NEW) ---

/**
 * Fetch all alert rules.
 */
router.get('/alerts/rules', async (req, res) => {
  try {
    const rules = await prisma.alertRule.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return res.json({ data: rules });
  } catch (error: any) {
    logger.error('API Error in GET /alerts/rules', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Create a new alert rule.
 */
router.post('/alerts/rules', async (req, res) => {
  try {
    const ruleSchema = z.object({
      name: z.string().min(1).max(100),
      type: z.enum(['WHALE', 'REORG', 'MILESTONE']),
      chainId: z.coerce.number().int().optional(),
      tokenAddress: z.string().optional(),
      thresholdUsd: z.coerce.number().positive().optional(),
      recipientTelegram: z.string().optional().default('')
    });

    const parsed = ruleSchema.parse(req.body);

    const created = await prisma.alertRule.create({
      data: {
        name: parsed.name,
        type: parsed.type,
        chainId: parsed.chainId,
        tokenAddress: parsed.tokenAddress?.toLowerCase(),
        thresholdUsd: parsed.thresholdUsd,
        recipientTelegram: parsed.recipientTelegram,
        isActive: true
      }
    });

    return res.status(201).json({ data: created });
  } catch (error: any) {
    logger.error('API Error in POST /alerts/rules', { error: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues });
    }
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Delete an alert rule.
 */
router.delete('/alerts/rules/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await prisma.alertRule.delete({
      where: { id }
    });
    return res.json({ message: "Alert rule deleted successfully" });
  } catch (error: any) {
    logger.error('API Error in DELETE /alerts/rules/:id', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * Retrieve historical alert logs.
 */
router.get('/alerts/logs', async (req, res) => {
  try {
    const limit = z.coerce.number().int().min(1).max(100).default(20).parse(req.query.limit);
    const logs = await prisma.alertLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { rule: true }
    });
    return res.json({ data: logs });
  } catch (error: any) {
    logger.error('API Error in GET /alerts/logs', { error: error.message });
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
