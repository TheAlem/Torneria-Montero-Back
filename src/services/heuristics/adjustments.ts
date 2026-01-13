import { computeComplexityScore, type ParsedDescripcion } from '../ml/features.js';

export type HeuristicAdjustment = {
  multiplier: number;
  addSec: number;
  reasons: string[];
  complexityScore: number;
  generalTasks: string[];
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function collectGeneralTasks(parsed: ParsedDescripcion): string[] {
  const tasks: string[] = [];
  if (parsed.procesos.pulido) tasks.push('pulido');
  if (parsed.domain.amolado) tasks.push('amolado');
  if (parsed.domain.esmerilado) tasks.push('esmerilado');
  if (parsed.domain.corte) tasks.push('corte');
  if (parsed.domain.taladro_simple) tasks.push('taladro_simple');
  if (parsed.domain.prensa) tasks.push('prensa');
  return tasks;
}

export function applyHeuristicAdjustments(parsed: ParsedDescripcion, baseSec: number): HeuristicAdjustment {
  const reasons: string[] = [];
  const mats = parsed.materiales;
  const procs = parsed.procesos;
  const flags = parsed.flags;
  const generalTasks = collectGeneralTasks(parsed);

  let multiplier = 1;
  let addSec = 0;

  const bump = (pct: number, reason: string) => {
    if (!pct) return;
    multiplier *= (1 + pct);
    reasons.push(`${reason} (+${Math.round(pct * 100)}%)`);
  };
  const addMin = (min: number, reason: string) => {
    if (!min) return;
    addSec += min * 60;
    reasons.push(`${reason} (+${min}m)`);
  };

  if (mats.acero_1045) bump(0.2, 'Material 1045 maquinable');
  if (mats.fundido) bump(0.15, 'Fierro fundido');
  if (mats.bronce_fosforado) bump(0.12, 'Bronce fosforado');
  if (mats.bronce_fundido) bump(0.1, 'Bronce fundido');
  if (mats.bronce_laminado) bump(0.08, 'Bronce laminado');
  if (mats.bronce && !mats.bronce_fosforado && !mats.bronce_fundido && !mats.bronce_laminado) bump(0.06, 'Bronce');
  if (mats.inox) bump(0.1, 'Acero inoxidable');
  if (mats.teflon) bump(0.05, 'PTFE/Teflón');
  if (mats.nylon) bump(0.05, 'Nylon');
  if (mats.aluminio) bump(0.02, 'Aluminio');

  if (procs.roscado || flags.has_rosca) bump(0.12, 'Roscado');
  if (flags.has_tolerancia) bump(0.15, 'Tolerancias');
  if (parsed.domain.recargue || parsed.domain.rellenado) bump(0.2, 'Recargue/Rellenado');
  if (procs.soldadura) bump(0.1, 'Soldadura');
  if (procs.fresado) bump(0.08, 'Fresado');
  if (procs.torneado) bump(0.06, 'Torneado');
  if (procs.pulido) addMin(15, 'Pulido');

  if (flags.multi_piezas) bump(0.15, 'Múltiples piezas');
  if (parsed.diamBucket[2]) bump(0.06, 'Diámetro mediano');
  if (parsed.diamBucket[3]) bump(0.1, 'Diámetro grande');

  if (parsed.domain.amolado) addMin(10, 'Amoladora/desbaste');
  if (parsed.domain.esmerilado) addMin(10, 'Esmerilado');
  if (parsed.domain.corte) addMin(15, 'Corte');
  if (parsed.domain.taladro_simple) addMin(10, 'Taladro simple');
  if (parsed.domain.prensa) addMin(10, 'Prensa');

  multiplier = clamp(multiplier, 0.85, 2.2);
  const complexityScore = computeComplexityScore(parsed);
  return { multiplier, addSec, reasons, complexityScore, generalTasks };
}

export function buildEstimateInterval(adjustedSec: number, parsed: ParsedDescripcion): { minSec: number; maxSec: number; bufferPct: number } {
  const complexityScore = computeComplexityScore(parsed);
  const baseBuffer = 0.15 + (complexityScore * 0.15) + (parsed.flags.multi_piezas ? 0.1 : 0);
  const bufferPct = Math.min(0.4, baseBuffer);
  const minSec = Math.max(60, Math.round(adjustedSec * (1 - bufferPct)));
  const maxSec = Math.max(minSec, Math.round(adjustedSec * (1 + bufferPct)));
  return { minSec, maxSec, bufferPct };
}
