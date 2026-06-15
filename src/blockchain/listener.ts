import { ethers } from 'ethers';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import prisma from '../db/index.js';
import { eventProcessor } from '../workers/event-worker.js';
import { ReorgHandler } from './reorg-handler.js';
import { createRedis, StreamProducer, type StreamEvent } from '../streaming/redis-stream.js';
import { blockLagGauge } from '../observability/metrics.js';

interface ChainConfig {
  chainId: number;
  name: string;
  wsUrl: string;
  httpUrl: string;
}

export class BlockchainListener {
  private chains: ChainConfig[] = [
    {
      chainId: 11155111,
      name: 'Ethereum Sepolia',
      wsUrl: env.RPC_WS_URL_SEPOLIA,
      httpUrl: env.RPC_HTTP_URL_SEPOLIA
    },
    {
      chainId: 84532,
      name: 'Base Sepolia',
      wsUrl: env.RPC_WS_URL_BASE_SEPOLIA,
      httpUrl: env.RPC_HTTP_URL_BASE_SEPOLIA
    }
  ];

  private providers: Map<number, {
    ws: ethers.WebSocketProvider;
    http: ethers.JsonRpcProvider;
    reorg: ReorgHandler;
    keepAliveInterval?: NodeJS.Timeout;
    pollInterval?: NodeJS.Timeout;
  }> = new Map();

  // Event sink: either the Redis Stream producer (decoupled, backpressured) or the legacy
  // in-process processor. Chosen by USE_STREAMING. This is the seam that turns the listener
  // from "decode + persist inline" into "decode + publish".
  private producer = env.USE_STREAMING ? new StreamProducer(createRedis()) : null;

  private async emit(event: StreamEvent): Promise<void> {
    if (this.producer) {
      await this.producer.publish(event);
    } else {
      await eventProcessor.processEvent(event as any);
    }
  }

  async start() {
    logger.info('🔌 Launching Multi-Chain Ingestion Listeners...');
    await Promise.all(this.chains.map(chain => this.connectChain(chain)));
  }

  private async connectChain(chain: ChainConfig) {
    try {
      logger.info(`🔌 Connecting to [Chain ${chain.chainId}] ${chain.name}...`);
      
      const http = new ethers.JsonRpcProvider(chain.httpUrl);
      const ws = new ethers.WebSocketProvider(chain.wsUrl);
      const reorg = new ReorgHandler(http, chain.chainId);

      // Attach an error handler SYNCHRONOUSLY. The WS starts connecting on construction and
      // can emit 'error' before setupChainListeners() runs — an unhandled 'error' event would
      // otherwise crash the whole process (e.g. a bad/unreachable RPC URL). This guard turns
      // it into a logged, recoverable failure.
      (ws.websocket as any).on('error', (err: any) => {
        logger.error(`❌ [Chain ${chain.chainId}] WebSocket error: ${err?.message ?? err}`);
      });

      const state = { ws, http, reorg };
      this.providers.set(chain.chainId, state);

      // 1. Dynamic Checkpoint Bootstrap (Zero-Gap Startup)
      const startBlock = await this.getStartBlock(chain.chainId, http);
      const currentBlock = await http.getBlockNumber();

      // 2. Sync Offline Gap first (historical block catch-up runs asynchronously in background)
      if (startBlock < currentBlock) {
        this.catchUpGaps(chain.chainId, startBlock, currentBlock, http).catch(err => {
          logger.error(`❌ [Chain ${chain.chainId}] Background gap sync failed:`, { error: err.message });
        });
      }

      // 3. Setup active stream listeners
      this.setupChainListeners(chain.chainId);
      this.startHeartbeat(chain.chainId);

      logger.info(`✅ [Chain ${chain.chainId}] Multi-event WebSocket sync successfully established.`);
    } catch (error: any) {
      logger.error(`❌ Failed to connect [Chain ${chain.chainId}] ${chain.name}. Retrying in 5s...`, { error: error.message });
      setTimeout(() => this.connectChain(chain), 5000);
    }
  }

