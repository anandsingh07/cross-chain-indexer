import { ethers } from 'ethers';
import prisma from '../db/index.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { pythService } from '../services/pyth.js';
export interface EventJobData {
  type: 'ERC20_TRANSFER' | 'NFT_EVENT' | 'DEX_SWAP';
  chainId: number;
  [key: string]: any;
}
import { broadcastEvent } from '../websocket/socket-broadcaster.js';
import { alertsService } from '../services/alerts.js';
import { normalizeAmount, toUsd, toDbDecimal } from '../utils/money.js';
import { eventProcessingDuration, eventsProcessedTotal } from '../observability/metrics.js';

// Semaphore: limits how many events touch the DB concurrently
// Supabase free tier can handle concurrent queries but not hundreds at once
class Semaphore {
  private count: number;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrent: number) {
    this.count = maxConcurrent;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    return new Promise(resolve => this.queue.push(resolve));
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.count++;
    }
  }
}

// Max 4 concurrent DB operations across all chains
const dbSemaphore = new Semaphore(4);

const httpProviders: Record<number, ethers.JsonRpcProvider> = {
  11155111: new ethers.JsonRpcProvider(env.RPC_HTTP_URL_SEPOLIA),
  84532: new ethers.JsonRpcProvider(env.RPC_HTTP_URL_BASE_SEPOLIA)
};

export class EventProcessor {
  
  async processEvent(data: EventJobData) {
    await dbSemaphore.acquire();
    const endTimer = eventProcessingDuration.startTimer({ type: data.type });
    try {
      const provider = httpProviders[data.chainId];
      if (!provider) {
        throw new Error(`Unsupported Chain ID: ${data.chainId}`);
      }

      switch (data.type) {
        case 'ERC20_TRANSFER':
          await this.handleERC20Transfer(data, provider);
          break;
        case 'NFT_EVENT':
          await this.handleNftEvent(data, provider);
          break;
        case 'DEX_SWAP':
          await this.handleDexSwap(data, provider);
          break;
        default:
          throw new Error(`Invalid Event Type: ${(data as any).type}`);
      }
      eventsProcessedTotal.inc({ type: data.type, outcome: 'ok' });
    } catch (err: any) {
      eventsProcessedTotal.inc({ type: data.type, outcome: 'error' });
      logger.error(`❌ Event process failed: ${err.message}`);
      // Re-throw so the stream consumer leaves the entry unacked for retry/reclaim,
      // instead of silently swallowing failures (the old behaviour).
      throw err;
    } finally {
      endTimer();
      dbSemaphore.release();
    }
  }

  private tokenCache = new Map<string, any>();

  // --- 1. ERC-20 Transfers Ingestion ---
  private async handleERC20Transfer(data: any, provider: ethers.JsonRpcProvider) {
    const { chainId, txHash, logIndex, blockNumber, timestamp, fromAddress, toAddress, tokenAddress, amount } = data;

    const cacheKey = `${chainId}-${tokenAddress}`;
    let token = this.tokenCache.get(cacheKey);

    if (!token) {
      token = await prisma.token.findUnique({
        where: { address_chainId: { address: tokenAddress, chainId } }
      });
      if (token) this.tokenCache.set(cacheKey, token);
    }

    if (!token) {
      logger.info(`🔍 [Chain ${chainId}] Token ${tokenAddress} missing in DB. Fetching dynamically...`);
      const erc20 = new ethers.Contract(tokenAddress, [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)"
      ], provider);

      const [name, symbol, decimals] = await Promise.all([
        erc20.name().catch(() => "Unknown Token"),
        erc20.symbol().catch(() => "UNKNOWN"),
        erc20.decimals().catch(() => 18)
      ]);

      token = await prisma.token.upsert({
        where: { address_chainId: { address: tokenAddress, chainId } },
        update: {},
        create: { address: tokenAddress, chainId, name, symbol, decimals: Number(decimals), pythFeedId: null }
      });
      this.tokenCache.set(cacheKey, token);
      logger.info(`✅ Seeded missing token metadata: ${token.symbol} on Chain ${chainId}`);
    }

    // B. Amount Normalization — exact decimal, never parseFloat on a uint256.
    const normalizedAmount = normalizeAmount(amount, token.decimals);

    // C. Pricing Enrichment via Pyth
    let usdValue: import('decimal.js').Decimal | null = null;
    if (token.pythFeedId) {
      const priceUsd = await pythService.getAssetPriceUsd(token.pythFeedId);
      if (priceUsd !== null) {
        usdValue = toUsd(normalizedAmount, priceUsd);
      }
    }

    // D. Detect whether this is a brand-new event so wallet counters increment exactly once
    // even under at-least-once redelivery. Re-processing an existing event updates pricing
    // but does NOT re-increment counts.
    const existing = await prisma.transfer.findUnique({
      where: { txHash_logIndex_chainId: { txHash, logIndex, chainId } },
      select: { id: true }
    });
    const isNewEvent = !existing;

