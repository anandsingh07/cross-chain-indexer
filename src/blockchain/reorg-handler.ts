import { ethers } from 'ethers';
import prisma from '../db/index.js';
import { logger } from '../utils/logger.js';
import { alertsService } from '../services/alerts.js';
import { reorgsTotal } from '../observability/metrics.js';

export class ReorgHandler {
  private provider: ethers.JsonRpcProvider;
  private chainId: number;
  private maxHistoryDepth = 100; // sliding history buffer depth
  private processedBlocksCache: Set<number> = new Set();

  constructor(provider: ethers.JsonRpcProvider, chainId: number) {
    this.provider = provider;
    this.chainId = chainId;
  }

  /**
   * Evaluates the block hash structure for reorgs on the specific chain.
   * Returns true if correct, or false if a rollback occurred.
   */
  async checkAndTrackBlock(blockNumber: number, blockHash: string, parentHash: string): Promise<boolean> {
    if (this.processedBlocksCache.has(blockNumber)) {
      return true; // Already checked and tracked recently
    }

    // Add to cache synchronously to prevent race conditions when hundreds of logs from the same block arrive concurrently
    this.processedBlocksCache.add(blockNumber);
    if (this.processedBlocksCache.size > 200) {
      const firstItem = this.processedBlocksCache.values().next().value;
      if (firstItem !== undefined) {
        this.processedBlocksCache.delete(firstItem);
      }
    }

    try {
      const previousBlockNumber = blockNumber - 1;
      const dbPrevBlock = await prisma.blockHistory.findUnique({
        where: {
          blockNumber_chainId: {
            blockNumber: previousBlockNumber,
            chainId: this.chainId
          }
        }
      });

      if (!dbPrevBlock) {
        // First block checked or history gap. Record and continue.
        await this.recordBlock(blockNumber, blockHash, parentHash);
        return true;
      }

      // Check for block reorganizations
      if (dbPrevBlock.blockHash.toLowerCase() === parentHash.toLowerCase()) {
        await this.recordBlock(blockNumber, blockHash, parentHash);
        await this.pruneBlockHistory(blockNumber - this.maxHistoryDepth);
        
        // Add to cache and keep cache size manageable
        this.processedBlocksCache.add(blockNumber);
        if (this.processedBlocksCache.size > 200) {
          const firstItem = this.processedBlocksCache.values().next().value;
          if (firstItem !== undefined) {
            this.processedBlocksCache.delete(firstItem);
          }
        }
        
        return true;
      }

      // Reorg detected!
      logger.warn(`⚠️ [Chain ${this.chainId}] Blockchain reorganization detected at block ${blockNumber}!`, {
        storedPrevHash: dbPrevBlock.blockHash,
        rpcParentHash: parentHash
      });
      
      reorgsTotal.inc({ chainId: this.chainId });
      await this.handleRollback(blockNumber, parentHash);
      return false;
    } catch (error) {
      logger.error(`❌ Error checking/tracking block reorg on chain ${this.chainId} block ${blockNumber}`, { error });
      throw error;
    }
  }

  private async recordBlock(blockNumber: number, blockHash: string, parentHash: string) {
    await prisma.blockHistory.upsert({
      where: {
        blockNumber_chainId: {
          blockNumber,
          chainId: this.chainId
        }
      },
      update: { blockHash, parentHash },
      create: { blockNumber, chainId: this.chainId, blockHash, parentHash }
    });
  }

  private async pruneBlockHistory(cutoffBlock: number) {
    try {
      await prisma.blockHistory.deleteMany({
        where: {
          chainId: this.chainId,
          blockNumber: { lt: cutoffBlock }
        }
      });
    } catch (error) {
      logger.error(`❌ Error pruning older block histories on chain ${this.chainId}`, { error });
    }
  }

