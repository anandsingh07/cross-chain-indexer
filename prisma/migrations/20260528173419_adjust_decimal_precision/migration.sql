-- AlterTable
ALTER TABLE "DexSwap" ALTER COLUMN "amountInNormalized" SET DATA TYPE DECIMAL(65,18),
ALTER COLUMN "amountOutNormalized" SET DATA TYPE DECIMAL(65,18);

-- AlterTable
ALTER TABLE "Transfer" ALTER COLUMN "normalizedAmount" SET DATA TYPE DECIMAL(65,18);
