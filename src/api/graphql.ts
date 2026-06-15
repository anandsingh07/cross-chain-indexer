import { ApolloServer } from '@apollo/server';
import prisma from '../db/index.js';
import { analyticsService } from '../services/analytics.js';
import { logger } from '../utils/logger.js';

// 1. GraphQL Type Definitions (Schemas)
export const typeDefs = `#graphql
  type Token {
    address: String!
    chainId: Int!
    symbol: String!
    name: String!
    decimals: Int!
    pythFeedId: String
    createdAt: String!
  }

  type Wallet {
    address: String!
    chainId: Int!
    txCountSent: Int!
    txCountReceived: Int!
    lastActiveBlock: Int!
    createdAt: String!
    updatedAt: String!
  }

  type Transfer {
    id: ID!
    txHash: String!
    logIndex: Int!
    blockNumber: Int!
    timestamp: String!
    chainId: Int!
    fromAddress: String!
    toAddress: String!
    tokenAddress: String!
    amount: String!
    normalizedAmount: Float!
    usdValue: Float
    token: Token!
  }

  type DexSwap {
    id: ID!
    txHash: String!
    logIndex: Int!
    blockNumber: Int!
    timestamp: String!
    chainId: Int!
    poolAddress: String!
    protocol: String!
    sender: String!
    recipient: String!
    tokenInAddress: String!
    tokenOutAddress: String!
    amountIn: String!
    amountOut: String!
    amountInNormalized: Float!
    amountOutNormalized: Float!
    amountUsd: Float
    tokenIn: Token!
    tokenOut: Token!
  }

  type NftCollection {
    address: String!
    chainId: Int!
    name: String!
    symbol: String!
    type: String!
    createdAt: String!
  }

  type NftEvent {
    id: ID!
    txHash: String!
    logIndex: Int!
    blockNumber: Int!
    timestamp: String!
    chainId: Int!
    contractAddress: String!
    type: String!
    fromAddress: String!
    toAddress: String!
    tokenId: String!
    amount: String!
    priceUsd: Float
    collection: NftCollection!
  }

  type VolumeStat {
    tokenAddress: String!
    chainId: Int!
    symbol: String!
    name: String!
    decimals: Int!
    txCount: Int!
    totalNormalizedAmount: Float!
    totalUsdVolume: Float!
  }

  type AlertRule {
    id: ID!
    name: String!
    type: String!
    chainId: Int
    tokenAddress: String
    thresholdUsd: Float
    recipientTelegram: String
    isActive: Boolean!
    createdAt: String!
  }

  type AlertLog {
    id: ID!
    ruleId: ID!
    type: String!
    message: String!
    recipient: String!
    status: String!
    createdAt: String!
    rule: AlertRule!
  }

  type SyncCheckpoint {
    chainId: Int!
    blockNumber: Int!
    updatedAt: String!
  }

  type ProcessingLog {
    id: ID!
    level: String!
    message: String!
    context: String
    createdAt: String!
  }

  type Query {
    walletHistory(address: String!, limit: Int, cursor: String, chainId: Int): [Transfer!]!
    tokenTransfers(tokenAddress: String!, limit: Int, cursor: String, chainId: Int): [Transfer!]!
    swaps(limit: Int, cursor: String, poolAddress: String, chainId: Int, tokenAddress: String): [DexSwap!]!
    nftEvents(limit: Int, cursor: String, contractAddress: String, chainId: Int, type: String): [NftEvent!]!
    topWallets(limit: Int, chainId: Int): [Wallet!]!
    volumeStats(tokenAddress: String, periodHours: Int, chainId: Int): [VolumeStat!]!
    alertRules: [AlertRule!]!
    alertLogs(limit: Int): [AlertLog!]!
    syncCheckpoints: [SyncCheckpoint!]!
    processingLogs(limit: Int): [ProcessingLog!]!
  }

  type Mutation {
    createAlertRule(
      name: String!
      type: String!
      chainId: Int
      tokenAddress: String
      thresholdUsd: Float
      recipientTelegram: String
    ): AlertRule!
    deleteAlertRule(id: ID!): Boolean!
  }
`;

