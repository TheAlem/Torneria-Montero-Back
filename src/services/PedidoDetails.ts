export type DetalleTrabajo = {
  materiales: string[];
  procesos: string[];
  tags: string[];
  tolerancia: string;
  rosca: boolean;
  rosca_paso: string | null;
  cantidad_piezas: string | number | null;
  diametro_principal: string | number | null;
  descripcion_guiada: string | null;
  codigo_interno: string | null;
};

const defaultDetalle = (): DetalleTrabajo => ({
  materiales: [],
  procesos: [],
  tags: [],
  tolerancia: 'none',
  rosca: false,
  rosca_paso: null,
  cantidad_piezas: null,
  diametro_principal: null,
  descripcion_guiada: null,
  codigo_interno: null,
});

const normalizeList = (val: unknown): string[] => {
  if (Array.isArray(val)) {
    return val.map(v => String(v).trim()).filter(Boolean);
  }
  if (typeof val === 'string') {
    return val.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [];
};

const normalizeText = (val: unknown): string | null => {
  if (val === null || typeof val === 'undefined') return null;
  const s = String(val).trim();
  return s ? s : null;
};

const normalizeBoolean = (val: unknown): boolean => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val > 0;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    if (['si', 'sí', 'true', '1', 'yes'].includes(s)) return true;
    if (['no', 'false', '0'].includes(s)) return false;
  }
  return false;
};

export function buildDetalleFromPayload(payload: any): { detalle: DetalleTrabajo; hasDetalle: boolean } {
  const d = defaultDetalle();
  let hasDetalle = false;

  const assign = (key: keyof DetalleTrabajo, value: any) => {
    (d as any)[key] = value;
    hasDetalle = true;
  };

  if (typeof payload?.materiales !== 'undefined') assign('materiales', normalizeList(payload.materiales));
  if (typeof payload?.procesos !== 'undefined') assign('procesos', normalizeList(payload.procesos));
  if (typeof payload?.tags !== 'undefined') assign('tags', normalizeList(payload.tags));
  if (typeof payload?.tolerancia !== 'undefined') assign('tolerancia', normalizeText(payload.tolerancia) ?? 'none');
  if (typeof payload?.rosca !== 'undefined') assign('rosca', normalizeBoolean(payload.rosca));
  if (typeof payload?.rosca_paso !== 'undefined') assign('rosca_paso', normalizeText(payload.rosca_paso));
  if (typeof payload?.cantidad_piezas !== 'undefined') assign('cantidad_piezas', payload.cantidad_piezas ?? null);
  if (typeof payload?.diametro_principal !== 'undefined') assign('diametro_principal', payload.diametro_principal ?? null);
  if (typeof payload?.descripcion_guiada !== 'undefined') assign('descripcion_guiada', normalizeText(payload.descripcion_guiada));
  if (typeof payload?.codigo_interno !== 'undefined') assign('codigo_interno', normalizeText(payload.codigo_interno));

  return { detalle: d, hasDetalle };
}

export function parseNotasToDetalle(notas?: string | null): DetalleTrabajo {
  const d = defaultDetalle();
  const raw = normalizeText(notas);
  if (!raw) return d;

  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const takeValue = (label: string) => {
    const line = lines.find(l => l.toLowerCase().startsWith(label.toLowerCase()));
    if (!line) return null;
    const idx = line.indexOf(':');
    return idx >= 0 ? line.slice(idx + 1).trim() : null;
  };

  const mats = takeValue('Materiales');
  if (mats) d.materiales = normalizeList(mats);

  const procs = takeValue('Procesos');
  if (procs) d.procesos = normalizeList(procs);

  const tags = takeValue('Tags');
  if (tags) d.tags = normalizeList(tags);

  const tol = takeValue('Tolerancia');
  if (tol) d.tolerancia = tol;

  const rosca = takeValue('Rosca');
  if (rosca) {
    d.rosca = normalizeBoolean(rosca);
    const m = /paso\s*([0-9]+(\.[0-9]+)?)/i.exec(rosca);
    if (m && m[1]) d.rosca_paso = m[1];
  }

  const cantidad = takeValue('Cantidad');
  if (cantidad) d.cantidad_piezas = cantidad;

  const diam = takeValue('Diametro principal') || takeValue('Diámetro principal');
  if (diam) d.diametro_principal = diam;

  const detalle = takeValue('Detalle');
  if (detalle) d.descripcion_guiada = detalle;

  const codigo = takeValue('Codigo interno') || takeValue('Código interno');
  if (codigo) d.codigo_interno = codigo;

  const hasStructured = d.materiales.length || d.procesos.length || d.tags.length
    || d.tolerancia !== 'none' || d.rosca || d.rosca_paso || d.cantidad_piezas
    || d.diametro_principal || d.descripcion_guiada || d.codigo_interno;
  if (!hasStructured) {
    d.descripcion_guiada = raw;
  }
  return d;
}

export function buildNotasFromDetalle(detalle: DetalleTrabajo): string {
  const lines: string[] = [];
  if (detalle.materiales.length) lines.push(`Materiales: ${detalle.materiales.join(', ')}`);
  if (detalle.procesos.length) lines.push(`Procesos: ${detalle.procesos.join(', ')}`);
  if (detalle.tags.length) lines.push(`Tags: ${detalle.tags.join(', ')}`);
  if (detalle.tolerancia && detalle.tolerancia !== 'none') lines.push(`Tolerancia: ${detalle.tolerancia}`);

  if (detalle.rosca) {
    const paso = detalle.rosca_paso ? `, paso ${detalle.rosca_paso}` : '';
    lines.push(`Rosca: Si${paso}`);
  } else if (detalle.rosca_paso) {
    lines.push(`Rosca: No, paso ${detalle.rosca_paso}`);
  }

  if (detalle.cantidad_piezas) lines.push(`Cantidad: ${detalle.cantidad_piezas}`);
  if (detalle.diametro_principal) lines.push(`Diametro principal: ${detalle.diametro_principal}`);
  if (detalle.descripcion_guiada) lines.push(`Detalle: ${detalle.descripcion_guiada}`);
  if (detalle.codigo_interno) lines.push(`Codigo interno: ${detalle.codigo_interno}`);

  return lines.join('\n');
}

export function normalizeDetalleTrabajo(raw: any, notas?: string | null): DetalleTrabajo {
  const base = defaultDetalle();
  if (raw && typeof raw === 'object') {
    return {
      materiales: normalizeList(raw.materiales),
      procesos: normalizeList(raw.procesos),
      tags: normalizeList(raw.tags),
      tolerancia: normalizeText(raw.tolerancia) ?? 'none',
      rosca: normalizeBoolean(raw.rosca),
      rosca_paso: normalizeText(raw.rosca_paso),
      cantidad_piezas: raw.cantidad_piezas ?? null,
      diametro_principal: raw.diametro_principal ?? null,
      descripcion_guiada: normalizeText(raw.descripcion_guiada),
      codigo_interno: normalizeText(raw.codigo_interno),
    };
  }
  const parsed = parseNotasToDetalle(notas);
  return { ...base, ...parsed };
}
