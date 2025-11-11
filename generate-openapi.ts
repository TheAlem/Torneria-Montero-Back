
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
                FieldsValidation: {
                    type: 'object',
                    properties: {
                        status: { type: 'string', example: 'fields-validation' },
                        data: { type: 'object', additionalProperties: true },
                        message: { type: 'string', example: '' }
                    }
                },
                Client: { type: 'object', properties: { id: { type: 'integer' }, nombre: { type: 'string' }, telefono: { type: 'string' } } },
                ClientListResponseWrapper: { $ref: '#/components/schemas/UnifiedSuccess' },
                Candidate: {
                    type: 'object',
                    properties: {
                        trabajadorId: { type: 'integer' },
                        nombre: { type: ['string','null'] },
                        skills: { type: 'array', items: { type: 'string' } },
                        wipActual: { type: 'integer' },
                        wipMax: { type: 'integer' },
                        capacidadLibreMin: { type: 'integer' },
                        desvioHistorico: { type: 'number', format: 'float' },
                        etaSiToma: { type: ['string','null'], format: 'date-time' },
                        saturado: { type: 'boolean' },
                        score: { type: 'number', format: 'float' }
                    }
                },
                AutoAssignResponse: {
                    type: 'object',
                    properties: {
                        autoAssigned: { type: 'boolean' },
                        pedidoId: { type: 'integer' },
                        trabajadorId: { type: ['integer','null'] },
                        semaforo: { type: ['string','null'], enum: ['VERDE','AMARILLO','ROJO', null] }
                    }
                }
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
