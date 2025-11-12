import { pedidos, tiempos, trabajadores } from '@prisma/client';

export type FeatureVector = number[];

export type FeatureMeta = {
  // names in order
  names: string[];
  // normalization info, if any
  precioScale?: { mean: number; std: number } | null;
};

// --- Text parsing helpers to extract simple, explainable signals ---
export type ParsedDescripcion = {
  materiales: Record<'acero'|'aluminio'|'bronce'|'inox'|'plastico', number>;
  procesos: Record<'torneado'|'fresado'|'roscado'|'taladrado'|'soldadura'|'pulido', number>;
  flags: { has_rosca: number; has_tolerancia: number; multi_piezas: number };
  diamBucket: [number, number, number, number];
  textBucket: [number, number, number];
};

function bucketize(n: number, cuts: number[]): number[] {
  // returns one-hot buckets for ranges [..c1],(c1..c2],(c2..c3],>c3 for 3 cuts
  const out = Array(cuts.length + 1).fill(0);
  let idx = cuts.findIndex(c => n <= c);
  if (idx === -1) idx = cuts.length;
  out[idx] = 1;
  return out;
}

export function parseDescripcion(descRaw?: string | null): ParsedDescripcion {
  const desc = String(descRaw || '').toLowerCase();
  const materiales = {
    acero: +(desc.includes('acero')),
    aluminio: +(desc.includes('alumin') || desc.includes('alu ')),
    bronce: +(desc.includes('bronce')),
    inox: +(desc.includes('inox') || desc.includes('acero inox')),
    plastico: +(desc.includes('plast') || desc.includes('teflon') || desc.includes('nylon')),
  } as const;
  const procesos = {
    torneado: +(desc.includes('torne') || desc.includes('torno')),
    fresado: +(desc.includes('fresa') || desc.includes('fresad')),
    roscado: +(desc.includes('rosca') || /\bm\d{1,2}\b/.test(desc)),
    taladrado: +(desc.includes('taladr') || desc.includes('perfor')),
    soldadura: +(desc.includes('soldad')),
    pulido: +(desc.includes('pulid') || desc.includes('lij')),
  } as const;
  const hasRosca = procesos.roscado ? 1 : (/\bm\d{1,2}\b/.test(desc) ? 1 : 0);
  const hasTol = desc.includes('±') || desc.includes('+/-') || /\bh\d\b/.test(desc) || /\bit\d\b/.test(desc) ? 1 : 0;
  const multi = /(\bx\d+\b)|(\bpzas?\b)|(\bpiezas\b)/.test(desc) ? 1 : 0;
  // diámetro simple: buscar patrones tipo ø12, diam 30, d=10
  let diam = NaN;
  const m1 = desc.match(/[øØo\-]?\s?(diam|d\s*[:=]*)?\s*(\d{1,3})\s*(mm)?/i);
  if (m1 && m1[2]) diam = Number(m1[2]);
  const diamBucket = bucketize(isFinite(diam) ? Number(diam) : 0, [10, 30, 60]) as [number,number,number,number];
  const tokens = desc.trim().split(/\s+/).filter(Boolean).length;
  const textBucket = bucketize(tokens, [6, 15]) as [number,number,number];
  return {
    materiales: materiales as any,
    procesos: procesos as any,
    flags: { has_rosca: hasRosca, has_tolerancia: hasTol, multi_piezas: multi },
    diamBucket,
    textBucket,
  };
}

export function normalizeSkills(sk: any): string[] {
  if (!sk) return [];
  if (Array.isArray(sk)) return sk.map(String).map(s => s.toLowerCase().trim()).filter(Boolean);
  try {
    const arr = Array.isArray((sk as any)) ? (sk as any) : Object.values(sk as any);
    return arr.map((s: any) => String(s).toLowerCase().trim()).filter(Boolean);
  } catch { return []; }
}

export function skillOverlap(workerSkills: string[], tags: string[]): { overlap: number; score: number } {
  if (!workerSkills.length || !tags.length) return { overlap: 0, score: 0 };
  const set = new Set(workerSkills.map(s => s.toLowerCase()));
  const matched = tags.reduce((acc, t) => acc + (set.has(t.toLowerCase()) ? 1 : 0), 0);
  const score = Math.max(0, Math.min(1, matched / tags.length));
  return { overlap: matched > 0 ? 1 : 0, score };
}