    // E. Ensure wallet rows exist FIRST (Transfer has required FKs to fromWallet/toWallet).
    // Increment counters here only for new events; lastActiveBlock always advances.
    await prisma.wallet.upsert({
      where: { address_chainId: { address: fromAddress, chainId } },
      update: {
        lastActiveBlock: blockNumber,
        ...(isNewEvent ? { txCountSent: { increment: 1 } } : {})
      },
      create: { address: fromAddress, chainId, txCountSent: 1, lastActiveBlock: blockNumber }
    }).catch(() => {});

    await prisma.wallet.upsert({
      where: { address_chainId: { address: toAddress, chainId } },
      update: {
        lastActiveBlock: blockNumber,
        ...(isNewEvent ? { txCountReceived: { increment: 1 } } : {})
      },
      create: { address: toAddress, chainId, txCountReceived: 1, lastActiveBlock: blockNumber }
    }).catch(() => {});

    // F. Persist the transfer (idempotent upsert). Wallets above satisfy its required FKs.
    const usdValueDb = usdValue ? toDbDecimal(usdValue) : null;
    const transferRecord = await prisma.transfer.upsert({
      where: { txHash_logIndex_chainId: { txHash, logIndex, chainId } },
      update: { usdValue: usdValueDb },
      create: {
        txHash, logIndex, blockNumber,
        timestamp: new Date(timestamp * 1000),
        chainId, fromAddress, toAddress, tokenAddress, amount,
        normalizedAmount: toDbDecimal(normalizedAmount),
        usdValue: usdValueDb
      },
      include: { token: true }
    });

    // G. WebSocket Broadcast
    if (data.isLive !== false) {
      broadcastEvent('transfer', {
        id: transferRecord.id,
        txHash: transferRecord.txHash,
        logIndex: transferRecord.logIndex,
        blockNumber: transferRecord.blockNumber,
        timestamp: transferRecord.timestamp.toISOString(),
        chainId: transferRecord.chainId,
        fromAddress: transferRecord.fromAddress,
        toAddress: transferRecord.toAddress,
        tokenAddress: transferRecord.tokenAddress,
        amount: transferRecord.amount,
        normalizedAmount: transferRecord.normalizedAmount.toNumber(),
        usdValue: transferRecord.usdValue ? transferRecord.usdValue.toNumber() : null,
        tokenSymbol: transferRecord.token.symbol
      });
    }

