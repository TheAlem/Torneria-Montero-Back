import express from 'express';
import cors from 'cors';
import errorHandler from './middlewares/errorHandler';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';
import * as fs from 'fs';
import path from 'path';

import clientesRoutes from './routes/clientes';
import pedidosRoutes from './routes/pedidos';
import trabajadoresRoutes from './routes/trabajadores';
import asignacionesRoutes from './routes/asignaciones';
import reportesRoutes from './routes/reportes';
import authRoutes from './routes/auth';
import kanbanRoutes from './routes/kanban';
import mlRoutes from './routes/ml';
import onboardingRoutes from './routes/onboarding';
import realtimeRoutes from './routes/realtime';
import { success } from './utils/response';

const app = express();

const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : true,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-api-key']
}));
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/trabajadores', trabajadoresRoutes);
app.use('/api/asignar', asignacionesRoutes);
app.use('/reportes', reportesRoutes);
app.use('/kanban', kanbanRoutes);
app.use('/ml', mlRoutes);
app.use('/api', onboardingRoutes);
app.use('/realtime', realtimeRoutes);

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
                        data: { oneOf: [ { type: 'object' }, { type: 'array' }, { type: 'null' } ] },
                        message: { type: 'string', example: '' },
                    }
                },
                UnifiedError: {
                    type: 'object',
                    properties: {
                        status: { type: 'string', example: 'error' },
                        data: { type: ['object', 'null'], example: null },
                        message: { type: 'string', example: 'Error de validación' },
                        code: { type: 'string', example: 'VALIDATION_ERROR' },
                        errors: { type: ['object', 'array'], nullable: true }
                    }
                },
                FieldsValidation: {
                    type: 'object',
                    properties: {
                        status: { type: 'string', example: 'fields-validation' },
                        data: { type: 'object', additionalProperties: true },
                        message: { type: 'string', example: '' }
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

let swaggerSpec: any | undefined;

// Intento preferente: cargar `openapi.json` desde la raíz del proyecto y usarlo tal cual
try {
	const rootPath = path.resolve(process.cwd(), 'openapi.json');
	if (fs.existsSync(rootPath)) {
		const raw = fs.readFileSync(rootPath, { encoding: 'utf8' });
		swaggerSpec = JSON.parse(raw);
		app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
		console.log('Swagger UI cargada desde openapi.json');
	} else {
		// Fallback: generar spec desde JSDoc
		console.log('openapi.json no encontrado — generando spec desde JSDoc...');
		try {
			swaggerSpec = swaggerJSDoc({
				...swaggerOptions,
				apis: ['./src/**/*.ts']
			});
			app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
			console.log('Swagger UI montada en /docs (generada desde JSDoc)');
		} catch (err) {
			console.error('Error al inicializar Swagger desde JSDoc:', err);
			const emptySpec = { openapi: '3.0.0', info: { title: 'API Documentation', version: '1.0.0' }, paths: {} };
			app.use('/docs', swaggerUi.serve, swaggerUi.setup(emptySpec));
		}
	}
} catch (e) {
	console.warn('Error al cargar o parsear openapi.json:', e);
	try {
		swaggerSpec = swaggerJSDoc({ ...swaggerOptions, apis: ['./src/**/*.ts'] });
		app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
		console.log('Swagger UI montada en /docs (fallback JSDoc)');
	} catch (err) {
		console.error('Error al inicializar Swagger (fallback):', err);
		const emptySpec = { openapi: '3.0.0', info: { title: 'API Documentation', version: '1.0.0' }, paths: {} };
		app.use('/docs', swaggerUi.serve, swaggerUi.setup(emptySpec));
	}
}

app.get('/', (req, res) => success(res, { ok: true, env: process.env.NODE_ENV || 'dev' }));

app.use(errorHandler);

export default app;
