import express from 'express';
import cors from 'cors';
import errorHandler from './middlewares/errorHandler';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';

import clientesRoutes from './routes/clientes';
import pedidosRoutes from './routes/pedidos';
import trabajadoresRoutes from './routes/trabajadores';
import asignacionesRoutes from './routes/asignaciones';
import reportesRoutes from './routes/reportes';
import authRoutes from './routes/auth';
import jobsRoutes from './routes/jobs';
import kanbanRoutes from './routes/kanban';
import { success } from './utils/response';

const app = express();
 
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigins.length ? corsOrigins : true }));
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/trabajadores', trabajadoresRoutes);
app.use('/api/asignar', asignacionesRoutes);
app.use('/reportes', reportesRoutes);
app.use('/kanban', kanbanRoutes);

// Swagger UI (generated at runtime with swagger-jsdoc)
const swaggerOptions = {
	definition: {
		openapi: '3.0.0',
		info: { title: 'Torneria Montero Back', version: '1.0.0' },
		components: {
			securitySchemes: {
				BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
				ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' }
			},
			schemas: {
				UnifiedSuccess: {
					type: 'object',
					properties: {
						status: { type: 'string', example: 'success' },
						data: { type: 'object' },
						error: { type: ['object', 'null'] }
					}
				},
				UnifiedError: {
					type: 'object',
					properties: {
						status: { type: 'string', example: 'error' },
						data: { type: ['object', 'null'] },
						error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } }
					}
				},
				Client: { type: 'object', properties: { id: { type: 'integer' }, nombre: { type: 'string' }, telefono: { type: 'string' } } },
				ClientListResponseWrapper: { $ref: '#/components/schemas/UnifiedSuccess' }
			}
		}
	},
	apis: ['./**/*.ts'], // Buscar en todos los archivos TypeScript
	swaggerOptions: {
		persistAuthorization: true
	},
	failOnErrors: false
};

let swaggerSpec;
try {
	console.log('🔍 Swagger buscando archivos...');
	swaggerSpec = swaggerJSDoc({
		...swaggerOptions,
		apis: ['./src/**/*.ts'] // Buscar en todos los subdirectorios
	});
	app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
	console.log('✅ Swagger UI montada en /docs');
} catch (err) {
	console.error('❌ Error al inicializar Swagger:', err);
	// En caso de error, usar un spec vacío pero válido
	swaggerSpec = {
		openapi: '3.0.0',
		info: { title: 'API Documentation', version: '1.0.0' },
		paths: {}
	};
	app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

app.get('/', (req, res) => success(res, { ok: true, env: process.env.NODE_ENV || 'dev' }));

app.use(errorHandler);

export default app;
