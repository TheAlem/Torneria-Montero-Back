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
  materiales: Record<
    'acero' |
    'acero_1045' |
    'bronce' |
    'bronce_fundido' |
    'bronce_laminado' |
    'bronce_fosforado' |
    'inox' |
    'fundido' |
    'teflon' |
    'nylon' |
    'aluminio',
    number
  >;
  procesos: Record<'torneado'|'fresado'|'roscado'|'taladrado'|'soldadura'|'pulido', number>;
  flags: { has_rosca: number; has_tolerancia: number; multi_piezas: number };
  diamBucket: [number, number, number, number];
  textBucket: [number, number, number];
  // domain-specific tags common in workshop jobs
  domain: Record<
    'rodamiento' | 'palier' | 'buje' | 'bandeja' | 'tren_delantero' |
    'engranaje' | 'corona' | 'rellenado' | 'recargue' | 'prensa' | 'alineado' | 'torneado_base' |
    'amolado' | 'esmerilado' | 'corte' | 'taladro_simple',
    number
  >;
};

function bucketize(n: number, cuts: number[]): number[] {
  // returns one-hot buckets for ranges [..c1],(c1..c2],(c2..c3],>c3 for 3 cuts
  const out = Array(cuts.length + 1).fill(0);
  let idx = cuts.findIndex(c => n <= c);
  if (idx === -1) idx = cuts.length;
  out[idx] = 1;
  return out;
}

