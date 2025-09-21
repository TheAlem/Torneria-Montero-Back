/*
  Warnings:

  - You are about to drop the column `verified` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `verifiedById` on the `Payment` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Payment" DROP CONSTRAINT "Payment_verifiedById_fkey";

-- AlterTable
ALTER TABLE "public"."Payment" DROP COLUMN "verified",
DROP COLUMN "verifiedById",
ADD COLUMN     "gatewayReference" TEXT,
ADD COLUMN     "gatewayStatus" TEXT;
