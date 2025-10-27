/**
 * Alias de rutas `jobs` -> `pedidos`.
 *
 * Razonamiento: históricamente el código tenía ambas rutas. Para unificar terminología
 * y evitar duplicación mantenemos `/api/jobs` como alias que reexporta las rutas de
 * `/api/pedidos`. Esto mantiene compatibilidad con clientes existentes mientras
 * centralizamos la lógica en `src/routes/pedidos.ts`.
 */
import pedidosRouter from './pedidos';

// Exportamos el router de `pedidos` como `jobs` para mantener compatibilidad.
export default pedidosRouter;

