
import swaggerJSDoc from 'swagger-jsdoc';
import * as fs from 'fs';
import path from 'path';

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
                        message: { type: ['string', 'null'], example: null },
                        data: { type: ['object', 'array', 'null'] },
                    }
                },
                UnifiedError: {
                    type: 'object',
                    properties: {
                        status: { type: 'string', example: 'error' },
                        code: { type: 'string', example: 'VALIDATION_ERROR' },
                        message: { type: 'string', example: 'Error de validación' },
                        data: { type: ['object', 'null'] },
                        errors: { type: ['object', 'array'], nullable: true }
                    }
                },
                Client: { type: 'object', properties: { id: { type: 'integer' }, nombre: { type: 'string' }, telefono: { type: 'string' } } },
                ClientListResponseWrapper: { $ref: '#/components/schemas/UnifiedSuccess' }
            }
        }
    },
    apis: ['./src/**/*.ts'],
    swaggerOptions: {
        persistAuthorization: true
    },
    failOnErrors: false
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

fs.writeFileSync(path.resolve(process.cwd(), 'openapi.json'), JSON.stringify(swaggerSpec, null, 2));

console.log('✅ OpenAPI specification generated successfully.');