function stripAccents(str: string) {
  try { return str.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { return str; }
}

function textHas(text: string, substrings: string[]) {
  return substrings.some(s => text.includes(s));
}

export function parseDescripcion(descRaw?: string | null): ParsedDescripcion {
  const desc = stripAccents(String(descRaw || '').toLowerCase());
  const is1045 = /\b(1045|acero\s*1045|hierro\s*1045)\b/.test(desc) || (desc.includes('1045') && desc.includes('maquinable'));
  const hasBronce = textHas(desc, ['bronc']);
  const isBronceFosforado = textHas(desc, ['bronce fosfor', 'fosforoso', 'fosforado']);
  const isBronceLaminado = textHas(desc, ['bronce laminad', 'laminado']) && hasBronce;
  const isBronceFundido = textHas(desc, ['bronce fundid', 'fundido']) && hasBronce;
  const materiales = {
    acero: +textHas(desc, ['acero']) || +is1045,
    acero_1045: +is1045,
    bronce: +hasBronce,
    bronce_fundido: +isBronceFundido,
    bronce_laminado: +isBronceLaminado,
    bronce_fosforado: +isBronceFosforado,
    inox: +textHas(desc, ['inox', 'acero inox']),
    fundido: +textHas(desc, ['fierro fundido', 'fundido comun', 'fundido común', 'fundicion', 'fundición']),
    teflon: +textHas(desc, ['teflon', 'ptfe']),
    nylon: +textHas(desc, ['nylon', 'nilon', 'nailon']),
    aluminio: +textHas(desc, ['aluminio', 'alu']),
  } as const;
  const domain = {
    rodamiento: +textHas(desc, ['rodamient']),
    palier: +textHas(desc, ['palier', 'paliers']),
    buje: +textHas(desc, ['buje', 'bujes']),
    bandeja: +textHas(desc, ['bandeja', 'bandejas']),
    tren_delantero: +textHas(desc, ['tren delantero', 'tren-delantero']),
    engranaje: +textHas(desc, ['engranaje', 'engranajes']),
    corona: +textHas(desc, ['corona', 'coronas']),
    rellenado: +textHas(desc, ['rellenado', 'rellenar', 'rellen']),
    recargue: +textHas(desc, ['recargue', 'recarg']),
    prensa: +textHas(desc, ['prensa']),
    alineado: +textHas(desc, ['alineado', 'alinear', 'alineac']),
    torneado_base: +textHas(desc, ['tornear base', 'torneado base', 'tornear la base', 'base de asiento']),
    amolado: +textHas(desc, ['amolad', 'amoladora', 'desbaste']),
    esmerilado: +textHas(desc, ['esmeril', 'esmerilad']),
    corte: +textHas(desc, ['corte', 'cortadora']),
    taladro_simple: +textHas(desc, ['taladro simple', 'taladro', 'mecha', 'mechas']),
  } as const;
  const hasSoldadura = textHas(desc, ['soldad', 'solda', 'soldar', 'suelda']);
  const procesos = {
    torneado: +textHas(desc, ['torne', 'torno', 'torn ', 'torni', 'tornear', 'torner', 'torn.']),
    fresado: +textHas(desc, ['fresa', 'fresad', 'fresn']),
    roscado: +(textHas(desc, ['rosca', 'rosc', 'hilo']) || /\bm\d{1,2}\b/.test(desc)),
    taladrado: +textHas(desc, ['taladr', 'perfor', 'agujer', 'mea', 'broca']),
    soldadura: +(hasSoldadura || domain.recargue || domain.rellenado),
    pulido: +textHas(desc, ['pulid', 'lij', 'acabado']),
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
    domain: domain as any,
  };
}

export function normalizeSkills(sk: any): string[] {
  if (!sk) return [];
  const toArray = () => {
    if (Array.isArray(sk)) return sk as any[];
    if (typeof sk === 'string') return sk.split(',').map(s => s.trim()).filter(Boolean);
    try { return Array.isArray(sk) ? (sk as any[]) : Object.values(sk as any); } catch { return []; }
  };
  let raw = toArray().map((s: any) => String(s).toLowerCase().trim()).filter(Boolean);
  if (!Array.isArray(sk) && sk && typeof sk === 'object') {
    const entries = Object.entries(sk as Record<string, any>);
    const keysFromTruthy = entries
      .filter(([, v]) => v === true || v === 1 || v === 'true')
      .map(([k]) => String(k).toLowerCase().trim())
      .filter(Boolean);
    raw = [...raw, ...keysFromTruthy];
  }

  const canon: string[] = [];
  for (const t of raw) {
    // Mapear sinónimos comunes a tokens canónicos que usamos en features/tags
    // Profesiones → procesos
    const map: Record<string, string> = {
      'tornero': 'torneado',
      'torneado': 'torneado',
      'torne': 'torneado',
      'torno': 'torneado',
      'fresador': 'fresado',
      'fresa': 'fresado',
      'soldador': 'soldadura',
      'soldad': 'soldadura',
      'soldar': 'soldadura',
      'solda': 'soldadura',
      'suelda': 'soldadura',
      'rosquero': 'roscado',
      'taladro': 'taladrado',
      'taladrar': 'taladrado',
      'pulidor': 'pulido',
      'corte': 'taladrado', // aproximación si usan "corte"
      // Dominio
      'tren delantero': 'tren_delantero',
    };
    const domainMap: Record<string, string> = {
      'rodamientos': 'rodamiento',
      'palieres': 'palier',
      'bujes': 'buje',
      'bandejas': 'bandeja',
      'engranajes': 'engranaje',
      'coronas': 'corona',
      'recargue': 'recargue',
      'rellenado': 'rellenado',
      'prensa': 'prensa',
      'alineado': 'alineado',
      'torneado base': 'torneado_base',
    };
    let token = t;
    if (map[token]) token = map[token];
    if (domainMap[token]) token = domainMap[token];
    // normalizar espacios
    token = token.replace(/\s+/g, '_');
    canon.push(token);
  }
  return Array.from(new Set(canon));
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
    extraNames.push(
      'mat_acero',
      'mat_acero_1045',
      'mat_bronce',
      'mat_bronce_fundido',
      'mat_bronce_laminado',
      'mat_bronce_fosforado',
      'mat_inox',
      'mat_fundido',
      'mat_teflon',
      'mat_nylon',
      'mat_aluminio'
    );
    extraX.push(
      mats.acero,
      mats.acero_1045,
      mats.bronce,
      mats.bronce_fundido,
      mats.bronce_laminado,
      mats.bronce_fosforado,
      mats.inox,
      mats.fundido,
      mats.teflon,
      mats.nylon,
      mats.aluminio
    );
    // Processes
    extraNames.push('proc_torneado','proc_fresado','proc_roscado','proc_taladrado','proc_soldadura','proc_pulido');
    extraX.push(procs.torneado, procs.fresado, procs.roscado, procs.taladrado, procs.soldadura, procs.pulido);
    // Domain tags
    const d = parsed.domain;
    extraNames.push(
      'tag_rodamiento',
      'tag_palier',
      'tag_buje',
      'tag_bandeja',
      'tag_tren_delantero',
      'tag_engranaje',
      'tag_corona',
      'tag_rellenado',
      'tag_recargue',
      'tag_prensa',
      'tag_alineado',
      'tag_torneado_base',
      'tag_amolado',
      'tag_esmerilado',
      'tag_corte',
      'tag_taladro_simple'
    );
    extraX.push(
      d.rodamiento,
      d.palier,
      d.buje,
      d.bandeja,
      d.tren_delantero,
      d.engranaje,
      d.corona,
      d.rellenado,
      d.recargue,
      d.prensa,
      d.alineado,
      d.torneado_base,
      d.amolado,
      d.esmerilado,
      d.corte,
      d.taladro_simple
    );
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
      ...(mats.acero_1045 ? ['acero_1045'] : []),
      ...(mats.bronce ? ['bronce'] : []),
      ...(mats.bronce_fundido ? ['bronce_fundido'] : []),
      ...(mats.bronce_laminado ? ['bronce_laminado'] : []),
      ...(mats.bronce_fosforado ? ['bronce_fosforado'] : []),
      ...(mats.inox ? ['inox'] : []),
      ...(mats.fundido ? ['fundido'] : []),
      ...(mats.teflon ? ['teflon'] : []),
      ...(mats.nylon ? ['nylon'] : []),
      ...(mats.aluminio ? ['aluminio'] : []),
      ...(procs.torneado ? ['torneado'] : []),
      ...(procs.fresado ? ['fresado'] : []),
      ...(procs.roscado ? ['roscado'] : []),
      ...(procs.taladrado ? ['taladrado'] : []),
      ...(procs.soldadura ? ['soldadura'] : []),
      ...(procs.pulido ? ['pulido'] : []),
      ...(d.rodamiento ? ['rodamiento'] : []),
      ...(d.palier ? ['palier'] : []),
      ...(d.buje ? ['buje'] : []),
      ...(d.bandeja ? ['bandeja'] : []),
      ...(d.tren_delantero ? ['tren_delantero'] : []),
      ...(d.engranaje ? ['engranaje'] : []),
      ...(d.corona ? ['corona'] : []),
      ...(d.rellenado ? ['rellenado'] : []),
      ...(d.recargue ? ['recargue'] : []),
      ...(d.prensa ? ['prensa'] : []),
      ...(d.alineado ? ['alineado'] : []),
      ...(d.torneado_base ? ['torneado_base'] : []),
      ...(d.amolado ? ['amolado'] : []),
      ...(d.esmerilado ? ['esmerilado'] : []),
      ...(d.corte ? ['corte'] : []),
      ...(d.taladro_simple ? ['taladro_simple'] : []),
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
    const { diamBucket, textBucket, domain: d } = parsed;
    Object.assign(map, {
      'mat_acero': mats.acero,
      'mat_acero_1045': mats.acero_1045,
      'mat_bronce': mats.bronce,
      'mat_bronce_fundido': mats.bronce_fundido,
      'mat_bronce_laminado': mats.bronce_laminado,
      'mat_bronce_fosforado': mats.bronce_fosforado,
      'mat_inox': mats.inox,
      'mat_fundido': mats.fundido,
      'mat_teflon': mats.teflon,
      'mat_nylon': mats.nylon,
      'mat_aluminio': mats.aluminio,
      'proc_torneado': procs.torneado,
      'proc_fresado': procs.fresado,
      'proc_roscado': procs.roscado,
      'proc_taladrado': procs.taladrado,
      'proc_soldadura': procs.soldadura,
      'proc_pulido': procs.pulido,
      'tag_rodamiento': d.rodamiento,
      'tag_palier': d.palier,
      'tag_buje': d.buje,
      'tag_bandeja': d.bandeja,
      'tag_tren_delantero': d.tren_delantero,
      'tag_engranaje': d.engranaje,
      'tag_corona': d.corona,
      'tag_rellenado': d.rellenado,
      'tag_recargue': d.recargue,
      'tag_prensa': d.prensa,
      'tag_alineado': d.alineado,
      'tag_torneado_base': d.torneado_base,
      'tag_amolado': d.amolado,
      'tag_esmerilado': d.esmerilado,
      'tag_corte': d.corte,
      'tag_taladro_simple': d.taladro_simple,
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
      ...(mats.acero_1045 ? ['acero_1045'] : []),
      ...(mats.bronce ? ['bronce'] : []),
      ...(mats.bronce_fundido ? ['bronce_fundido'] : []),
      ...(mats.bronce_laminado ? ['bronce_laminado'] : []),
      ...(mats.bronce_fosforado ? ['bronce_fosforado'] : []),
      ...(mats.inox ? ['inox'] : []),
      ...(mats.fundido ? ['fundido'] : []),
      ...(mats.teflon ? ['teflon'] : []),
      ...(mats.nylon ? ['nylon'] : []),
      ...(mats.aluminio ? ['aluminio'] : []),
      ...(procs.torneado ? ['torneado'] : []),
      ...(procs.fresado ? ['fresado'] : []),
      ...(procs.roscado ? ['roscado'] : []),
      ...(procs.taladrado ? ['taladrado'] : []),
      ...(procs.soldadura ? ['soldadura'] : []),
      ...(procs.pulido ? ['pulido'] : []),
      ...(d.rodamiento ? ['rodamiento'] : []),
      ...(d.palier ? ['palier'] : []),
      ...(d.buje ? ['buje'] : []),
      ...(d.bandeja ? ['bandeja'] : []),
      ...(d.tren_delantero ? ['tren_delantero'] : []),
      ...(d.engranaje ? ['engranaje'] : []),
      ...(d.corona ? ['corona'] : []),
      ...(d.rellenado ? ['rellenado'] : []),
      ...(d.recargue ? ['recargue'] : []),
      ...(d.prensa ? ['prensa'] : []),
      ...(d.alineado ? ['alineado'] : []),
      ...(d.torneado_base ? ['torneado_base'] : []),
      ...(d.amolado ? ['amolado'] : []),
      ...(d.esmerilado ? ['esmerilado'] : []),
      ...(d.corte ? ['corte'] : []),
      ...(d.taladro_simple ? ['taladro_simple'] : []),
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

export function computeComplexityScore(parsed: ParsedDescripcion): number {
  const materialCount = Object.values(parsed.materiales).reduce((acc, v) => acc + (v ? 1 : 0), 0);
  const processCount = Object.values(parsed.procesos).reduce((acc, v) => acc + (v ? 1 : 0), 0);
  const domainCount = Object.values(parsed.domain).reduce((acc, v) => acc + (v ? 1 : 0), 0);
  const flagsScore = parsed.flags.has_rosca + parsed.flags.has_tolerancia + parsed.flags.multi_piezas;
  const raw = (0.25 * materialCount) + (0.35 * processCount) + (0.1 * domainCount) + (0.15 * flagsScore);
  return Math.max(0, Math.min(1, raw / 3));
}