  /**
   * Wipes database transfers, swaps, NFT events, and reverts sync checkpoints back to fork split block.
   */
  private async handleRollback(reorgBlockNumber: number, rpcParentHash: string) {
    let forkBlock = reorgBlockNumber - 1;
    let foundSplit = false;

    logger.info(`🔍 [Chain ${this.chainId}] Searching for the fork split point starting backwards from block ${forkBlock}...`);

    while (forkBlock > 0) {
      const dbBlock = await prisma.blockHistory.findUnique({
        where: {
          blockNumber_chainId: {
            blockNumber: forkBlock,
            chainId: this.chainId
          }
        }
      });

      if (!dbBlock) {
        forkBlock--;
        continue;
      }

      const rpcBlock = await this.provider.getBlock(forkBlock);
      if (!rpcBlock) {
        throw new Error(`Failed to fetch block ${forkBlock} from chain ${this.chainId} JSON-RPC during reorg lookup.`);
      }

      if (dbBlock.blockHash.toLowerCase() === rpcBlock.hash?.toLowerCase()) {
        foundSplit = true;
        break;
      }

      forkBlock--;
    }

    const splitBlock = foundSplit ? forkBlock : Math.max(0, reorgBlockNumber - 20);
    logger.warn(`🚨 [Chain ${this.chainId}] Fork split point identified at block ${splitBlock}. Commencing database transaction rollback...`);

    // Fetch transactions that are about to be deleted to revert metrics
    const transfersToDelete = await prisma.transfer.findMany({
      where: {
        chainId: this.chainId,
        blockNumber: { gt: splitBlock }
      }
    });

    await prisma.$transaction(async (tx) => {
      // 1. Revert wallet txCount metrics
      for (const transfer of transfersToDelete) {
        try {
          await tx.wallet.update({
            where: {
              address_chainId: {
                address: transfer.fromAddress,
                chainId: this.chainId
              }
            },
            data: { txCountSent: { decrement: 1 } }
          });
        } catch {}

        try {
          await tx.wallet.update({
            where: {
              address_chainId: {
                address: transfer.toAddress,
                chainId: this.chainId
              }
            },
            data: { txCountReceived: { decrement: 1 } }
          });
        } catch {}
      }

      // 2. Delete orphaned transfers
      const deletedTransfers = await tx.transfer.deleteMany({
        where: {
          chainId: this.chainId,
          blockNumber: { gt: splitBlock }
        }
      });

      // 3. Delete orphaned DEX swaps
      const deletedSwaps = await tx.dexSwap.deleteMany({
        where: {
          chainId: this.chainId,
          blockNumber: { gt: splitBlock }
        }
      });

      // 4. Delete orphaned NFT events
      const deletedNftEvents = await tx.nftEvent.deleteMany({
        where: {
          chainId: this.chainId,
          blockNumber: { gt: splitBlock }
        }
      });

      // 5. Delete orphaned histories
      await tx.blockHistory.deleteMany({
        where: {
          chainId: this.chainId,
          blockNumber: { gt: splitBlock }
        }
      });

      // 6. Reset Sync Checkpoint to the splitBlock
      await tx.syncCheckpoint.upsert({
        where: { chainId: this.chainId },
        update: { blockNumber: splitBlock },
        create: { chainId: this.chainId, blockNumber: splitBlock }
      });

      // 7. Add audit log entry
      await tx.processingLog.create({
        data: {
          level: 'WARN',
          message: `Chain ${this.chainId} Reorg Rollback Executed from block ${reorgBlockNumber} to split block ${splitBlock}`,
          context: JSON.stringify({
            chainId: this.chainId,
            reorgBlock: reorgBlockNumber,
            splitBlock,
            deletedTransfersCount: deletedTransfers.count,
            deletedSwapsCount: deletedSwaps.count,
            deletedNftEventsCount: deletedNftEvents.count
          })
        }
      });
    });

    logger.info(`✅ [Chain ${this.chainId}] Rollback complete. Resuming indexing pipeline starting from block ${splitBlock + 1}.`);

    // 8. Trigger Reorg alerts
    alertsService.triggerReorgAlert(
      this.chainId,
      reorgBlockNumber,
      splitBlock,
      transfersToDelete.length
    ).catch(err => logger.error(`❌ Error triggering reorg alert notification on Chain ${this.chainId}:`, err));
  }
}
export default ReorgHandler;