export type ExtendedSample = {
  pedido: Pick<pedidos, 'prioridad' | 'precio' | 'descripcion'>;
  tiempo: Pick<tiempos, 'duracion_sec'>;
  trabajador?: Pick<trabajadores, 'skills' | 'carga_actual' | 'fecha_ingreso'> | null;
};

export function buildBaseAndExtraFeatures(sample: ExtendedSample): { xBase: FeatureVector; extraX: FeatureVector; extraNames: string[]; y: number } {
  const pr = sample.pedido.prioridad;
  const isAlta = pr === 'ALTA' ? 1 : 0;
  const isMedia = pr === 'MEDIA' ? 1 : 0; // BAJA es baseline
  const precio = typeof sample.pedido.precio === 'object' || typeof sample.pedido.precio === 'string' ? Number(sample.pedido.precio as any) : (sample.pedido.precio ?? 0);
  const precioNum = isFinite(Number(precio)) ? Number(precio) : 0;
  const y = Math.max(1, sample.tiempo.duracion_sec || 0);

  const useText = String(process.env.ML_FEATURES_TEXT ?? '1') === '1';
  const useSkills = String(process.env.ML_FEATURES_SKILLS ?? '1') === '1';
  const useWorker = String(process.env.ML_FEATURES_WORKER ?? '1') === '1';

  const extraX: number[] = [];
  const extraNames: string[] = [];

  // Text-derived features
  let tags: string[] = [];
  if (useText) {
    const parsed = parseDescripcion(sample.pedido.descripcion);
    const mats = parsed.materiales;
    const procs = parsed.procesos;
    const flags = parsed.flags;
    const { diamBucket, textBucket } = parsed;
    // Materials
    extraNames.push('mat_acero','mat_aluminio','mat_bronce','mat_inox','mat_plastico');
    extraX.push(mats.acero, mats.aluminio, mats.bronce, mats.inox, mats.plastico);
    // Processes
    extraNames.push('proc_torneado','proc_fresado','proc_roscado','proc_taladrado','proc_soldadura','proc_pulido');
    extraX.push(procs.torneado, procs.fresado, procs.roscado, procs.taladrado, procs.soldadura, procs.pulido);
    // Flags
    extraNames.push('has_rosca','has_tolerancia','multi_piezas');
    extraX.push(flags.has_rosca, flags.has_tolerancia, flags.multi_piezas);
    // Size buckets
    extraNames.push('diam_b_small','diam_b_med','diam_b_large','diam_b_xlarge');
    extraX.push(...diamBucket);
    // Text length buckets
    extraNames.push('text_short','text_med','text_long');
    extraX.push(...textBucket);
    // Tags for skill overlap
    tags = [
      ...(mats.acero ? ['acero'] : []),
      ...(mats.aluminio ? ['aluminio'] : []),
      ...(mats.bronce ? ['bronce'] : []),
      ...(mats.inox ? ['inox'] : []),
      ...(procs.torneado ? ['torneado'] : []),
      ...(procs.fresado ? ['fresado'] : []),
      ...(procs.roscado ? ['roscado'] : []),
      ...(procs.taladrado ? ['taladrado'] : []),
      ...(procs.soldadura ? ['soldadura'] : []),
      ...(procs.pulido ? ['pulido'] : []),
    ];
  }

  // Skills / worker-derived features
  if (useSkills || useWorker) {
    const skills = normalizeSkills(sample.trabajador?.skills ?? []);
    const { overlap, score } = useSkills ? skillOverlap(skills, tags) : { overlap: 0, score: 0 };
    extraNames.push('skill_overlap','skill_overlap_score');
    extraX.push(overlap, score);

    if (useWorker) {
      const carga = Number((sample.trabajador as any)?.carga_actual ?? 0);
      const cargaBuckets = bucketize(isFinite(carga) ? carga : 0, [0, 3, 6]); // 0, 1-3, 4-6, >6
      extraNames.push('carga_b0','carga_b1','carga_b2','carga_b3');
      extraX.push(...cargaBuckets);
      const fi = sample.trabajador?.fecha_ingreso ? new Date(sample.trabajador.fecha_ingreso as any) : null;
      const days = fi ? Math.max(0, Math.round((Date.now() - fi.getTime()) / 86400000)) : 0;
      const tenureBuckets = bucketize(days, [90, 365, 730]);
      extraNames.push('tenure_b0','tenure_b1','tenure_b2','tenure_b3');
      extraX.push(...tenureBuckets);

      // Interaction: skill overlap x prio ALTA (only gate by useSkills)
      extraNames.push('skill_overlap_x_prio_ALTA');
      extraX.push((pr === 'ALTA' ? 1 : 0) * (useSkills ? score : 0));
    }
  }

  const xBase = [1, isAlta, isMedia, precioNum];
  return { xBase, extraX, extraNames, y };
}

