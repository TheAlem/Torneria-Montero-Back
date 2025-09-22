import express from 'express';
import cors from 'cors';
import errorHandler from './middlewares/errorHandler.js';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import path from 'path';
const openapiPath = path.resolve(process.cwd(), 'openapi.json');
const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf-8')) as any;

import clientesRoutes from './routes/clientes.js';
import pedidosRoutes from './routes/pedidos.js';
import trabajadoresRoutes from './routes/trabajadores.js';
import asignacionesRoutes from './routes/asignaciones.js';
import reportesRoutes from './routes/reportes.js';
import authRoutes from './routes/auth.js';
import jobsRoutes from './routes/jobs.js';
import kanbanRoutes from './routes/kanban.js';

const app = express();
 
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigins.length ? corsOrigins : true }));
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/clientes', clientesRoutes);
app.use('/pedidos', pedidosRoutes);
app.use('/trabajadores', trabajadoresRoutes);
app.use('/asignar', asignacionesRoutes);
app.use('/reportes', reportesRoutes);
app.use('/kanban', kanbanRoutes);

// Swagger UI
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

app.get('/', (req, res) => res.json({ ok: true, env: process.env.NODE_ENV || 'dev' }));

app.use(errorHandler);

export default app;