  private async getStartBlock(chainId: number, httpProvider: ethers.JsonRpcProvider): Promise<number> {
    const existing = await prisma.syncCheckpoint.findUnique({
      where: { chainId }
    });

    if (existing) {
      logger.info(`🔄 [Chain ${chainId}] Checkpoint found in DB. Resuming sync from block #${existing.blockNumber}`);
      return existing.blockNumber;
    }

    // "From Current and Now" - First startup initializes checkcursor at current block height
    const currentBlock = await httpProvider.getBlockNumber();
    await prisma.syncCheckpoint.create({
      data: { chainId, blockNumber: currentBlock }
    });
    
    logger.info(`✨ [Chain ${chainId}] Initialized checkpoint cursor at current block height: #${currentBlock}`);
    return currentBlock;
  }

  private async catchUpGaps(chainId: number, startBlock: number, currentBlock: number, httpProvider: ethers.JsonRpcProvider) {
    const fallbacks: Record<number, string[]> = {
      11155111: [
        env.RPC_HTTP_URL_SEPOLIA,
        'https://ethereum-sepolia-rpc.publicnode.com',
        'https://sepolia.drpc.org'
      ],
      84532: [
        env.RPC_HTTP_URL_BASE_SEPOLIA,
        'https://sepolia.base.org',
        'https://base-sepolia.blockpi.network/v1/rpc/public'
      ]
    };

    const urls = fallbacks[chainId] || [];
    let currentProviderIndex = 0;
    let activeProvider = httpProvider;

    logger.info(`🔍 [Chain ${chainId}] Gap sync found: from block #${startBlock + 1} to #${currentBlock} (~${currentBlock - startBlock} blocks)`);
    
    // Crucial: Limit chunk size to 10 to prevent Render OOM (status 134) 
    // and satisfy Alchemy free tier 10-block limit for eth_getLogs.
    const chunkSize = 10;
    const topics = [
      [
        ethers.id('Transfer(address,address,uint256)'),
        ethers.id('TransferSingle(address,address,address,uint256,uint256)'),
        ethers.id('TransferBatch(address,address,address,uint256[],uint256[])'),
        ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)'),
        ethers.id('Swap(address,address,int256,int256,uint160,int24)')
      ]
    ];

