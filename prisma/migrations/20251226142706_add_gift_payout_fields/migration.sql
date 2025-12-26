/*
  Warnings:

  - The values [CONVERTED,USED] on the enum `TelegramGiftStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `convertedAt` on the `telegram_gifts` table. All the data in the column will be lost.
  - You are about to drop the column `convertedValue` on the `telegram_gifts` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "TelegramGiftStatus_new" AS ENUM ('PENDING', 'IN_INVENTORY', 'PAYOUT_REQUESTED', 'PAYOUT_APPROVED', 'PAID_OUT', 'SOLD', 'FAILED');
ALTER TABLE "public"."telegram_gifts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "telegram_gifts" ALTER COLUMN "status" TYPE "TelegramGiftStatus_new" USING ("status"::text::"TelegramGiftStatus_new");
ALTER TYPE "TelegramGiftStatus" RENAME TO "TelegramGiftStatus_old";
ALTER TYPE "TelegramGiftStatus_new" RENAME TO "TelegramGiftStatus";
DROP TYPE "public"."TelegramGiftStatus_old";
ALTER TABLE "telegram_gifts" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "telegram_gifts" DROP COLUMN "convertedAt",
DROP COLUMN "convertedValue",
ADD COLUMN     "payoutApprovedAt" TIMESTAMP(3),
ADD COLUMN     "payoutCompletedAt" TIMESTAMP(3),
ADD COLUMN     "payoutError" TEXT,
ADD COLUMN     "payoutToTelegramId" TEXT,
ADD COLUMN     "savedMsgId" INTEGER,
ADD COLUMN     "starGiftId" TEXT,
ADD COLUMN     "starGiftSlug" TEXT;
