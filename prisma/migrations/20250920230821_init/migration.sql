-- CreateEnum
CREATE TYPE "public"."Priority" AS ENUM ('BAJA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDIENTE', 'PAGADO');

-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('PENDIENTE', 'EN_PROCESO', 'TERMINADO', 'ENTREGADO');

-- CreateTable
CREATE TABLE "public"."Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClientAppAccount" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "appEmail" TEXT,
    "appPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAppAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Worker" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Job" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "workType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "public"."Priority" NOT NULL DEFAULT 'MEDIA',
    "estimatedDelivery" TIMESTAMP(3) NOT NULL,
    "assignedWorkerId" TEXT NOT NULL,
    "paymentAmount" DECIMAL(12,2) NOT NULL,
    "paymentStatus" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDIENTE',
    "materials" TEXT,
    "specifications" TEXT,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'PENDIENTE',
    "dateCreated" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_email_key" ON "public"."Client"("email");

-- CreateIndex
CREATE INDEX "idx_clients_phone" ON "public"."Client"("phone");

-- CreateIndex
CREATE INDEX "idx_clients_email" ON "public"."Client"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAppAccount_clientId_key" ON "public"."ClientAppAccount"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAppAccount_appEmail_key" ON "public"."ClientAppAccount"("appEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_fullName_key" ON "public"."Worker"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "Job_code_key" ON "public"."Job"("code");

-- CreateIndex
CREATE INDEX "Job_clientId_idx" ON "public"."Job"("clientId");

-- CreateIndex
CREATE INDEX "Job_assignedWorkerId_idx" ON "public"."Job"("assignedWorkerId");

-- AddForeignKey
ALTER TABLE "public"."ClientAppAccount" ADD CONSTRAINT "ClientAppAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Job" ADD CONSTRAINT "Job_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Job" ADD CONSTRAINT "Job_assignedWorkerId_fkey" FOREIGN KEY ("assignedWorkerId") REFERENCES "public"."Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
