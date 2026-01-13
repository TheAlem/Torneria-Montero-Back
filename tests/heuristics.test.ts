import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDescripcion } from '../src/services/ml/features.js';
import { buildHardRequirements, workerMeetsRequirements, isAyudanteRole } from '../src/services/heuristics/requirements.js';

test('parseDescripcion detects real workshop materials and tasks', () => {
  const parsed = parseDescripcion('Buje en teflon PTFE, bronce fosforado, acero 1045 maquinable. Corte y prensa.');
  assert.equal(parsed.materiales.teflon, 1);
  assert.equal(parsed.materiales.bronce_fosforado, 1);
  assert.equal(parsed.materiales.acero_1045, 1);
  assert.equal(parsed.domain.corte, 1);
  assert.equal(parsed.domain.prensa, 1);
});

test('buildHardRequirements enforces fresado, soldadura y torneado cuando aplica', () => {
  const parsed = parseDescripcion('Necesita fresado, recargue con soldadura y roscado');
  const req = buildHardRequirements(parsed);
  assert.deepEqual(req.requiredSkills.sort(), ['fresado', 'soldadura', 'torneado'].sort());
  assert.equal(workerMeetsRequirements(['fresado'], 'fresado', req.requiredSkills), false);
  assert.equal(workerMeetsRequirements(['fresado', 'soldadura', 'torneado'], 'fresado', req.requiredSkills), true);
});

test('ayudante role is never treated as technical', () => {
  assert.equal(isAyudanteRole(['ayudante'], 'ayudante'), true);
  assert.equal(isAyudanteRole(['soldadura'], 'soldadura'), false);
});
