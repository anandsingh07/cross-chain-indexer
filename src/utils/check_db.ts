import prisma from '../db/index.js';

async function run() {
  console.log('📊 Querying database stats...');
  
  const transfersCount = await prisma.transfer.count();
  const swapsCount = await prisma.dexSwap.count();
  const nftEventsCount = await prisma.nftEvent.count();
  const walletsCount = await prisma.wallet.count();
  const tokensCount = await prisma.token.count();
  const alertLogsCount = await prisma.alertLog.count();

  console.log(`- Transfers: ${transfersCount}`);
  console.log(`- DEX Swaps: ${swapsCount}`);
  console.log(`- NFT Events: ${nftEventsCount}`);
  console.log(`- Wallets: ${walletsCount}`);
  console.log(`- Tokens: ${tokensCount}`);
  console.log(`- Alert Logs: ${alertLogsCount}`);

  // Query latest transfers
  const latestTransfers = await prisma.transfer.findMany({
    take: 5,
    orderBy: { timestamp: 'desc' },
    include: { token: true }
  });

  console.log('\n📈 Latest 5 Transfers:');
  for (const t of latestTransfers) {
    console.log(`- [${t.chainId}] ${t.fromAddress} -> ${t.toAddress} | amount: ${t.normalizedAmount} ${t.token.symbol} | Tx: ${t.txHash.substring(0, 15)}...`);
  }

  // Query specific mock transfers
  const mockWhale = await prisma.transfer.findFirst({
    where: { txHash: '0xabcde11111111111111111111111111111111111111111111111111111111111' }
  });

  if (mockWhale) {
    console.log('\n🐳 Mock Whale Transfer Found in DB!');
    console.log(`- Amount: ${mockWhale.normalizedAmount} | USD Value: ${mockWhale.usdValue}`);
  } else {
    console.log('\nℹ️ Mock Whale Transfer not yet in DB.');
  }

  // Query alert logs
  const logs = await prisma.alertLog.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' }
  });

  console.log('\n🚨 Latest Alert Logs:');
  for (const l of logs) {
    console.log(`- RuleId: ${l.ruleId} | Type: ${l.type} | Recipient: ${l.recipient} | Status: ${l.status}`);
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
