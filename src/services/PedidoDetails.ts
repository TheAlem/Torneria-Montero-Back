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

const hasOwn = (obj: any, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

const hasDetalleFields = (payload: any): boolean => {
  if (!payload || typeof payload !== 'object') return false;
  return [
    'materiales',
    'procesos',
    'tags',
    'tolerancia',
    'rosca',
    'rosca_paso',
    'cantidad_piezas',
    'diametro_principal',
    'descripcion_guiada',
    'codigo_interno',
  ].some((key) => hasOwn(payload, key));
};

export function buildDetalleFromPayload(payload: any): { detalle: DetalleTrabajo; hasDetalle: boolean } {
  const hasDetalle = hasDetalleFields(payload);
  if (!hasDetalle) return { detalle: defaultDetalle(), hasDetalle: false };

  return {
    hasDetalle: true,
    detalle: {
      materiales: payload.materiales ?? [],
      procesos: payload.procesos ?? [],
      tags: payload.tags ?? [],
      tolerancia: payload.tolerancia ?? 'none',
      rosca: payload.rosca ?? false,
      rosca_paso: payload.rosca_paso ?? null,
      cantidad_piezas: payload.cantidad_piezas ?? null,
      diametro_principal: payload.diametro_principal ?? null,
      descripcion_guiada: payload.descripcion_guiada ?? null,
      codigo_interno: payload.codigo_interno ?? null,
    },
  };
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

export function normalizeDetalleTrabajo(raw: any): DetalleTrabajo {
  if (!raw || typeof raw !== 'object') return defaultDetalle();

  return {
    materiales: raw.materiales ?? [],
    procesos: raw.procesos ?? [],
    tags: raw.tags ?? [],
    tolerancia: raw.tolerancia ?? 'none',
    rosca: raw.rosca ?? false,
    rosca_paso: raw.rosca_paso ?? null,
    cantidad_piezas: raw.cantidad_piezas ?? null,
    diametro_principal: raw.diametro_principal ?? null,
    descripcion_guiada: raw.descripcion_guiada ?? null,
    codigo_interno: raw.codigo_interno ?? null,
  };
}
