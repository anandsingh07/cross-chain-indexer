import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import prisma from '../db/index.js';
import { priceCacheTotal } from '../observability/metrics.js';

export class PythService {
  private hermesUrl: string;
  private cacheTtl = 300;

  constructor() {
    this.hermesUrl = env.PYTH_HERMES_URL;
  }

  async getAssetPriceUsd(pythFeedId: string): Promise<number | null> {
    const cleanFeedId = pythFeedId.toLowerCase().startsWith('0x') 
      ? pythFeedId.substring(2).toLowerCase() 
      : pythFeedId.toLowerCase();

    try {
      const cached = await prisma.priceCache.findUnique({
        where: { feedId: cleanFeedId }
      });

      if (cached && cached.expiresAt > new Date()) {
        priceCacheTotal.inc({ result: 'hit' });
        return cached.price.toNumber();
      }
      priceCacheTotal.inc({ result: 'miss' });

      const url = `${this.hermesUrl}/v2/updates/price/latest?ids[]=0x${cleanFeedId}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        logger.error(`❌ Pyth Hermes HTTP returned status ${response.status}`, { feed: pythFeedId });
        if (cached) {
          logger.warn(`⚠️ Pyth Hermes offline. Using expired cached price: $${cached.price}`);
          return cached.price.toNumber();
        }
        return null;
      }

      const data: any = await response.json();
      if (!data.parsed || data.parsed.length === 0) {
        logger.warn(`⚠️ Pyth feed metadata returned no parsed arrays`, { feed: pythFeedId });
        if (cached) return cached.price.toNumber();
        return null;
      }

      const priceData = data.parsed[0].price;
      const rawPrice = BigInt(priceData.price);
      const expo = priceData.expo;

      const price = Number(rawPrice) * Math.pow(10, expo);

      await prisma.priceCache.upsert({
        where: { feedId: cleanFeedId },
        update: {
          price,
          expiresAt: new Date(Date.now() + this.cacheTtl * 1000)
        },
        create: {
          feedId: cleanFeedId,
          price,
          expiresAt: new Date(Date.now() + this.cacheTtl * 1000)
        }
      });
      
      logger.debug(`🎯 Pyth Oracle Price Resolved and Cached [${pythFeedId}]: $${price}`);
      return price;
    } catch (error: any) {
      logger.error(`❌ Error parsing Pyth pricing for feed ${pythFeedId}`, { error: error.message });
      return null;
    }
  }
}

export const pythService = new PythService();
export default pythService;
