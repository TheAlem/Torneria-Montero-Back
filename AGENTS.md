# AGENTS.md - Torneria Montero Backend

Guia para agentes que trabajen en `Torneria-Montero-Back`, el backend de Torneria Montero. Este archivo resume arquitectura, permisos, rutas, modelo de datos y verificaciones para reducir lectura repetitiva del codigo.

## Resumen

- API Node.js + TypeScript + Express.
- Prisma ORM con PostgreSQL.
- Auth con JWT y `bcryptjs`.
- Respuestas unificadas desde `src/utils/response.ts`.
- Swagger/OpenAPI generado con `generate-openapi.ts`.
- Servicios de dominio para pedidos, Kanban, asignaciones, ML, notificaciones y reportes.
- Realtime con SSE en `src/realtime/RealtimeService.ts`.

## Estructura Principal

- `src/server.ts`: arranque del servidor, jobs programados y bootstrap.
- `src/app.ts`: middlewares globales y montaje de rutas.
- `src/routes/`: definicion de endpoints y permisos por ruta.
- `src/controllers/`: handlers HTTP; validan request y llaman servicios/Prisma.
- `src/services/`: logica de negocio.
- `src/services/ml/`: entrenamiento/prediccion y features ML.
- `src/services/heuristics/`: reglas para sugerencias/asignacion.
- `src/validators/`: esquemas Zod.
- `src/middlewares/authMiddleware.ts`: JWT, roles y `requireRole`.
- `src/middlewares/apiKeyAuth.ts`: API key cuando aplique.
- `src/middlewares/errorHandler.ts`: errores globales.
- `src/prisma/client.ts`: cliente Prisma.
- `src/prisma/dbAvailability.ts`: estado/recovery de DB dormida.
- `prisma/schema.prisma`: modelos y enums.
- `prisma/migrations/`: migraciones.
- `prisma/seed.ts`: datos semilla.
- `tests/`: tests con `node --test --import tsx`.
- `scripts/`: scripts de ML/diagnostico.

## Modelo de Dominio

Modelos principales en `prisma/schema.prisma`:

- `usuarios`: cuentas con `rol` (`CLIENTE`, `TORNERO`, `ADMIN`, `TRABAJADOR`).
- `trabajadores`: perfil de trabajador vinculado 1:1 a usuario; rol tecnico, skills, disponibilidad, carga.
- `clientes`: clientes del taller, posible vinculo 1:1 con usuario cliente.
- `pedidos`: trabajos/pedidos; cliente, responsable, estado, prioridad, precio, fechas, semaforo.
- `asignaciones`: historial/asignacion de pedido a trabajador.
- `tiempos`: tramos de tiempo por pedido/trabajador.
- `notificaciones`: notificaciones al cliente.
- `alertas`: alertas operativas.
- `reportes`: reportes generados.
- `predicciones_tiempo` y `historico_modelo`: ML/estimaciones.
- `onboarding_tokens`: onboarding via QR.

Enums relevantes:

- `RolUsuario`: `CLIENTE`, `TORNERO`, `ADMIN`, `TRABAJADOR`.
- `EstadoPedido`: `PENDIENTE`, `ASIGNADO`, `EN_PROGRESO`, `QA`, `ENTREGADO`.
- `Prioridad`: `BAJA`, `MEDIA`, `ALTA`.
- `Semaforo`: `VERDE`, `AMARILLO`, `ROJO`.

## Rutas Principales

Montaje en `src/app.ts`:

- `/auth`: login, registro, alta de staff.
- `/api/clientes`: clientes y notificaciones de cliente.
- `/api/pedidos`: pedidos/trabajos.
- `/api/trabajadores`: trabajadores.
- `/api/asignar`: asignaciones y sugerencias.
- `/kanban`: tablero Kanban y evaluacion de riesgos.
- `/reportes`: reportes e historial de alertas.
- `/ml`: entrenamiento/status ML.
- `/realtime`: SSE.
- `/onboarding`: QR/onboarding.

## Roles y Permisos

Regla de negocio actual:

- `ADMIN`: dueno/administrador. Acceso completo, reportes, trabajadores, usuarios, eliminaciones, ML.
- `TRABAJADOR`: operador del taller. Puede entrar al sistema web y operar clientes/pedidos/Kanban/asignaciones/trabajos.
- `TORNERO`: rol legacy/alternativo de operador; tratarlo como operador salvo que una tarea diga lo contrario.
- `CLIENTE`: app/cliente; no debe entrar al panel administrativo web.

