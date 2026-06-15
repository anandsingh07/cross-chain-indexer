import prisma from '../db/index.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export class AlertsService {
  /**
   * Evaluates a processed ERC-20 transfer or DEX swap against active whale alert rules.
   * If a rule is triggered, enqueues/dispatches notifications instantly.
   */
  async evaluateWhaleAlert(params: {
    chainId: number;
    tokenAddress: string;
    symbol: string;
    amountNormalized: number;
    amountUsd: number;
    txHash: string;
    fromAddress: string;
    toAddress: string;
  }) {
    const { chainId, tokenAddress, symbol, amountNormalized, amountUsd, txHash, fromAddress, toAddress } = params;

    try {
      // Find matching active whale rules
      const activeRules = await prisma.alertRule.findMany({
        where: {
          type: 'WHALE',
          isActive: true,
          AND: [
            {
              OR: [
                { chainId: null },
                { chainId }
              ]
            },
            {
              OR: [
                { tokenAddress: null },
                { tokenAddress: tokenAddress.toLowerCase() }
              ]
            }
          ],
          thresholdUsd: {
            lte: amountUsd
          }
        }
      });

      if (activeRules.length === 0) return;

      logger.info(`🚨 [Chain ${chainId}] Whale movement triggered ${activeRules.length} alert rule(s)! Amount: $${amountUsd.toFixed(2)}`);

      const chainName = chainId === 11155111 ? 'Ethereum Sepolia' : 'Base Sepolia';
      const explorerUrl = chainId === 11155111 
        ? `https://sepolia.etherscan.io/tx/${txHash}` 
        : `https://sepolia.basescan.org/tx/${txHash}`;

      // Build alert message
      const textMessage = `🚨 <b>WHALE TRANSACTION ALERT</b> 🚨\n\n` +
        `<b>Network:</b> ${chainName}\n` +
        `<b>Asset:</b> ${amountNormalized.toLocaleString()} ${symbol} ($${amountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD)\n` +
        `<b>From:</b> <code>${fromAddress}</code>\n` +
        `<b>To:</b> <code>${toAddress}</code>\n` +
        `<b>Explorer:</b> <a href="${explorerUrl}">View Transaction</a>`;

      for (const rule of activeRules) {
        await this.dispatchAlert(rule, textMessage);
      }
    } catch (error: any) {
      logger.error('❌ Error evaluating whale alert rule:', { error: error.message });
    }
  }

  /**
   * Evaluates a chain reorganization rollback event and broadcasts alerts.
   */
  async triggerReorgAlert(chainId: number, forkBlock: number, splitBlock: number, deletedCount: number) {
    try {
      const activeRules = await prisma.alertRule.findMany({
        where: {
          type: 'REORG',
          isActive: true
        }
      });

      if (activeRules.length === 0) return;

      const chainName = chainId === 11155111 ? 'Ethereum Sepolia' : 'Base Sepolia';
      const textMessage = `🚨 <b>CHAIN REORG ALERT</b> 🚨\n\n` +
        `<b>Network:</b> ${chainName}\n` +
        `<b>Reorg Block Height:</b> #${forkBlock}\n` +
        `<b>Fork Split Point:</b> #${splitBlock}\n` +
        `<b>Wiped Transactions Count:</b> ${deletedCount} records\n` +
        `<b>Severity:</b> HIGH (Resyncing cursor successfully completed)`;

      for (const rule of activeRules) {
        await this.dispatchAlert(rule, textMessage);
      }
    } catch (error: any) {
      logger.error('❌ Error triggering reorg alert notifications:', { error: error.message });
    }
  }

  /**
   * Dispatches alerts over active channels (Telegram Only).
   * Features a beautiful console fallback if keys are missing.
   */
  private async dispatchAlert(rule: any, message: string) {
    const telegramChat = rule.recipientTelegram || env.TELEGRAM_CHAT_ID;
    let telegramStatus = 'SKIPPED';

    // 1. Send Telegram Notification
    if (env.TELEGRAM_BOT_TOKEN && telegramChat) {
      try {
        const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChat,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: false
          })
        });

        if (res.ok) {
          telegramStatus = 'SUCCESS';
        } else {
          const errText = await res.text();
          logger.error(`❌ Telegram sendMessage returned error status ${res.status}: ${errText}`);
          telegramStatus = 'FAILED';
        }
      } catch (err: any) {
        logger.error('❌ Telegram dispatcher failed:', { error: err.message });
        telegramStatus = 'FAILED';
      }
    } else {
      // Console Fallback Developer-Experience
      logger.info(`📝 [MOCK TELEGRAM ALERT] Rule "${rule.name}" triggered:\n${message.replace(/<[^>]*>/g, '')}`);
      telegramStatus = 'MOCK_SUCCESS';
    }

    // Log the notification events inside AlertLog
    try {
      await prisma.alertLog.create({
        data: {
          ruleId: rule.id,
          type: rule.type,
          message: message,
          recipient: `Telegram: ${telegramChat || 'Console'}`,
          status: telegramStatus.includes('SUCCESS') ? 'SUCCESS' : 'FAILED'
        }
      });
    } catch (err: any) {
      logger.error('❌ Failed creating AlertLog database record:', { error: err.message });
    }
  }
}

export const alertsService = new AlertsService();
export default alertsService;
