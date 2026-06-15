import prisma from '../db/index.js';

export class AnalyticsService {
  /**
   * Fetches paginated transfer history for a specific wallet address on a specific chain (optional).
   */
  async getWalletHistory(address: string, limit = 20, cursor?: string, chainId?: number) {
    const cleanAddress = address.toLowerCase();
    
    return prisma.transfer.findMany({
      where: {
        chainId: chainId ? chainId : undefined,
        OR: [
          { fromAddress: cleanAddress },
          { toAddress: cleanAddress }
        ]
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      include: { token: true }
    });
  }

  /**
   * Fetches paginated transfers for a specific token address.
   */
  async getTokenTransfers(tokenAddress: string, limit = 20, cursor?: string, chainId?: number) {
    const cleanToken = tokenAddress.toLowerCase();

    return prisma.transfer.findMany({
      where: {
        tokenAddress: cleanToken,
        chainId: chainId ? chainId : undefined
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      include: { token: true }
    });
  }

  /**
   * Retrieves wallets ranked by total transactional volume counts on a specific chain (optional).
   */
  async getTopWallets(limit = 10, chainId?: number) {
    return prisma.wallet.findMany({
      where: {
        chainId: chainId ? chainId : undefined
      },
      orderBy: [
        { txCountSent: 'desc' },
        { txCountReceived: 'desc' }
      ],
      take: limit
    });
  }

  /**
   * Aggregates total token transaction counts and USD volumes over a sliding hour window.
   */
  async getVolumeStats(tokenAddress?: string, periodHours = 24, chainId?: number) {
    const cutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000);
    const cleanToken = tokenAddress?.toLowerCase();

    const aggregations = await prisma.transfer.groupBy({
      by: ['tokenAddress', 'chainId'],
      where: {
        timestamp: { gte: cutoff },
        tokenAddress: cleanToken ? cleanToken : undefined,
        chainId: chainId ? chainId : undefined,
      },
      _sum: {
        normalizedAmount: true,
        usdValue: true,
      },
      _count: {
        id: true
      }
    });

    // Populate token metadata names/symbols
    const enriched = await Promise.all(
      aggregations.map(async (agg) => {
        const token = await prisma.token.findUnique({
          where: {
            address_chainId: {
              address: agg.tokenAddress,
              chainId: agg.chainId
            }
          }
        });
        
        return {
          tokenAddress: agg.tokenAddress,
          chainId: agg.chainId,
          symbol: token?.symbol || 'UNKNOWN',
          name: token?.name || 'Unknown Token',
          decimals: token?.decimals || 18,
          txCount: agg._count.id,
          totalNormalizedAmount: agg._sum.normalizedAmount || 0,
          totalUsdVolume: agg._sum.usdValue || 0,
        };
      })
    );

    return enriched;
  }

  /**
   * Fetches paginated DEX swaps with robust multi-chain filters (NEW).
   */
  async getSwaps(limit = 20, cursor?: string, poolAddress?: string, chainId?: number, tokenAddress?: string) {
    const cleanPool = poolAddress?.toLowerCase();
    const cleanToken = tokenAddress?.toLowerCase();

    return prisma.dexSwap.findMany({
      where: {
        chainId: chainId ? chainId : undefined,
        poolAddress: cleanPool ? cleanPool : undefined,
        OR: cleanToken ? [
          { tokenInAddress: cleanToken },
          { tokenOutAddress: cleanToken }
        ] : undefined
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      include: {
        tokenIn: true,
        tokenOut: true
      }
    });
  }

  /**
   * Fetches paginated NFT collection events with filters (NEW).
   */
  async getNftEvents(limit = 20, cursor?: string, contractAddress?: string, chainId?: number, type?: string) {
    const cleanContract = contractAddress?.toLowerCase();

    return prisma.nftEvent.findMany({
      where: {
        chainId: chainId ? chainId : undefined,
        contractAddress: cleanContract ? cleanContract : undefined,
        type: type ? type : undefined
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      include: {
        collection: true
      }
    });
  }

  /**
   * Wallets ranked by received-transaction count (companion to getTopWallets, which ranks
   * by sent). Used by the dashboard "Top Active Receiver" card.
   */
  async getTopReceivers(limit = 10, chainId?: number) {
    return prisma.wallet.findMany({
      where: { chainId: chainId ? chainId : undefined },
      orderBy: [{ txCountReceived: 'desc' }, { txCountSent: 'desc' }],
      take: limit,
    });
  }

  /**
   * Events-per-minute across all event types over a recent window. Powers the dashboard
   * "Event Flow" rate (previously a hardcoded "12.4 e/m").
   */
  async getEventRate(windowMinutes = 5, chainId?: number): Promise<number> {
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
    const where = {
      timestamp: { gte: cutoff },
      chainId: chainId ? chainId : undefined,
    };
    const [transfers, swaps, nfts] = await Promise.all([
      prisma.transfer.count({ where }),
      prisma.dexSwap.count({ where }),
      prisma.nftEvent.count({ where }),
    ]);
    const total = transfers + swaps + nfts;
    return Number((total / windowMinutes).toFixed(2));
  }

  /**
   * Mean USD value of transfers over a window. Previously a hardcoded "$4,850.20".
   * Returns null when no priced transfers exist (common on testnets).
   */
  async getMeanTransferUsd(periodHours = 24, chainId?: number): Promise<number | null> {
    const cutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000);
    const agg = await prisma.transfer.aggregate({
      where: {
        timestamp: { gte: cutoff },
        chainId: chainId ? chainId : undefined,
        usdValue: { not: null },
      },
      _avg: { usdValue: true },
    });
    return agg._avg.usdValue ? Number(agg._avg.usdValue) : null;
  }

  /**
   * Distribution of DEX swaps by trading pair over a window, as counts + percentages.
   * Powers the "Active Pairs" pie chart (previously hardcoded).
   */
  async getSwapPairDistribution(periodHours = 24, chainId?: number) {
    const cutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000);
    const grouped = await prisma.dexSwap.groupBy({
      by: ['tokenInAddress', 'tokenOutAddress', 'chainId'],
      where: { timestamp: { gte: cutoff }, chainId: chainId ? chainId : undefined },
      _count: { id: true },
    });

    const total = grouped.reduce((sum, g) => sum + g._count.id, 0);
    const enriched = await Promise.all(
      grouped.map(async (g) => {
        const [tokenIn, tokenOut] = await Promise.all([
          prisma.token.findUnique({
            where: { address_chainId: { address: g.tokenInAddress, chainId: g.chainId } },
          }),
          prisma.token.findUnique({
            where: { address_chainId: { address: g.tokenOutAddress, chainId: g.chainId } },
          }),
        ]);
        return {
          pair: `${tokenIn?.symbol ?? 'UNKNOWN'}/${tokenOut?.symbol ?? 'UNKNOWN'}`,
          chainId: g.chainId,
          count: g._count.id,
          percentage: total > 0 ? Number(((g._count.id / total) * 100).toFixed(2)) : 0,
        };
      })
    );
    return enriched.sort((a, b) => b.count - a.count);
  }

  /**
   * Per-collection NFT sale/mint counts. Powers the "Collection Valuation" cards
   * (sales/mints counts are real; floor-price gains are NOT tracked and were removed).
   */
  async getNftCollectionStats(chainId?: number) {
    const grouped = await prisma.nftEvent.groupBy({
      by: ['contractAddress', 'chainId', 'type'],
      where: { chainId: chainId ? chainId : undefined },
      _count: { id: true },
    });

    // Roll up by collection.
    const byCollection = new Map<string, { contractAddress: string; chainId: number; mints: number; transfers: number; burns: number }>();
    for (const g of grouped) {
      const key = `${g.chainId}-${g.contractAddress}`;
      const entry = byCollection.get(key) ?? {
        contractAddress: g.contractAddress, chainId: g.chainId, mints: 0, transfers: 0, burns: 0,
      };
      if (g.type === 'MINT') entry.mints += g._count.id;
      else if (g.type === 'BURN') entry.burns += g._count.id;
      else entry.transfers += g._count.id;
      byCollection.set(key, entry);
    }

    return Promise.all(
      [...byCollection.values()].map(async (c) => {
        const collection = await prisma.nftCollection.findUnique({
          where: { address_chainId: { address: c.contractAddress, chainId: c.chainId } },
        });
        return {
          ...c,
          name: collection?.name ?? 'Unknown Collection',
          symbol: collection?.symbol ?? 'NFT',
          total: c.mints + c.transfers + c.burns,
        };
      })
    );
  }
}

export const analyticsService = new AnalyticsService();
export default analyticsService;