// 2. Query & Mutation Resolvers
export const resolvers = {
  Query: {
    walletHistory: async (_: any, args: { address: string; limit?: number; cursor?: string; chainId?: number }) => {
      const history = await analyticsService.getWalletHistory(args.address, args.limit || 20, args.cursor, args.chainId);
      return history.map(h => ({
        ...h,
        timestamp: h.timestamp.toISOString(),
        normalizedAmount: h.normalizedAmount.toNumber(),
        usdValue: h.usdValue ? h.usdValue.toNumber() : null
      }));
    },
    tokenTransfers: async (_: any, args: { tokenAddress: string; limit?: number; cursor?: string; chainId?: number }) => {
      const transfers = await analyticsService.getTokenTransfers(args.tokenAddress, args.limit || 20, args.cursor, args.chainId);
      return transfers.map(t => ({
        ...t,
        timestamp: t.timestamp.toISOString(),
        normalizedAmount: t.normalizedAmount.toNumber(),
        usdValue: t.usdValue ? t.usdValue.toNumber() : null
      }));
    },
    swaps: async (_: any, args: { limit?: number; cursor?: string; poolAddress?: string; chainId?: number; tokenAddress?: string }) => {
      const swaps = await analyticsService.getSwaps(args.limit || 20, args.cursor, args.poolAddress, args.chainId, args.tokenAddress);
      return swaps.map(s => ({
        ...s,
        timestamp: s.timestamp.toISOString(),
        amountInNormalized: s.amountInNormalized.toNumber(),
        amountOutNormalized: s.amountOutNormalized.toNumber(),
        amountUsd: s.amountUsd ? s.amountUsd.toNumber() : null
      }));
    },
    nftEvents: async (_: any, args: { limit?: number; cursor?: string; contractAddress?: string; chainId?: number; type?: string }) => {
      const events = await analyticsService.getNftEvents(args.limit || 20, args.cursor, args.contractAddress, args.chainId, args.type);
      return events.map(e => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
        priceUsd: e.priceUsd ? e.priceUsd.toNumber() : null
      }));
    },
    topWallets: async (_: any, args: { limit?: number; chainId?: number }) => {
      const wallets = await analyticsService.getTopWallets(args.limit || 10, args.chainId);
      return wallets.map(w => ({
        ...w,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString()
      }));
    },
    volumeStats: async (_: any, args: { tokenAddress?: string; periodHours?: number; chainId?: number }) => {
      const stats = await analyticsService.getVolumeStats(args.tokenAddress, args.periodHours || 24, args.chainId);
      return stats.map(s => ({
        ...s,
        totalNormalizedAmount: typeof s.totalNormalizedAmount === 'number' ? s.totalNormalizedAmount : Number(s.totalNormalizedAmount),
        totalUsdVolume: typeof s.totalUsdVolume === 'number' ? s.totalUsdVolume : Number(s.totalUsdVolume)
      }));
    },
    alertRules: async () => {
      const rules = await prisma.alertRule.findMany({ orderBy: { createdAt: 'desc' } });
      return rules.map(r => ({
        ...r,
        thresholdUsd: r.thresholdUsd ? r.thresholdUsd.toNumber() : null,
        createdAt: r.createdAt.toISOString()
      }));
    },
    alertLogs: async (_: any, args: { limit?: number }) => {
      const logs = await prisma.alertLog.findMany({
        take: args.limit || 20,
        orderBy: { createdAt: 'desc' },
        include: { rule: true }
      });
      return logs.map(l => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
        rule: {
          ...l.rule,
          thresholdUsd: l.rule.thresholdUsd ? l.rule.thresholdUsd.toNumber() : null,
          createdAt: l.rule.createdAt.toISOString()
        }
      }));
    },
    syncCheckpoints: async () => {
      const checkpoints = await prisma.syncCheckpoint.findMany({ orderBy: { chainId: 'asc' } });
      return checkpoints.map(c => ({
        ...c,
        updatedAt: c.updatedAt.toISOString()
      }));
    },
    processingLogs: async (_: any, args: { limit?: number }) => {
      const logs = await prisma.processingLog.findMany({
        take: args.limit || 20,
        orderBy: { createdAt: 'desc' }
      });
      return logs.map(l => ({
        ...l,
        createdAt: l.createdAt.toISOString()
      }));
    }
  },

  Mutation: {
    createAlertRule: async (_: any, args: {
      name: string;
      type: string;
      chainId?: number;
      tokenAddress?: string;
      thresholdUsd?: number;
      recipientTelegram?: string;
    }) => {
      const created = await prisma.alertRule.create({
        data: {
          name: args.name,
          type: args.type,
          chainId: args.chainId,
          tokenAddress: args.tokenAddress?.toLowerCase(),
          thresholdUsd: args.thresholdUsd,
          recipientTelegram: args.recipientTelegram || '',
          isActive: true
        }
      });
      return {
        ...created,
        thresholdUsd: created.thresholdUsd ? created.thresholdUsd.toNumber() : null,
        createdAt: created.createdAt.toISOString()
      };
    },
    deleteAlertRule: async (_: any, args: { id: string }) => {
      try {
        await prisma.alertRule.delete({ where: { id: args.id } });
        return true;
      } catch (err) {
        logger.error(`GraphQL Mutation deleteAlertRule failed for ID ${args.id}`, err);
        return false;
      }
    }
  }
};

/**
 * Initializes and starts the Apollo Server instance.
 */
export async function initGraphQLServer(): Promise<ApolloServer> {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    introspection: true // Enable dynamic explorer features in dev mode
  });

  await server.start();
  logger.info('🚀 Apollo GraphQL Server successfully initialized and prepared.');
  return server;
}
