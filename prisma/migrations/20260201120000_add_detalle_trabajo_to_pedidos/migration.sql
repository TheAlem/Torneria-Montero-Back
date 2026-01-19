-- Add detalle_trabajo JSONB column to pedidos
ALTER TABLE "pedidos" ADD COLUMN "detalle_trabajo" JSONB;
