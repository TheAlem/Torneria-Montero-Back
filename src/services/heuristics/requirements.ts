import type { ParsedDescripcion } from '../ml/features.js';

export type HardRequirement = {
  requiredSkills: string[];
  reasons: string[];
};

export function buildHardRequirements(parsed: ParsedDescripcion): HardRequirement {
  const requiredSkills: string[] = [];
  const reasons: string[] = [];

  if (parsed.procesos.fresado) {
    requiredSkills.push('fresado');
    reasons.push('Requiere fresado');
  }
  if (parsed.procesos.soldadura || parsed.domain.recargue || parsed.domain.rellenado) {
    requiredSkills.push('soldadura');
    reasons.push('Requiere soldadura/recargue');
  }
  if (parsed.procesos.torneado || parsed.procesos.roscado || parsed.flags.has_tolerancia) {
    requiredSkills.push('torneado');
    reasons.push(parsed.flags.has_tolerancia || parsed.procesos.roscado ? 'Requiere torneado de precisión/roscado' : 'Requiere torneado');
  }

  return { requiredSkills: Array.from(new Set(requiredSkills)), reasons };
}

export function isAyudanteRole(skills: string[], rolToken?: string | null): boolean {
  if (rolToken === 'ayudante') return true;
  return skills.some(s => s.toLowerCase().includes('ayud'));
}

export function workerMeetsRequirements(skills: string[], rolToken: string | null, required: string[]): boolean {
  if (!required.length) return true;
  const set = new Set(skills.map(s => s.toLowerCase()));
  if (rolToken) set.add(rolToken.toLowerCase());
  return required.every(req => set.has(req.toLowerCase()));
}
