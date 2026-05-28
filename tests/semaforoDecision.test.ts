import test from 'node:test';
import assert from 'node:assert/strict';
import { decideSemaforoStatus } from '../src/services/SemaforoService.js';

const base = {
  estado: 'EN_PROGRESO',
  hasDueDate: true,
  hasResponsable: true,
  slackSec: 7200,
  marginSec: 3600,
  ratioAdjusted: 0.5,
  yellowThreshold: 0.75,
  redThreshold: 1.05,
  redGraceSec: 15 * 60,
  attentionMarginSec: 30 * 60,
};

test('semaforo stays yellow, not red, when work is just inside operational grace', () => {
  const result = decideSemaforoStatus({
    ...base,
    slackSec: 10 * 60,
    marginSec: -5 * 60,
    ratioAdjusted: 1.1,
  });

  assert.equal(result.color, 'AMARILLO');
  assert.equal(result.decision.status, 'ATENCION');
});

test('semaforo marks red only when remaining work exceeds grace', () => {
  const result = decideSemaforoStatus({
    ...base,
    slackSec: 10 * 60,
    marginSec: -20 * 60,
    ratioAdjusted: 1.2,
  });

  assert.equal(result.color, 'ROJO');
  assert.equal(result.decision.status, 'RIESGO');
});

test('delivered jobs are always green for kanban timing', () => {
  const result = decideSemaforoStatus({
    ...base,
    estado: 'ENTREGADO',
    slackSec: 0,
    marginSec: -3600,
    ratioAdjusted: 10,
  });

  assert.equal(result.color, 'VERDE');
  assert.equal(result.decision.status, 'ENTREGADO');
});

test('jobs with enough margin stay green', () => {
  const result = decideSemaforoStatus(base);

  assert.equal(result.color, 'VERDE');
  assert.equal(result.decision.status, 'A_TIEMPO');
});
