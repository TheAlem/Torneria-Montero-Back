-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('CLIENTE', 'TORNERO', 'ADMIN', 'TRABAJADOR');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('PENDIENTE', 'ASIGNADO', 'EN_PROGRESO', 'QA', 'ENTREGADO');

-- CreateEnum
CREATE TYPE "Prioridad" AS ENUM ('BAJA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "Semaforo" AS ENUM ('VERDE', 'AMARILLO', 'ROJO');

-- CreateEnum
CREATE TYPE "OrigenAsignacion" AS ENUM ('MANUAL', 'SUGERIDO');

-- CreateEnum
CREATE TYPE "TipoNotificacion" AS ENUM ('INFO', 'ALERTA', 'ENTREGA');

-- CreateEnum
CREATE TYPE "SeveridadAlerta" AS ENUM ('VERDE', 'AMARILLO', 'ROJO');

-- CreateEnum
CREATE TYPE "EstadoTiempo" AS ENUM ('ABIERTO', 'PAUSADO', 'CERRADO');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "telefono" VARCHAR(20),
    "password_hash" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'Activo',
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_acceso" TIMESTAMP(3),

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trabajadores" (
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
CREATE TABLE "clientes" (
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
CREATE TABLE "pedidos" (
    "id" SERIAL NOT NULL,
    "cliente_id" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "prioridad" "Prioridad" NOT NULL DEFAULT 'MEDIA',
    "precio" DECIMAL(10,2),
    "pagado" BOOLEAN NOT NULL DEFAULT false,
    "fecha_inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_estimada_fin" TIMESTAMP(3),
    "estado" "EstadoPedido" NOT NULL DEFAULT 'PENDIENTE',
    "responsable_id" INTEGER,
    "semaforo" "Semaforo" NOT NULL DEFAULT 'VERDE',
    "notas" TEXT,
    "detalle_trabajo" JSONB,
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
CREATE TABLE "asignaciones" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "trabajador_id" INTEGER NOT NULL,
    "score_sugerencia" DOUBLE PRECISION,
    "skill_match" DOUBLE PRECISION,
    "tiempo_estimado_sec" INTEGER,
    "origen" "OrigenAsignacion" NOT NULL DEFAULT 'MANUAL',
    "fecha_asignacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" TEXT NOT NULL DEFAULT 'Asignado',
    "comentarios" TEXT,

    CONSTRAINT "asignaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiempos" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "trabajador_id" INTEGER NOT NULL,
    "categoria" TEXT NOT NULL DEFAULT 'Produccion',
    "inicio" TIMESTAMP(3),
    "fin" TIMESTAMP(3),
    "duracion_sec" INTEGER,
    "estado" "EstadoTiempo" NOT NULL DEFAULT 'CERRADO',
    "registrado_por" INTEGER,

    CONSTRAINT "tiempos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "cliente_id" INTEGER NOT NULL,
    "mensaje" TEXT NOT NULL,
    "tipo" "TipoNotificacion" NOT NULL DEFAULT 'INFO',
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alertas" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER,
    "tipo" TEXT,
    "severidad" "SeveridadAlerta" NOT NULL,
    "descripcion" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atendida" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "alertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reportes" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "parametros" JSONB,
    "fecha_generacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generado_por_id" INTEGER,
    "ruta_archivo" TEXT,

    CONSTRAINT "reportes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predicciones_tiempo" (
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
CREATE TABLE "historico_modelo" (
    "id" SERIAL NOT NULL,
    "fecha_entrenamiento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_pedidos" INTEGER,
    "mae" DOUBLE PRECISION,
    "precision" DOUBLE PRECISION,
    "parametros" JSONB,

    CONSTRAINT "historico_modelo_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "trabajadores_usuario_id_key" ON "trabajadores"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "trabajadores_ci_key" ON "trabajadores"("ci");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_usuario_id_key" ON "clientes"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_ci_rut_key" ON "clientes"("ci_rut");

-- CreateIndex
CREATE INDEX "idx_pedidos_kanban" ON "pedidos"("estado", "prioridad", "fecha_estimada_fin");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_tokens_token_key" ON "onboarding_tokens"("token");

-- CreateIndex
CREATE INDEX "idx_onboarding_cliente" ON "onboarding_tokens"("cliente_id");

-- CreateIndex
CREATE INDEX "idx_onboarding_expira" ON "onboarding_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "trabajadores" ADD CONSTRAINT "trabajadores_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "trabajadores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones" ADD CONSTRAINT "asignaciones_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones" ADD CONSTRAINT "asignaciones_trabajador_id_fkey" FOREIGN KEY ("trabajador_id") REFERENCES "trabajadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiempos" ADD CONSTRAINT "tiempos_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiempos" ADD CONSTRAINT "tiempos_trabajador_id_fkey" FOREIGN KEY ("trabajador_id") REFERENCES "trabajadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiempos" ADD CONSTRAINT "tiempos_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reportes" ADD CONSTRAINT "reportes_generado_por_id_fkey" FOREIGN KEY ("generado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predicciones_tiempo" ADD CONSTRAINT "predicciones_tiempo_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predicciones_tiempo" ADD CONSTRAINT "predicciones_tiempo_trabajador_id_fkey" FOREIGN KEY ("trabajador_id") REFERENCES "trabajadores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predicciones_tiempo" ADD CONSTRAINT "predicciones_tiempo_historicoModeloId_fkey" FOREIGN KEY ("historicoModeloId") REFERENCES "historico_modelo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tokens" ADD CONSTRAINT "onboarding_tokens_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tokens" ADD CONSTRAINT "onboarding_tokens_consumed_by_fkey" FOREIGN KEY ("consumed_by") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