/**
 * Base features from a DB sample. We initially return minimal columns
 * [1, isAlta, isMedia, precio] and let normalizeFeatures expand/scale
 * into richer features (precio^2, interactions) for training.
 */
export function buildFeaturesFromSample(sample: { pedido: Pick<pedidos, 'prioridad' | 'precio'>; tiempo: Pick<tiempos, 'duracion_sec'> }): { x: FeatureVector; y: number } {
  const pr = sample.pedido.prioridad;
  const isAlta = pr === 'ALTA' ? 1 : 0;
  const isMedia = pr === 'MEDIA' ? 1 : 0; // BAJA es baseline
  const precio = typeof sample.pedido.precio === 'object' || typeof sample.pedido.precio === 'string' ? Number(sample.pedido.precio as any) : (sample.pedido.precio ?? 0);
  const precioNum = isFinite(precio) ? Number(precio) : 0;

  const x = [1, isAlta, isMedia, precioNum];
  const y = Math.max(1, sample.tiempo.duracion_sec || 0);
  return { x, y };
}

/**
 * Scales precio and expands features to include polynomial and interactions:
 * names: ['bias','prio_ALTA','prio_MEDIA','precio','precio2','prio_ALTA_x_precio','prio_MEDIA_x_precio']
 */
export function normalizeFeatures(xs: FeatureVector[], meta?: FeatureMeta): { xs: FeatureVector[]; meta: FeatureMeta } {
  // xs columns (incoming): [bias, isAlta, isMedia, precio]
  const precioCol = xs.map(row => row[3] ?? 0);
  const mean = precioCol.reduce((a, b) => a + b, 0) / (precioCol.length || 1);
  const variance = precioCol.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (precioCol.length || 1);
  const std = Math.sqrt(variance) || 1;
  const scaled = xs.map(row => {
    const bias = row[0];
    const isAlta = row[1];
    const isMedia = row[2];
    const scaledPrecio = ((row[3] ?? 0) - mean) / std;
    const precio2 = scaledPrecio * scaledPrecio;
    const altaXP = isAlta * scaledPrecio;
    const mediaXP = isMedia * scaledPrecio;
    return [bias, isAlta, isMedia, scaledPrecio, precio2, altaXP, mediaXP];
  });
  const names = ['bias', 'prio_ALTA', 'prio_MEDIA', 'precio', 'precio2', 'prio_ALTA_x_precio', 'prio_MEDIA_x_precio'];
  return { xs: scaled, meta: { names, precioScale: { mean, std } } };
}

/**
 * Build an inference feature vector based on meta.names to keep
 * backward compatibility with older models (4 features) and
 * support newer expanded models (7 features).
 */