    // F. Evaluate Whale Alerts
    if (data.isLive !== false && transferRecord.usdValue) {
      alertsService.evaluateWhaleAlert({
        chainId: transferRecord.chainId,
        tokenAddress: transferRecord.tokenAddress,
        symbol: transferRecord.token.symbol,
        amountNormalized: transferRecord.normalizedAmount.toNumber(),
        amountUsd: transferRecord.usdValue.toNumber(),
        txHash: transferRecord.txHash,
        fromAddress: transferRecord.fromAddress,
        toAddress: transferRecord.toAddress
      }).catch(err => logger.error('❌ Error evaluating transfer whale alert:', err));
    }
  }

  private nftCache = new Map<string, any>();

  // --- 2. NFT Event Ingestion (ERC-721/1155) ---
  private async handleNftEvent(data: any, provider: ethers.JsonRpcProvider) {
    const { chainId, txHash, logIndex, blockNumber, timestamp, contractAddress, nftType, eventType, fromAddress, toAddress, tokenId, amount } = data;

    const cacheKey = `${chainId}-${contractAddress}`;
    let collection = this.nftCache.get(cacheKey);

    if (!collection) {
      collection = await prisma.nftCollection.findUnique({
        where: { address_chainId: { address: contractAddress, chainId } }
      });
      if (collection) this.nftCache.set(cacheKey, collection);
    }

    if (!collection) {
      logger.info(`🔍 [Chain ${chainId}] NFT Collection ${contractAddress} missing in DB. Fetching metadata...`);
      
      const nftContract = new ethers.Contract(contractAddress, [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function supportsInterface(bytes4) view returns (bool)"
      ], provider);

      const [name, symbol, isErc721, isErc1155] = await Promise.all([
        nftContract.name().catch(() => "Unknown Collection"),
        nftContract.symbol().catch(() => "NFT"),
        nftContract.supportsInterface("0x80ac58cd").catch(() => false),
        nftContract.supportsInterface("0xd9b67a26").catch(() => false)
      ]);

      const type = isErc1155 ? "ERC1155" : isErc721 ? "ERC721" : nftType;

      collection = await prisma.nftCollection.upsert({
        where: { address_chainId: { address: contractAddress, chainId } },
        update: {},
        create: { address: contractAddress, chainId, name, symbol, type }
      });
      this.nftCache.set(cacheKey, collection);
      logger.info(`✅ Seeded missing NFT collection: ${collection.name} (${collection.symbol}) on Chain ${chainId}`);
    }

    // B. Sequential DB writes — NO transaction wrapper
    await prisma.wallet.upsert({
      where: { address_chainId: { address: fromAddress, chainId } },
      update: { lastActiveBlock: blockNumber },
      create: { address: fromAddress, chainId, txCountSent: 1, lastActiveBlock: blockNumber }
    }).catch(() => {});

    await prisma.wallet.upsert({
      where: { address_chainId: { address: toAddress, chainId } },
      update: { lastActiveBlock: blockNumber },
      create: { address: toAddress, chainId, txCountReceived: 1, lastActiveBlock: blockNumber }
    }).catch(() => {});

    const nftEventRecord = await prisma.nftEvent.upsert({
      where: { txHash_logIndex_chainId: { txHash, logIndex, chainId } },
      update: {},
      create: {
        txHash, logIndex, blockNumber,
        timestamp: new Date(timestamp * 1000),
        chainId, contractAddress,
        type: eventType,
        fromAddress, toAddress, tokenId, amount
      },
      include: { collection: true }
    });

    // C. WebSocket Broadcast
    if (data.isLive !== false) {
      broadcastEvent('nft', {
        id: nftEventRecord.id,
        txHash: nftEventRecord.txHash,
        logIndex: nftEventRecord.logIndex,
        blockNumber: nftEventRecord.blockNumber,
        timestamp: nftEventRecord.timestamp.toISOString(),
        chainId: nftEventRecord.chainId,
        contractAddress: nftEventRecord.contractAddress,
        type: nftEventRecord.type,
        fromAddress: nftEventRecord.fromAddress,
        toAddress: nftEventRecord.toAddress,
        tokenId: nftEventRecord.tokenId,
        amount: nftEventRecord.amount,
        collectionName: nftEventRecord.collection.name,
        collectionSymbol: nftEventRecord.collection.symbol
      });
    }
  }

  // --- 3. DEX Swaps Ingestion ---
  private async handleDexSwap(data: any, provider: ethers.JsonRpcProvider) {
    const { chainId, txHash, logIndex, blockNumber, timestamp, poolAddress, protocol, sender, recipient, amountIn, amountOut } = data;

    try {
      // A. Dynamic Pool tokens lookup
      const poolContract = new ethers.Contract(poolAddress, [
        "function token0() view returns (address)",
        "function token1() view returns (address)"
      ], provider);

      const [token0, token1] = await Promise.all([
        poolContract.token0().catch(() => null),
        poolContract.token1().catch(() => null)
      ]);

      if (!token0 || !token1) {
        throw new Error(`Failed resolving trading pool tokens at address ${poolAddress}`);
      }

      const cleanToken0 = token0.toLowerCase();
      const cleanToken1 = token1.toLowerCase();

      // B. Direction Resolver: query logs in transaction receipt
      const receipt = await provider.getTransactionReceipt(txHash);
      let tokenInAddress = cleanToken0;
      let tokenOutAddress = cleanToken1;

      if (receipt) {
        const transferTopic = ethers.id('Transfer(address,address,uint256)');
        const transferLogs = receipt.logs.filter(
          l => l.topics[0] === transferTopic && l.topics.length === 3
        );

        const transferToPool = transferLogs.find(
          t => ethers.getAddress('0x' + t.topics[2].slice(26)).toLowerCase() === poolAddress.toLowerCase()
        );

        const transferFromPool = transferLogs.find(
          t => ethers.getAddress('0x' + t.topics[1].slice(26)).toLowerCase() === poolAddress.toLowerCase()
        );

        if (transferToPool) tokenInAddress = transferToPool.address.toLowerCase();
        if (transferFromPool) tokenOutAddress = transferFromPool.address.toLowerCase();
      }

      // C. Ensure Token Metadata exists in DB
      const ensureToken = async (addr: string) => {
        const cacheKey = `${chainId}-${addr}`;
        let t = this.tokenCache.get(cacheKey);

        if (!t) {
          t = await prisma.token.findUnique({
            where: { address_chainId: { address: addr, chainId } }
          });
          if (t) this.tokenCache.set(cacheKey, t);
        }

        if (!t) {
          logger.info(`🔍 [Chain ${chainId}] Token ${addr} missing. Fetching dynamically...`);
          const erc20 = new ethers.Contract(addr, [
            "function name() view returns (string)",
            "function symbol() view returns (string)",
            "function decimals() view returns (uint8)"
          ], provider);

          const [name, symbol, decimals] = await Promise.all([
            erc20.name().catch(() => "Unknown Token"),
            erc20.symbol().catch(() => "UNKNOWN"),
            erc20.decimals().catch(() => 18)
          ]);

          t = await prisma.token.upsert({
            where: { address_chainId: { address: addr, chainId } },
            update: {},
            create: { address: addr, chainId, name, symbol, decimals: Number(decimals), pythFeedId: null }
          });
          this.tokenCache.set(cacheKey, t);
          logger.info(`✅ Seeded missing token metadata: ${t.symbol} on Chain ${chainId}`);
        }
        return t;
      };

      const tokenIn = await ensureToken(tokenInAddress);
      const tokenOut = await ensureToken(tokenOutAddress);

      // D. Amount Normalization — exact decimals, never parseFloat on a uint256.
      const normalizedAmountIn = normalizeAmount(amountIn, tokenIn.decimals);
      const normalizedAmountOut = normalizeAmount(amountOut, tokenOut.decimals);

      // E. Pyth Network Price Enrichment
      let amountUsd: import('decimal.js').Decimal | null = null;
      let solvedPrice = false;

      if (tokenIn.pythFeedId) {
        const priceIn = await pythService.getAssetPriceUsd(tokenIn.pythFeedId);
        if (priceIn !== null) {
          amountUsd = toUsd(normalizedAmountIn, priceIn);
          solvedPrice = true;
        }
      }

      if (!solvedPrice && tokenOut.pythFeedId) {
        const priceOut = await pythService.getAssetPriceUsd(tokenOut.pythFeedId);
        if (priceOut !== null) {
          amountUsd = toUsd(normalizedAmountOut, priceOut);
        }
      }

      // F. Sequential DB writes — NO transaction wrapper
      await prisma.wallet.upsert({
        where: { address_chainId: { address: sender, chainId } },
        update: { lastActiveBlock: blockNumber },
        create: { address: sender, chainId, txCountSent: 1, lastActiveBlock: blockNumber }
      }).catch(() => {});

      await prisma.wallet.upsert({
        where: { address_chainId: { address: recipient, chainId } },
        update: { lastActiveBlock: blockNumber },
        create: { address: recipient, chainId, txCountReceived: 1, lastActiveBlock: blockNumber }
      }).catch(() => {});

      const amountUsdDb = amountUsd ? toDbDecimal(amountUsd) : null;
      const swapRecord = await prisma.dexSwap.upsert({
        where: { txHash_logIndex_chainId: { txHash, logIndex, chainId } },
        update: { amountUsd: amountUsdDb },
        create: {
          txHash, logIndex, blockNumber,
          timestamp: new Date(timestamp * 1000),
          chainId, poolAddress, protocol, sender, recipient,
          tokenInAddress, tokenOutAddress,
          amountIn, amountOut,
          amountInNormalized: toDbDecimal(normalizedAmountIn),
          amountOutNormalized: toDbDecimal(normalizedAmountOut),
          amountUsd: amountUsdDb
        },
        include: { tokenIn: true, tokenOut: true }
      });

      // G. WebSocket Broadcast
      if (data.isLive !== false) {
        broadcastEvent('swap', {
          id: swapRecord.id,
          txHash: swapRecord.txHash,
          logIndex: swapRecord.logIndex,
          blockNumber: swapRecord.blockNumber,
          timestamp: swapRecord.timestamp.toISOString(),
          chainId: swapRecord.chainId,
          poolAddress: swapRecord.poolAddress,
          protocol: swapRecord.protocol,
          sender: swapRecord.sender,
          recipient: swapRecord.recipient,
          tokenInSymbol: swapRecord.tokenIn.symbol,
          tokenOutSymbol: swapRecord.tokenOut.symbol,
          amountIn: swapRecord.amountIn,
          amountOut: swapRecord.amountOut,
          amountInNormalized: swapRecord.amountInNormalized.toNumber(),
          amountOutNormalized: swapRecord.amountOutNormalized.toNumber(),
          amountUsd: swapRecord.amountUsd ? swapRecord.amountUsd.toNumber() : null
        });
      }

      // H. Evaluate DEX Swaps for Whale Alerts
      if (data.isLive !== false && swapRecord.amountUsd) {
        alertsService.evaluateWhaleAlert({
          chainId: swapRecord.chainId,
          tokenAddress: swapRecord.tokenInAddress,
          symbol: swapRecord.tokenIn.symbol,
          amountNormalized: swapRecord.amountInNormalized.toNumber(),
          amountUsd: swapRecord.amountUsd.toNumber(),
          txHash: swapRecord.txHash,
          fromAddress: swapRecord.sender,
          toAddress: swapRecord.recipient
        }).catch(err => logger.error('❌ Error evaluating swap whale alert:', err));
      }

    } catch (error: any) {
      logger.error(`❌ [Chain ${chainId}] Error resolving swap parameters: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    logger.info('📥 EventProcessor stopping (no-op)');
  }
}
export const eventProcessor = new EventProcessor();
export default eventProcessor;