    for (let from = startBlock + 1; from <= currentBlock; from += chunkSize) {
      const to = Math.min(from + chunkSize - 1, currentBlock);
      let success = false;
      let attempts = 0;

      while (!success && attempts < Math.max(2, urls.length * 2)) {
        attempts++;
        try {
          const providerUrl = urls[currentProviderIndex] || activeProvider._getConnection().url;
          logger.debug(`📥 [Chain ${chainId}] Querying block chunk #${from} - #${to} (Provider: ${providerUrl})...`);
          
          const logs = await activeProvider.getLogs({
            fromBlock: from,
            toBlock: to,
            topics
          });

          // Process logs sequentially with a microscopic delay to prevent CPU lock but allow extremely fast processing
          for (const log of logs) {
            await this.enqueueLog(chainId, log, activeProvider, false);
            await new Promise(resolve => setTimeout(resolve, 5)); // 5ms delay
          }

          await prisma.syncCheckpoint.update({
            where: { chainId },
            data: { blockNumber: to }
          });
          success = true;
        } catch (err: any) {
          if (urls.length > 0) {
            logger.warn(`⚠️ [Chain ${chainId}] Failed querying gaps with index ${currentProviderIndex}. Error: ${err.message}`);
            currentProviderIndex = (currentProviderIndex + 1) % urls.length;
            activeProvider = new ethers.JsonRpcProvider(urls[currentProviderIndex]);
          } else {
            logger.error(`❌ [Chain ${chainId}] Query failed: ${err.message}`);
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!success) {
        logger.error(`❌ [Chain ${chainId}] Exhausted all fallback RPC providers for block range #${from}-${to}. Skipping chunk to prevent infinite locking...`);
        await prisma.syncCheckpoint.update({
          where: { chainId },
          data: { blockNumber: to }
        }).catch(() => {});
      }

      // Brief pause between chunks to keep live listeners healthy
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    logger.info(`✨ [Chain ${chainId}] Gap synchronization complete.`);
  }

  private setupChainListeners(chainId: number) {
    const state = this.providers.get(chainId);
    if (!state) return;

    let lastPolledBlock = 0;

    // A. Start Periodic Block Polling Fallback (ensures BlockHistory & Reorgs populate robustly even if WebSockets are silent)
    state.pollInterval = setInterval(async () => {
      try {
        const currentBlock = await state.http.getBlockNumber();
        if (lastPolledBlock === 0) {
          lastPolledBlock = currentBlock - 1;
        }

        // Record how far behind head we are (0 when caught up). This metric was previously
        // declared but never set.
        blockLagGauge.set({ chainId }, Math.max(0, currentBlock - lastPolledBlock));

        if (currentBlock > lastPolledBlock) {
          for (let b = lastPolledBlock + 1; b <= currentBlock; b++) {
            const block = await state.http.getBlock(b);
            if (!block) continue;

            const isClean = await state.reorg.checkAndTrackBlock(
              b,
              block.hash!,
              block.parentHash
            );

            if (isClean) {
              logger.info(`🔗 [Chain ${chainId}] Block Synced (Poll Fallback): #${b} | Hash: ${block.hash}`);
              
              // Update Sync Checkpoint
              await prisma.syncCheckpoint.upsert({
                where: { chainId },
                update: { blockNumber: b },
                create: { chainId, blockNumber: b }
              }).catch(() => {});
            }
          }
          lastPolledBlock = currentBlock;
        }
      } catch (error: any) {
        logger.debug(`[Chain ${chainId}] Block polling check: ${error.message}`);
      }
    }, 12000); // 12s polling interval

    // 1. Live Block Header Listener (Reorg Tracker)
    state.ws.on('block', async (blockNumber: number) => {
      try {
        const block = await state.http.getBlock(blockNumber);
        if (!block) return;

        const isClean = await state.reorg.checkAndTrackBlock(
          blockNumber,
          block.hash!,
          block.parentHash
        );

        if (isClean) {
          logger.info(`🔗 [Chain ${chainId}] Block Synced: #${blockNumber} | Hash: ${block.hash}`);
          
          // Update Sync Checkpoint
          await prisma.syncCheckpoint.upsert({
            where: { chainId },
            update: { blockNumber },
            create: { chainId, blockNumber }
          });
        }
      } catch (error: any) {
        logger.error(`❌ [Chain ${chainId}] Error processing block header at #${blockNumber}`, { error: error.message });
      }
    });

    // 2. Global Event Signatures Filter Listener
    const filter = {
      topics: [[
        ethers.id('Transfer(address,address,uint256)'),
        ethers.id('TransferSingle(address,address,address,uint256,uint256)'),
        ethers.id('TransferBatch(address,address,address,uint256[],uint256[])'),
        ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)'),
        ethers.id('Swap(address,address,int256,int256,uint160,int24)')
      ]]
    };

    state.ws.on(filter, async (log: any) => {
      try {
        await this.enqueueLog(chainId, log, state.http);
      } catch (error: any) {
        logger.error(`❌ [Chain ${chainId}] Error parsing incoming log in WS subscription`, { error: error.message });
      }
    });

    // Reconnection Handlers
    (state.ws.websocket as any).on('close', () => {
      logger.warn(`🔌 [Chain ${chainId}] WebSocket connection terminated by server. Attempting reconnect...`);
      this.cleanup(chainId);
      setTimeout(() => this.reconnectChain(chainId), 5000);
    });

    (state.ws.websocket as any).on('error', (err: any) => {
      logger.error(`🔌 [Chain ${chainId}] WebSocket connection encountered error.`, { error: err.message });
      (state.ws.websocket as any).close();
    });
  }

  private async enqueueLog(chainId: number, log: any, httpProvider: ethers.JsonRpcProvider, isLive = true) {
    try {
      const txHash = log.transactionHash;
      const logIndex = log.index;
      const blockNumber = log.blockNumber;
      const contractAddress = log.address.toLowerCase();

      // Fetch block details for accurate timestamp
      const block = await httpProvider.getBlock(blockNumber);
      const timestamp = block ? block.timestamp : Math.floor(Date.now() / 1000);

      // Record block in BlockHistory to populate dashboard statistics immediately during catch-up
      if (block) {
        const state = this.providers.get(chainId);
        if (state?.reorg) {
          await state.reorg.checkAndTrackBlock(blockNumber, block.hash!, block.parentHash).catch(() => {});
        }
      }

      const topic0 = log.topics[0];

      // 1. ERC-20 or ERC-721 Transfer(address,address,uint256)
      if (topic0 === ethers.id('Transfer(address,address,uint256)')) {
        if (log.topics.length === 4) {
          // ERC-721 Transfer (4 topics: event hash, from, to, tokenId)
          const fromAddress = ethers.getAddress('0x' + log.topics[1].slice(26)).toLowerCase();
          const toAddress = ethers.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
          const tokenId = ethers.toBigInt(log.topics[3]).toString();

          await this.emit({
            type: 'NFT_EVENT',
            chainId,
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            contractAddress,
            nftType: 'ERC721',
            eventType: fromAddress === ethers.ZeroAddress.toLowerCase() ? 'MINT' : 
                       toAddress === ethers.ZeroAddress.toLowerCase() ? 'BURN' : 'TRANSFER',
            fromAddress,
            toAddress,
            tokenId,
            amount: '1',
            isLive
          });
        } else if (log.topics.length === 3) {
          // ERC-20 Transfer (3 topics: event hash, from, to)
          const fromAddress = ethers.getAddress('0x' + log.topics[1].slice(26)).toLowerCase();
          const toAddress = ethers.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
          const amount = ethers.toBigInt(log.data).toString();

          await this.emit({
            type: 'ERC20_TRANSFER',
            chainId,
            txHash,
            logIndex,
            blockNumber,
            timestamp,
            fromAddress,
            toAddress,
            tokenAddress: contractAddress,
            amount,
            isLive
          });
        }
      } 
      // 2. ERC-1155 TransferSingle
      else if (topic0 === ethers.id('TransferSingle(address,address,address,uint256,uint256)')) {
        const fromAddress = ethers.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
        const toAddress = ethers.getAddress('0x' + log.topics[3].slice(26)).toLowerCase();
        
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256'], log.data);
        const tokenId = decoded[0].toString();
        const amount = decoded[1].toString();

        await this.emit({
          type: 'NFT_EVENT',
          chainId,
          txHash,
          logIndex,
          blockNumber,
          timestamp,
          contractAddress,
          nftType: 'ERC1155',
          eventType: fromAddress === ethers.ZeroAddress.toLowerCase() ? 'MINT' :
                     toAddress === ethers.ZeroAddress.toLowerCase() ? 'BURN' : 'TRANSFER',
          fromAddress,
          toAddress,
          tokenId,
          amount,
          isLive
        });
      }
      // 3. ERC-1155 TransferBatch
      else if (topic0 === ethers.id('TransferBatch(address,address,address,uint256[],uint256[])')) {
        const fromAddress = ethers.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
        const toAddress = ethers.getAddress('0x' + log.topics[3].slice(26)).toLowerCase();

        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256[]', 'uint256[]'], log.data);
        const ids: bigint[] = decoded[0];
        const values: bigint[] = decoded[1];

        for (let i = 0; i < ids.length; i++) {
          await this.emit({
            type: 'NFT_EVENT',
            chainId,
            txHash,
            logIndex: logIndex * 1000 + i, // Offset batch events deterministically
            blockNumber,
            timestamp,
            contractAddress,
            nftType: 'ERC1155',
            eventType: fromAddress === ethers.ZeroAddress.toLowerCase() ? 'MINT' :
                       toAddress === ethers.ZeroAddress.toLowerCase() ? 'BURN' : 'TRANSFER',
            fromAddress,
            toAddress,
            tokenId: ids[i].toString(),
            amount: values[i].toString(),
            isLive
          });
        }
      }
      // 4. DEX Swap (Uniswap V2 / Aerodrome style Swap)
      else if (topic0 === ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)')) {
        const sender = ethers.getAddress('0x' + log.topics[1].slice(26)).toLowerCase();
        const recipient = ethers.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
        
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256', 'uint256', 'uint256'], log.data);
        const amount0In = decoded[0];
        const amount1In = decoded[1];
        const amount0Out = decoded[2];
        const amount1Out = decoded[3];

        await this.emit({
          type: 'DEX_SWAP',
          chainId,
          txHash,
          logIndex,
          blockNumber,
          timestamp,
          poolAddress: contractAddress,
          protocol: 'UNISWAP_V2',
          sender,
          recipient,
          tokenInAddress: '', // Resolved in the worker
          tokenOutAddress: '', // Resolved in the worker
          amountIn: (amount0In > 0n ? amount0In : amount1In).toString(),
          amountOut: (amount0Out > 0n ? amount0Out : amount1Out).toString(),
          isLive
        });
      }
      // 5. DEX Swap (Uniswap V3 Swap)
      else if (topic0 === ethers.id('Swap(address,address,int256,int256,uint160,int24)')) {
        const sender = ethers.getAddress('0x' + log.topics[1].slice(26)).toLowerCase();
        const recipient = ethers.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();

        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['int256', 'int256', 'uint160', 'int24'], log.data);
        const amount0 = decoded[0];
        const amount1 = decoded[1];

        const amountIn = (amount0 > 0n ? amount0 : (amount1 > 0n ? amount1 : 0n)).toString();
        const amountOut = (amount0 < 0n ? -amount0 : (amount1 < 0n ? -amount1 : 0n)).toString();

        await this.emit({
          type: 'DEX_SWAP',
          chainId,
          txHash,
          logIndex,
          blockNumber,
          timestamp,
          poolAddress: contractAddress,
          protocol: 'UNISWAP_V3',
          sender,
          recipient,
          tokenInAddress: '', // Resolved in the worker
          tokenOutAddress: '', // Resolved in the worker
          amountIn,
          amountOut,
          isLive
        });
      }
    } catch (error: any) {
      logger.error(`❌ [Chain ${chainId}] Error parsing event log details`, { error: error.message, log });
    }
  }

  private startHeartbeat(chainId: number) {
    const state = this.providers.get(chainId);
    if (!state) return;

    state.keepAliveInterval = setInterval(async () => {
      try {
        await state.ws.getBlockNumber();
      } catch {
        logger.warn(`🔌 [Chain ${chainId}] Heartbeat lost. Closing socket cleanly...`);
        state.ws.websocket.close();
      }
    }, 30000); // 30s interval
  }

  private async reconnectChain(chainId: number) {
    const config = this.chains.find(c => c.chainId === chainId);
    if (config) {
      await this.connectChain(config);
    }
  }

  private cleanup(chainId: number) {
    const state = this.providers.get(chainId);
    if (state) {
      if (state.keepAliveInterval) clearInterval(state.keepAliveInterval);
      if (state.pollInterval) clearInterval(state.pollInterval);
      try {
        state.ws.removeAllListeners();
      } catch {}
      this.providers.delete(chainId);
    }
  }

  async stop() {
    logger.info('🔌 Shutting down Blockchain Event Ingest Streamers...');
    for (const chainId of this.providers.keys()) {
      this.cleanup(chainId);
      const state = this.providers.get(chainId);
      if (state?.ws) {
        try {
          await state.ws.destroy();
        } catch {}
      }
    }
  }
}
export default BlockchainListener;