export function featuresForPedido(
  input: {
    prioridad: 'ALTA' | 'MEDIA' | 'BAJA';
    precio?: number | null;
    descripcion?: string | null;
    workerSkills?: any;
    cargaActual?: number | null;
    fechaIngreso?: string | Date | null;
  },
  meta: FeatureMeta
): FeatureVector {
  const isAlta = input.prioridad === 'ALTA' ? 1 : 0;
  const isMedia = input.prioridad === 'MEDIA' ? 1 : 0;
  const precioNum = isFinite(Number(input.precio)) ? Number(input.precio) : 0;
  const scaledPrecio = meta.precioScale ? (precioNum - meta.precioScale.mean) / meta.precioScale.std : precioNum;

  const map: Record<string, number> = {
    'bias': 1,
    'prio_ALTA': isAlta,
    'prio_MEDIA': isMedia,
    'precio': scaledPrecio,
    'precio2': scaledPrecio * scaledPrecio,
    'prio_ALTA_x_precio': isAlta * scaledPrecio,
    'prio_MEDIA_x_precio': isMedia * scaledPrecio,
  };

  // Optional extended features gated by meta.names
  const useText = true; // inference respects meta.names; training decides
  const useSkills = true;
  const useWorker = true;
  let tags: string[] = [];
  if (useText && Array.isArray(meta.names)) {
    const parsed = parseDescripcion(input.descripcion);
    const mats = parsed.materiales;
    const procs = parsed.procesos;
    const flags = parsed.flags;
    const { diamBucket, textBucket } = parsed;
    Object.assign(map, {
      'mat_acero': mats.acero,
      'mat_aluminio': mats.aluminio,
      'mat_bronce': mats.bronce,
      'mat_inox': mats.inox,
      'mat_plastico': mats.plastico,
      'proc_torneado': procs.torneado,
      'proc_fresado': procs.fresado,
      'proc_roscado': procs.roscado,
      'proc_taladrado': procs.taladrado,
      'proc_soldadura': procs.soldadura,
      'proc_pulido': procs.pulido,
      'has_rosca': flags.has_rosca,
      'has_tolerancia': flags.has_tolerancia,
      'multi_piezas': flags.multi_piezas,
      'diam_b_small': diamBucket[0],
      'diam_b_med': diamBucket[1],
      'diam_b_large': diamBucket[2],
      'diam_b_xlarge': diamBucket[3],
      'text_short': textBucket[0],
      'text_med': textBucket[1],
      'text_long': textBucket[2],
    });
    tags = [
      ...(mats.acero ? ['acero'] : []),
      ...(mats.aluminio ? ['aluminio'] : []),
      ...(mats.bronce ? ['bronce'] : []),
      ...(mats.inox ? ['inox'] : []),
      ...(procs.torneado ? ['torneado'] : []),
      ...(procs.fresado ? ['fresado'] : []),
      ...(procs.roscado ? ['roscado'] : []),
      ...(procs.taladrado ? ['taladrado'] : []),
      ...(procs.soldadura ? ['soldadura'] : []),
      ...(procs.pulido ? ['pulido'] : []),
    ];
  }
  if (useSkills || useWorker) {
    const skills = normalizeSkills(input.workerSkills ?? []);
    const { overlap, score } = useSkills ? skillOverlap(skills, tags) : { overlap: 0, score: 0 };
    Object.assign(map, { 'skill_overlap': overlap, 'skill_overlap_score': score });
    if (useWorker) {
      const carga = Number(input.cargaActual ?? 0);
      const cb = bucketize(isFinite(carga) ? carga : 0, [0,3,6]);
      Object.assign(map, { 'carga_b0': cb[0], 'carga_b1': cb[1], 'carga_b2': cb[2], 'carga_b3': cb[3] });
      const fi = input.fechaIngreso ? new Date(input.fechaIngreso as any) : null;
      const days = fi ? Math.max(0, Math.round((Date.now() - fi.getTime()) / 86400000)) : 0;
      const tb = bucketize(days, [90,365,730]);
      Object.assign(map, { 'tenure_b0': tb[0], 'tenure_b1': tb[1], 'tenure_b2': tb[2], 'tenure_b3': tb[3] });
      Object.assign(map, { 'skill_overlap_x_prio_ALTA': (input.prioridad === 'ALTA' ? 1 : 0) * (useSkills ? score : 0) });
    }
  }

  const names = Array.isArray(meta?.names) && meta.names.length ? meta.names : ['bias','prio_ALTA','prio_MEDIA','precio'];
  return names.map(n => (n in map ? map[n] : 0));
}

