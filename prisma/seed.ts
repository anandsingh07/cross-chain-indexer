import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tokens = [
    // --- Ethereum Sepolia (Chain ID 11155111) ---
    {
      address: '0x7b79995e5f793a07bc00c21412e50ecae098e7f9'.toLowerCase(),
      chainId: 11155111,
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      pythFeedId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
    },
    {
      address: '0x94a60c8b8c860fc4004918e59e537f2237f3747c'.toLowerCase(),
      chainId: 11155111,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      pythFeedId: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a'
    },
    {
      address: '0xaA8E23Fb1079EA71e0a56F48a2aa51851D8433D0'.toLowerCase(),
      chainId: 11155111,
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      pythFeedId: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b'
    },
    {
      address: '0x29f2D40B0605204364af1a9e3add8ab15ee3606f'.toLowerCase(),
      chainId: 11155111,
      symbol: 'WBTC',
      name: 'Wrapped BTC',
      decimals: 8,
      pythFeedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'
    },

    // --- Base Sepolia (Chain ID 84532) ---
    {
      address: '0x4200000000000000000000000000000000000006'.toLowerCase(),
      chainId: 84532,
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      pythFeedId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace'
    },
    {
      address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e'.toLowerCase(),
      chainId: 84532,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      pythFeedId: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a'
    },
    {
      address: '0x8aa52d2f34731c261e411b7bc8eb64b07ab60324'.toLowerCase(),
      chainId: 84532,
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      pythFeedId: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b'
    },
    {
      address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'.toLowerCase(),
      chainId: 84532,
      symbol: 'WBTC',
      name: 'Wrapped BTC',
      decimals: 8,
      pythFeedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43'
    }
  ];

  const nftCollections = [
    {
      address: '0x1111111111111111111111111111111111111111'.toLowerCase(),
      chainId: 11155111,
      name: 'Sepolia Bored Apes',
      symbol: 'BAYC-S',
      type: 'ERC721'
    },
    {
      address: '0x2222222222222222222222222222222222222222'.toLowerCase(),
      chainId: 84532,
      name: 'Base Apes',
      symbol: 'BAPE',
      type: 'ERC721'
    }
  ];

  console.log('🌱 Starting database seeding...');

  // 1. Seed ERC-20 Tokens
  for (const token of tokens) {
    const upserted = await prisma.token.upsert({
      where: {
        address_chainId: {
          address: token.address,
          chainId: token.chainId
        }
      },
      update: token,
      create: token,
    });
    console.log(`✅ Seeded token: ${upserted.symbol} on Chain ${upserted.chainId}`);
  }

  // 2. Seed NFT Collections
  for (const nft of nftCollections) {
    const upserted = await prisma.nftCollection.upsert({
      where: {
        address_chainId: {
          address: nft.address,
          chainId: nft.chainId
        }
      },
      update: nft,
      create: nft,
    });
    console.log(`✅ Seeded NFT Collection: ${upserted.name} (${upserted.symbol}) on Chain ${upserted.chainId}`);
  }

  // 3. Seed Default Alert Rules
  const defaultRules = [
    {
      name: 'Sepolia WETH Whale Alert',
      type: 'WHALE',
      chainId: 11155111,
      tokenAddress: '0x7b79995e5f793a07bc00c21412e50ecae098e7f9'.toLowerCase(),
      thresholdUsd: 10000.0,
      recipientTelegram: null
    },
    {
      name: 'Base WETH Whale Alert',
      type: 'WHALE',
      chainId: 84532,
      tokenAddress: '0x4200000000000000000000000000000000000006'.toLowerCase(),
      thresholdUsd: 5000.0,
      recipientTelegram: null
    }
  ];

  // Delete existing rules to ensure fresh seed
  await prisma.alertRule.deleteMany();
  console.log('🧹 Cleared existing Alert Rules for fresh seeding.');

  for (const rule of defaultRules) {
    const created = await prisma.alertRule.create({
      data: {
        name: rule.name,
        type: rule.type,
        chainId: rule.chainId,
        tokenAddress: rule.tokenAddress,
        thresholdUsd: rule.thresholdUsd,
        recipientTelegram: rule.recipientTelegram,
        isActive: true
      }
    });
    console.log(`✅ Seeded Alert Rule: ${created.name}`);
  }

  console.log('🌱 Seeding finished successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
