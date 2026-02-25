import test from 'node:test';
import assert from 'node:assert/strict';
import { CreatePedidoSchema, UpdatePedidoSchema } from '../src/validators/pedidoValidator.js';

const baseCreatePayload = {
  titulo: 'Reparar eje',
  descripcion: 'Rectificado y ajuste',
  cliente_id: 1,
};

test('CreatePedidoSchema acepta fecha con hora ISO y zona', () => {
  const parsed = CreatePedidoSchema.safeParse({
    ...baseCreatePayload,
    fecha_estimada_fin: '2026-02-25T15:30:00Z',
  });
  assert.equal(parsed.success, true);
});

test('CreatePedidoSchema acepta fecha con hora sin minutos (YYYY-MM-DDTHH)', () => {
  const parsed = CreatePedidoSchema.safeParse({
    ...baseCreatePayload,
    fecha_estimada_fin: '2026-02-25T15',
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.fecha_estimada_fin, '2026-02-25T15:00');
});

test('CreatePedidoSchema acepta fecha sin hora (compatibilidad)', () => {
  const parsed = CreatePedidoSchema.safeParse({
    ...baseCreatePayload,
    fecha_estimada_fin: '2026-02-25',
  });
  assert.equal(parsed.success, true);
});

test('UpdatePedidoSchema acepta fecha con hora ISO y offset', () => {
  const parsed = UpdatePedidoSchema.safeParse({
    fecha_estimada_fin: '2026-02-25T15:30:00-03:00',
  });
  assert.equal(parsed.success, true);
});

test('UpdatePedidoSchema acepta fecha con hora local (sin zona)', () => {
  const parsed = UpdatePedidoSchema.safeParse({
    fecha_estimada_fin: '2026-02-25T15:30',
  });
  assert.equal(parsed.success, true);
});

test('UpdatePedidoSchema acepta null para limpiar fecha', () => {
  const parsed = UpdatePedidoSchema.safeParse({
    fecha_estimada_fin: null,
  });
  assert.equal(parsed.success, true);
});

test('Schemas rechazan formatos invalidos', () => {
  const createParsed = CreatePedidoSchema.safeParse({
    ...baseCreatePayload,
    fecha_estimada_fin: '2026-02-30T15:30',
  });
  const updateParsed = UpdatePedidoSchema.safeParse({
    fecha_estimada_fin: '2026-02-25T',
  });
  assert.equal(createParsed.success, false);
  assert.equal(updateParsed.success, false);
});
