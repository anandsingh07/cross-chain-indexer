import prisma from '../db/index.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Calculates the exact milliseconds remaining until the next midnight (00:00:00).
 */
function getMsUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1, // Tomorrow
    0, 0, 0, 0 // 00:00:00.000
  );
  return midnight.getTime() - now.getTime();
}

export class DataPruner {
  private timeoutId?: NodeJS.Timeout;
  private intervalId?: NodeJS.Timeout;

  start() {
    logger.info('🧼 Data Retention Pruner Service initialized.');
    
    // In local development, execute an audit immediately to verify query speed & logic
    if (env.NODE_ENV === 'development') {
      logger.info('🧼 Running initial dev database pruning audit...');
      this.pruneData().catch(err => {
        logger.error('❌ Initial dev database pruning audit failed:', { error: err.message });
      });
    }

    const msUntilMidnight = getMsUntilMidnight();
    const minutesUntilMidnight = Math.round(msUntilMidnight / 1000 / 60);
    logger.info(`🧼 Scheduled pruning set to run in ${minutesUntilMidnight} minutes (at midnight 00:00).`);

    // Schedule the first run at midnight
    this.timeoutId = setTimeout(() => {
      this.pruneData().catch(err => {
        logger.error('❌ Scheduled midnight database pruning failed:', { error: err.message });
      });

      // Setup a recurring 24-hour interval trigger going forward
      this.intervalId = setInterval(() => {
        this.pruneData().catch(err => {
          logger.error('❌ Scheduled daily database pruning failed:', { error: err.message });
        });
      }, 24 * 60 * 60 * 1000); // 24 hours
    }, msUntilMidnight);
  }

  /**
   * Performs the atomic bulk deletion transaction of records older than 30 days.
   * Cleans transfers, swaps, NFT logs, alert audits, block history and DLQ logs.
   */
  async pruneData() {
    const retentionWindowDays = 30;
    const cutoff = new Date(Date.now() - retentionWindowDays * 24 * 60 * 60 * 1000);
    logger.info(`🧼 Starting database pruning. Cutoff target date: ${cutoff.toISOString()}`);

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Delete old ERC-20 transfers
        const deletedTransfers = await tx.transfer.deleteMany({
          where: { timestamp: { lt: cutoff } }
        });

        // 2. Delete old DEX swaps
        const deletedSwaps = await tx.dexSwap.deleteMany({
          where: { timestamp: { lt: cutoff } }
        });

        // 3. Delete old NFT logs
        const deletedNftEvents = await tx.nftEvent.deleteMany({
          where: { timestamp: { lt: cutoff } }
        });

        // 4. Delete old Block Histories (prevent sliding scale hash leaks)
        const deletedBlockHistory = await tx.blockHistory.deleteMany({
          where: { createdAt: { lt: cutoff } }
        });

        // 5. Delete old Alert logs
        const deletedAlertLogs = await tx.alertLog.deleteMany({
          where: { createdAt: { lt: cutoff } }
        });

        // 6. Delete old processing logs (DLQs)
        const deletedProcessingLogs = await tx.processingLog.deleteMany({
          where: { createdAt: { lt: cutoff } }
        });

        logger.info('✅ Database retention pruning completed successfully.', {
          deletedTransfers: deletedTransfers.count,
          deletedSwaps: deletedSwaps.count,
          deletedNftEvents: deletedNftEvents.count,
          deletedBlockHistory: deletedBlockHistory.count,
          deletedAlertLogs: deletedAlertLogs.count,
          deletedProcessingLogs: deletedProcessingLogs.count
        });

        // Create audit trail entry
        await tx.processingLog.create({
          data: {
            level: 'INFO',
            message: `Midnight database retention pruning executed successfully. Wiped records older than ${cutoff.toISOString()}`,
            context: JSON.stringify({
              deletedTransfers: deletedTransfers.count,
              deletedSwaps: deletedSwaps.count,
              deletedNftEvents: deletedNftEvents.count,
              deletedBlockHistory: deletedBlockHistory.count,
              deletedAlertLogs: deletedAlertLogs.count,
              deletedProcessingLogs: deletedProcessingLogs.count
            })
          }
        });
      });
    } catch (error: any) {
      logger.error('❌ Database retention pruning transaction failed:', { error: error.message });
      throw error;
    }
  }

  stop() {
    logger.info('🧼 Stopping Data Retention Pruner Service...');
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.intervalId) clearInterval(this.intervalId);
  }
}

export const pruner = new DataPruner();
export default pruner;