Permisos sensibles actuales:

- `authenticate` acepta usuarios con JWT valido, incluido `TRABAJADOR`.
- `requireRole(...)` compara roles en mayusculas.
- `/auth/admin/users`: solo `ADMIN`.
- `/api/trabajadores` DELETE: solo `ADMIN`.
- `/api/pedidos` DELETE: solo `ADMIN`.
- `/reportes/semanal` y `/reportes/mensual`: solo `ADMIN`.
- `/ml/train`: solo `ADMIN`.
- `/kanban/evaluar`: solo `ADMIN`.
- `/api/asignar`, `/api/asignar/suggest`, `/api/asignar/auto`: `ADMIN`, `TORNERO`, `TRABAJADOR`.
- `/realtime/kanban`: `ADMIN`, `TORNERO`, `TRABAJADOR`.

Cuando agregues una ruta:

1. Usar `authenticate` si requiere sesion.
2. Usar `requireRole` para cualquier accion sensible.
3. No confiar en el frontend para permisos.
4. Mantener `TRABAJADOR`/`TORNERO` para operaciones de taller y `ADMIN` para gestion/reportes/ML/eliminaciones.

## Auth

- `src/controllers/auth.ts`:
  - `register`: registra cliente o trabajador segun payload.
  - `login`: valida email/password y firma JWT con `{ id, role }`.
  - `adminCreate`: solo admin; crea `TRABAJADOR`, `TORNERO` o `ADMIN`.
- `src/middlewares/authMiddleware.ts`:
  - Lee `Authorization: Bearer`.
  - Tambien acepta `token`/`access_token` por query para SSE.
  - Verifica `JWT_SECRET`.
  - Pone `(req as any).user = { id, role, email }`.

## Respuestas y Errores

Usar helpers de `src/utils/response.ts`:

- `success(res, data, status?)`
- `fail(res, code, message, status?, errors?)`
- `fieldsValidation(res, errors)`

No devolver formatos ad hoc si la ruta ya usa respuesta unificada.

## Pedidos y Kanban

- Validaciones de pedido en `src/validators/pedidoValidator.ts`.
- Controladores en `src/controllers/pedidos.ts` y `src/controllers/kanban.ts`.
- Workflow de estados y tiempos en `src/services/PedidoWorkflow.ts`.
- Servicio de pedidos en `src/services/PedidoService.ts`.
- Detalles/normalizacion en `src/services/PedidoDetails.ts`.
- Semaforo en `src/services/SemaforoService.ts`.
- Monitor Kanban en `src/services/KanbanMonitorService.ts`.

Cuidado con:

- Estados `ASIGNADO` y `EN_PROGRESO` pueden abrir/cerrar tiempos.
- `ENTREGADO` puede marcar `pagado` desde frontend; revisar reglas antes de cambiar.
- `responsable_id` apunta a `trabajadores.id`, no a `usuarios.id`.
- Al reasignar, recalcular estimaciones cuando corresponda.

## Asignaciones y Heuristicas

- `src/controllers/asignaciones.ts`: asignacion manual.
- `src/services/AssignmentService.ts`: sugerencias, auto-asignacion, reasignacion forzada.
- `src/services/HeuristicsService.ts`: ranking de candidatos.
- `src/services/heuristics/requirements.ts`: skills requeridas y reglas de ayudante.

Cuidado:

- `trabajadorId`/`trabajador_id` son IDs de `trabajadores`.
- Ayudantes no deben tratarse como responsables tecnicos principales si las reglas lo impiden.
- Mantener compatibilidad de nombres camelCase/snake_case en respuestas si el frontend ya lo usa.

## Realtime y Notificaciones

- `src/realtime/RealtimeService.ts`: suscripciones SSE y eventos.
- `/realtime/notifications`: cliente o usuario.
- `/realtime/kanban`: operadores del taller.
- Los SSE pueden autenticar via query porque `EventSource` no soporta headers custom.
- Evitar romper nombres de eventos usados por `src/services/realtimeService.ts` del frontend.

## ML y Reportes

- `src/controllers/ml.ts` y `src/services/MLService.ts`.
- `src/services/ml/*`: features, train, storage, predictor.
- Reportes en `src/controllers/reportes.ts`.
