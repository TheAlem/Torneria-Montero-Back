/*
  Warnings:

  - You are about to drop the `Client` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GatewayTransaction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Job` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JobStatusHistory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Payment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Worker` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."RolUsuario" AS ENUM ('CLIENTE', 'TORNERO', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."EstadoPedido" AS ENUM ('PENDIENTE', 'ASIGNADO', 'EN_PROGRESO', 'QA', 'ENTREGADO');

-- CreateEnum
CREATE TYPE "public"."Prioridad" AS ENUM ('BAJA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "public"."Semaforo" AS ENUM ('VERDE', 'AMARILLO', 'ROJO');

-- CreateEnum
CREATE TYPE "public"."OrigenAsignacion" AS ENUM ('MANUAL', 'SUGERIDO');

-- CreateEnum
CREATE TYPE "public"."TipoNotificacion" AS ENUM ('INFO', 'ALERTA', 'ENTREGA');

-- CreateEnum
CREATE TYPE "public"."SeveridadAlerta" AS ENUM ('VERDE', 'AMARILLO', 'ROJO');

-- CreateEnum
CREATE TYPE "public"."EstadoTiempo" AS ENUM ('ABIERTO', 'PAUSADO', 'CERRADO');

-- DropForeignKey
ALTER TABLE "public"."GatewayTransaction" DROP CONSTRAINT "GatewayTransaction_jobId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Job" DROP CONSTRAINT "Job_assignedWorkerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Job" DROP CONSTRAINT "Job_clientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."JobStatusHistory" DROP CONSTRAINT "JobStatusHistory_changedById_fkey";

-- DropForeignKey
ALTER TABLE "public"."JobStatusHistory" DROP CONSTRAINT "JobStatusHistory_jobId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Payment" DROP CONSTRAINT "Payment_jobId_fkey";

-- DropTable
DROP TABLE "public"."Client";

-- DropTable
DROP TABLE "public"."GatewayTransaction";

-- DropTable
DROP TABLE "public"."Job";

-- DropTable
DROP TABLE "public"."JobStatusHistory";

-- DropTable
DROP TABLE "public"."Payment";

-- DropTable
DROP TABLE "public"."User";

-- DropTable
DROP TABLE "public"."Worker";

-- DropEnum
DROP TYPE "public"."JobStatus";

-- DropEnum
DROP TYPE "public"."PaymentMethod";

-- DropEnum
DROP TYPE "public"."PaymentStatus";

-- DropEnum
DROP TYPE "public"."Priority";

-- DropEnum
DROP TYPE "public"."UserRole";

-- CreateTable
CREATE TABLE "public"."usuarios" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "telefono" VARCHAR(20),
    "password_hash" TEXT NOT NULL,
    "rol" "public"."RolUsuario" NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'Activo',
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_acceso" TIMESTAMP(3),

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."trabajadores" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "ci" VARCHAR(20) NOT NULL,
    "direccion" TEXT,
    "rol_tecnico" VARCHAR(50),
    "estado" VARCHAR(20) NOT NULL DEFAULT 'Activo',
    "fecha_ingreso" TIMESTAMP(3),
    "skills" JSONB,
    "disponibilidad" JSONB,
    "carga_actual" INTEGER NOT NULL DEFAULT 0,
    "notas" TEXT,

    CONSTRAINT "trabajadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."clientes" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER,
    "nombre" VARCHAR(120) NOT NULL,
    "ci_rut" VARCHAR(20),
    "email" VARCHAR(100),
    "telefono" VARCHAR(20),
    "direccion" TEXT,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'Activo',
    "fecha_registro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" TEXT,
    "origen" VARCHAR(30) NOT NULL DEFAULT 'QR',
    "verificado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pedidos" (
    "id" SERIAL NOT NULL,
    "cliente_id" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "prioridad" "public"."Prioridad" NOT NULL DEFAULT 'MEDIA',
    "precio" DECIMAL(10,2),
    "fecha_inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_estimada_fin" TIMESTAMP(3),
    "estado" "public"."EstadoPedido" NOT NULL DEFAULT 'PENDIENTE',
    "responsable_id" INTEGER,
    "semaforo" "public"."Semaforo" NOT NULL DEFAULT 'VERDE',
    "notas" TEXT,
    "adjuntos" TEXT[],
    "tiempo_estimado_sec" INTEGER,
    "tiempo_real_sec" INTEGER,
    "creado_por_id" INTEGER,
    "actualizado_por_id" INTEGER,
    "fecha_actualizacion" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."asignaciones" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "trabajador_id" INTEGER NOT NULL,
    "score_sugerencia" DOUBLE PRECISION,
    "skill_match" DOUBLE PRECISION,
    "tiempo_estimado_sec" INTEGER,
    "origen" "public"."OrigenAsignacion" NOT NULL DEFAULT 'MANUAL',
    "fecha_asignacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" TEXT NOT NULL DEFAULT 'Asignado',
    "comentarios" TEXT,

    CONSTRAINT "asignaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tiempos" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "trabajador_id" INTEGER NOT NULL,
    "categoria" TEXT NOT NULL DEFAULT 'Producción',
    "inicio" TIMESTAMP(3),
    "fin" TIMESTAMP(3),
    "duracion_sec" INTEGER,
    "estado" "public"."EstadoTiempo" NOT NULL DEFAULT 'CERRADO',
    "registrado_por" INTEGER,

    CONSTRAINT "tiempos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notificaciones" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "cliente_id" INTEGER NOT NULL,
    "mensaje" TEXT NOT NULL,
    "tipo" "public"."TipoNotificacion" NOT NULL DEFAULT 'INFO',
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."alertas" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER,
    "tipo" TEXT,
    "severidad" "public"."SeveridadAlerta" NOT NULL,
    "descripcion" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atendida" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "alertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reportes" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "parametros" JSONB,
    "fecha_generacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generado_por_id" INTEGER,
    "ruta_archivo" TEXT,

    CONSTRAINT "reportes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."predicciones_tiempo" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "trabajador_id" INTEGER NOT NULL,
    "t_estimado_sec" INTEGER,
    "t_real_sec" INTEGER,
    "desvio" DOUBLE PRECISION,
    "modelo_version" TEXT NOT NULL DEFAULT 'v1.0',
    "fecha_calculo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "historicoModeloId" INTEGER,

    CONSTRAINT "predicciones_tiempo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."historico_modelo" (
    "id" SERIAL NOT NULL,
    "fecha_entrenamiento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_pedidos" INTEGER,
    "mae" DOUBLE PRECISION,
    "precision" DOUBLE PRECISION,
    "parametros" JSONB,

    CONSTRAINT "historico_modelo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "public"."usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "trabajadores_usuario_id_key" ON "public"."trabajadores"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "trabajadores_ci_key" ON "public"."trabajadores"("ci");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_usuario_id_key" ON "public"."clientes"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_ci_rut_key" ON "public"."clientes"("ci_rut");

-- CreateIndex
CREATE INDEX "idx_pedidos_kanban" ON "public"."pedidos"("estado", "prioridad", "fecha_estimada_fin");

-- AddForeignKey
ALTER TABLE "public"."trabajadores" ADD CONSTRAINT "trabajadores_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."clientes" ADD CONSTRAINT "clientes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pedidos" ADD CONSTRAINT "pedidos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pedidos" ADD CONSTRAINT "pedidos_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "public"."trabajadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pedidos" ADD CONSTRAINT "pedidos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pedidos" ADD CONSTRAINT "pedidos_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."asignaciones" ADD CONSTRAINT "asignaciones_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."asignaciones" ADD CONSTRAINT "asignaciones_trabajador_id_fkey" FOREIGN KEY ("trabajador_id") REFERENCES "public"."trabajadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tiempos" ADD CONSTRAINT "tiempos_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tiempos" ADD CONSTRAINT "tiempos_trabajador_id_fkey" FOREIGN KEY ("trabajador_id") REFERENCES "public"."trabajadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tiempos" ADD CONSTRAINT "tiempos_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notificaciones" ADD CONSTRAINT "notificaciones_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notificaciones" ADD CONSTRAINT "notificaciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."alertas" ADD CONSTRAINT "alertas_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reportes" ADD CONSTRAINT "reportes_generado_por_id_fkey" FOREIGN KEY ("generado_por_id") REFERENCES "public"."usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."predicciones_tiempo" ADD CONSTRAINT "predicciones_tiempo_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."predicciones_tiempo" ADD CONSTRAINT "predicciones_tiempo_trabajador_id_fkey" FOREIGN KEY ("trabajador_id") REFERENCES "public"."trabajadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."predicciones_tiempo" ADD CONSTRAINT "predicciones_tiempo_historicoModeloId_fkey" FOREIGN KEY ("historicoModeloId") REFERENCES "public"."historico_modelo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
