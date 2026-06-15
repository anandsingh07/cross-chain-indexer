-- CreateTable
CREATE TABLE "Token" (
    "address" VARCHAR(42) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "decimals" INTEGER NOT NULL,
    "pythFeedId" VARCHAR(66),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("address","chainId")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "address" VARCHAR(42) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txCountSent" INTEGER NOT NULL DEFAULT 0,
    "txCountReceived" INTEGER NOT NULL DEFAULT 0,
    "lastActiveBlock" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("address","chainId")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "fromAddress" VARCHAR(42) NOT NULL,
    "toAddress" VARCHAR(42) NOT NULL,
    "tokenAddress" VARCHAR(42) NOT NULL,
    "amount" VARCHAR(78) NOT NULL,
    "normalizedAmount" DECIMAL(36,18) NOT NULL,
    "usdValue" DECIMAL(18,6),

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DexSwap" (
    "id" TEXT NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "poolAddress" VARCHAR(42) NOT NULL,
    "protocol" VARCHAR(20) NOT NULL,
    "sender" VARCHAR(42) NOT NULL,
    "recipient" VARCHAR(42) NOT NULL,
    "tokenInAddress" VARCHAR(42) NOT NULL,
    "tokenOutAddress" VARCHAR(42) NOT NULL,
    "amountIn" VARCHAR(78) NOT NULL,
    "amountOut" VARCHAR(78) NOT NULL,
    "amountInNormalized" DECIMAL(36,18) NOT NULL,
    "amountOutNormalized" DECIMAL(36,18) NOT NULL,
    "amountUsd" DECIMAL(18,6),

    CONSTRAINT "DexSwap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NftCollection" (
    "address" VARCHAR(42) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NftCollection_pkey" PRIMARY KEY ("address","chainId")
);

-- CreateTable
CREATE TABLE "NftEvent" (
    "id" TEXT NOT NULL,
    "txHash" VARCHAR(66) NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" VARCHAR(42) NOT NULL,
    "type" VARCHAR(15) NOT NULL,
    "fromAddress" VARCHAR(42) NOT NULL,
    "toAddress" VARCHAR(42) NOT NULL,
    "tokenId" VARCHAR(78) NOT NULL,
    "amount" VARCHAR(78) NOT NULL,
    "priceUsd" DECIMAL(18,6),

    CONSTRAINT "NftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCheckpoint" (
    "chainId" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCheckpoint_pkey" PRIMARY KEY ("chainId")
);

-- CreateTable
CREATE TABLE "BlockHistory" (
    "blockNumber" INTEGER NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockHash" VARCHAR(66) NOT NULL,
    "parentHash" VARCHAR(66) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockHistory_pkey" PRIMARY KEY ("blockNumber","chainId")
);

-- CreateTable
CREATE TABLE "ProcessingLog" (
    "id" TEXT NOT NULL,
    "level" VARCHAR(10) NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessingLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "chainId" INTEGER,
    "tokenAddress" VARCHAR(42),
    "thresholdUsd" DECIMAL(18,6),
    "recipientTelegram" VARCHAR(100),
    "recipientEmail" VARCHAR(255),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertLog" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "message" TEXT NOT NULL,
    "recipient" VARCHAR(255) NOT NULL,
    "status" VARCHAR(15) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transfer_fromAddress_idx" ON "Transfer"("fromAddress");

-- CreateIndex
CREATE INDEX "Transfer_toAddress_idx" ON "Transfer"("toAddress");

-- CreateIndex
CREATE INDEX "Transfer_tokenAddress_idx" ON "Transfer"("tokenAddress");

-- CreateIndex
CREATE INDEX "Transfer_blockNumber_idx" ON "Transfer"("blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_txHash_logIndex_chainId_key" ON "Transfer"("txHash", "logIndex", "chainId");

-- CreateIndex
CREATE INDEX "DexSwap_tokenInAddress_idx" ON "DexSwap"("tokenInAddress");

-- CreateIndex
CREATE INDEX "DexSwap_tokenOutAddress_idx" ON "DexSwap"("tokenOutAddress");

-- CreateIndex
CREATE INDEX "DexSwap_sender_idx" ON "DexSwap"("sender");

-- CreateIndex
CREATE INDEX "DexSwap_recipient_idx" ON "DexSwap"("recipient");

-- CreateIndex
CREATE INDEX "DexSwap_blockNumber_idx" ON "DexSwap"("blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DexSwap_txHash_logIndex_chainId_key" ON "DexSwap"("txHash", "logIndex", "chainId");

-- CreateIndex
CREATE INDEX "NftEvent_contractAddress_idx" ON "NftEvent"("contractAddress");

-- CreateIndex
CREATE INDEX "NftEvent_fromAddress_idx" ON "NftEvent"("fromAddress");

-- CreateIndex
CREATE INDEX "NftEvent_toAddress_idx" ON "NftEvent"("toAddress");

-- CreateIndex
CREATE INDEX "NftEvent_blockNumber_idx" ON "NftEvent"("blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "NftEvent_txHash_logIndex_chainId_key" ON "NftEvent"("txHash", "logIndex", "chainId");

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromAddress_chainId_fkey" FOREIGN KEY ("fromAddress", "chainId") REFERENCES "Wallet"("address", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toAddress_chainId_fkey" FOREIGN KEY ("toAddress", "chainId") REFERENCES "Wallet"("address", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_tokenAddress_chainId_fkey" FOREIGN KEY ("tokenAddress", "chainId") REFERENCES "Token"("address", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DexSwap" ADD CONSTRAINT "DexSwap_tokenInAddress_chainId_fkey" FOREIGN KEY ("tokenInAddress", "chainId") REFERENCES "Token"("address", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DexSwap" ADD CONSTRAINT "DexSwap_tokenOutAddress_chainId_fkey" FOREIGN KEY ("tokenOutAddress", "chainId") REFERENCES "Token"("address", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DexSwap" ADD CONSTRAINT "DexSwap_sender_chainId_fkey" FOREIGN KEY ("sender", "chainId") REFERENCES "Wallet"("address", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DexSwap" ADD CONSTRAINT "DexSwap_recipient_chainId_fkey" FOREIGN KEY ("recipient", "chainId") REFERENCES "Wallet"("address", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NftEvent" ADD CONSTRAINT "NftEvent_contractAddress_chainId_fkey" FOREIGN KEY ("contractAddress", "chainId") REFERENCES "NftCollection"("address", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NftEvent" ADD CONSTRAINT "NftEvent_fromAddress_chainId_fkey" FOREIGN KEY ("fromAddress", "chainId") REFERENCES "Wallet"("address", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NftEvent" ADD CONSTRAINT "NftEvent_toAddress_chainId_fkey" FOREIGN KEY ("toAddress", "chainId") REFERENCES "Wallet"("address", "chainId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
