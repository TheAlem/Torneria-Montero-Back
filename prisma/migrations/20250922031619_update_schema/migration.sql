/*
  Warnings:

  - The values [APOYO] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `dateCreated` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `materials` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `paymentAmount` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `paymentStatus` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `specifications` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `workType` on the `Job` table. All the data in the column will be lost.
  - You are about to drop the column `note` on the `JobStatusHistory` table. All the data in the column will be lost.
  - You are about to drop the column `gatewayReference` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `gatewayStatus` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `isAdvance` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `paidAt` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `full_name` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Attachment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AuditLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ClientAppAccount` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JobMaterials` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `NotificationsOutbox` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Profile` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `price` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fullName` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."PaymentStatus" ADD VALUE 'FALLIDO';
ALTER TYPE "public"."PaymentStatus" ADD VALUE 'REEMBOLSADO';

-- AlterEnum
BEGIN;
CREATE TYPE "public"."UserRole_new" AS ENUM ('ADMIN', 'TORNERO', 'CLIENTE');
ALTER TABLE "public"."User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "public"."User" ALTER COLUMN "role" TYPE "public"."UserRole_new" USING ("role"::text::"public"."UserRole_new");
ALTER TYPE "public"."UserRole" RENAME TO "UserRole_old";
ALTER TYPE "public"."UserRole_new" RENAME TO "UserRole";
DROP TYPE "public"."UserRole_old";
ALTER TABLE "public"."User" ALTER COLUMN "role" SET DEFAULT 'CLIENTE';
COMMIT;

-- DropForeignKey
ALTER TABLE "public"."Attachment" DROP CONSTRAINT "Attachment_clientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Attachment" DROP CONSTRAINT "Attachment_jobId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Attachment" DROP CONSTRAINT "Attachment_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "public"."AuditLog" DROP CONSTRAINT "AuditLog_actorUserId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ClientAppAccount" DROP CONSTRAINT "ClientAppAccount_clientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."JobMaterials" DROP CONSTRAINT "JobMaterials_jobId_fkey";

-- DropForeignKey
ALTER TABLE "public"."NotificationsOutbox" DROP CONSTRAINT "NotificationsOutbox_clientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."NotificationsOutbox" DROP CONSTRAINT "NotificationsOutbox_jobId_fkey";

-- DropIndex
DROP INDEX "public"."Job_assignedWorkerId_idx";

-- DropIndex
DROP INDEX "public"."Job_clientId_idx";

-- DropIndex
DROP INDEX "public"."Worker_fullName_key";

-- AlterTable
ALTER TABLE "public"."Client" ALTER COLUMN "address" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."Job" DROP COLUMN "dateCreated",
DROP COLUMN "materials",
DROP COLUMN "paymentAmount",
DROP COLUMN "paymentStatus",
DROP COLUMN "specifications",
DROP COLUMN "workType",
ADD COLUMN     "estimatedHours" DOUBLE PRECISION,
ADD COLUMN     "price" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL,
ALTER COLUMN "estimatedDelivery" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."JobStatusHistory" DROP COLUMN "note";

-- AlterTable
ALTER TABLE "public"."Payment" DROP COLUMN "gatewayReference",
DROP COLUMN "gatewayStatus",
DROP COLUMN "isAdvance",
DROP COLUMN "notes",
DROP COLUMN "paidAt",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDIENTE';

-- AlterTable
ALTER TABLE "public"."User" DROP COLUMN "full_name",
ADD COLUMN     "fullName" TEXT NOT NULL,
ALTER COLUMN "role" SET DEFAULT 'CLIENTE';

-- AlterTable
ALTER TABLE "public"."Worker" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "specialty" TEXT;

-- DropTable
DROP TABLE "public"."Attachment";

-- DropTable
DROP TABLE "public"."AuditLog";

-- DropTable
DROP TABLE "public"."ClientAppAccount";

-- DropTable
DROP TABLE "public"."JobMaterials";

-- DropTable
DROP TABLE "public"."NotificationsOutbox";

-- DropTable
DROP TABLE "public"."Profile";

-- DropEnum
DROP TYPE "public"."NotificationChannel";

-- DropEnum
DROP TYPE "public"."NotificationStatus";

-- CreateTable
CREATE TABLE "public"."GatewayTransaction" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "qrUrl" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDIENTE',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewayTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GatewayTransaction_jobId_key" ON "public"."GatewayTransaction"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayTransaction_externalId_key" ON "public"."GatewayTransaction"("externalId");

-- CreateIndex
CREATE INDEX "idx_job_kanban_main" ON "public"."Job"("status", "priority", "estimatedDelivery");

-- CreateIndex
CREATE INDEX "idx_job_updated_at" ON "public"."Job"("updatedAt");

-- AddForeignKey
ALTER TABLE "public"."GatewayTransaction" ADD CONSTRAINT "GatewayTransaction_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
