-- CreateTable
CREATE TABLE "onboarding_tokens" (
    "id" SERIAL NOT NULL,
    "cliente_id" INTEGER NOT NULL,
    "token" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "consumed_by" INTEGER,

    CONSTRAINT "onboarding_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_tokens_token_key" ON "onboarding_tokens"("token");

-- CreateIndex
CREATE INDEX "idx_onboarding_cliente" ON "onboarding_tokens"("cliente_id");

-- CreateIndex
CREATE INDEX "idx_onboarding_expira" ON "onboarding_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "onboarding_tokens" ADD CONSTRAINT "onboarding_tokens_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tokens" ADD CONSTRAINT "onboarding_tokens_consumed_by_fkey" FOREIGN KEY ("consumed_by") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
