function bucketize(n, cuts) {
    // returns one-hot buckets for ranges [..c1],(c1..c2],(c2..c3],>c3 for 3 cuts
    const out = Array(cuts.length + 1).fill(0);
    let idx = cuts.findIndex(c => n <= c);
    if (idx === -1)
        idx = cuts.length;
    out[idx] = 1;
    return out;
}
export function parseDescripcion(descRaw) {
    const desc = String(descRaw || '').toLowerCase();
    const materiales = {
        acero: +(desc.includes('acero')),
        aluminio: +(desc.includes('alumin') || desc.includes('alu ')),
        bronce: +(desc.includes('bronce')),
        inox: +(desc.includes('inox') || desc.includes('acero inox')),
        plastico: +(desc.includes('plast') || desc.includes('teflon') || desc.includes('nylon')),
    };
    const procesos = {
        torneado: +(desc.includes('torne') || desc.includes('torno')),
        fresado: +(desc.includes('fresa') || desc.includes('fresad')),
        roscado: +(desc.includes('rosca') || /\bm\d{1,2}\b/.test(desc)),
        taladrado: +(desc.includes('taladr') || desc.includes('perfor')),
        soldadura: +(desc.includes('soldad')),
        pulido: +(desc.includes('pulid') || desc.includes('lij')),
    };
    const domain = {
        rodamiento: +(desc.includes('rodamiento')),
        palier: +(desc.includes('palier') || desc.includes('paliers')),
        buje: +(desc.includes('buje') || desc.includes('bujes')),
        bandeja: +(desc.includes('bandeja') || desc.includes('bandejas')),
        tren_delantero: +(desc.includes('tren delantero')),
        engranaje: +(desc.includes('engranaje') || desc.includes('engranajes')),
        corona: +(desc.includes('corona') || desc.includes('coronas')),
        rellenado: +(desc.includes('rellenado') || desc.includes('rellenar')),
        recargue: +(desc.includes('recargue')),
        prensa: +(desc.includes('prensa')),
        alineado: +(desc.includes('alineado') || desc.includes('alinear')),
        torneado_base: +(desc.includes('tornear base') || desc.includes('torneado base') || desc.includes('tornear la base')),
    };
    const hasRosca = procesos.roscado ? 1 : (/\bm\d{1,2}\b/.test(desc) ? 1 : 0);
    const hasTol = desc.includes('±') || desc.includes('+/-') || /\bh\d\b/.test(desc) || /\bit\d\b/.test(desc) ? 1 : 0;
    const multi = /(\bx\d+\b)|(\bpzas?\b)|(\bpiezas\b)/.test(desc) ? 1 : 0;
    // diámetro simple: buscar patrones tipo ø12, diam 30, d=10
    let diam = NaN;
    const m1 = desc.match(/[øØo\-]?\s?(diam|d\s*[:=]*)?\s*(\d{1,3})\s*(mm)?/i);
    if (m1 && m1[2])
        diam = Number(m1[2]);
    const diamBucket = bucketize(isFinite(diam) ? Number(diam) : 0, [10, 30, 60]);
    const tokens = desc.trim().split(/\s+/).filter(Boolean).length;
    const textBucket = bucketize(tokens, [6, 15]);
    return {
        materiales: materiales,
        procesos: procesos,
        flags: { has_rosca: hasRosca, has_tolerancia: hasTol, multi_piezas: multi },
        diamBucket,
        textBucket,
        domain: domain,
    };
}
export function normalizeSkills(sk) {
    if (!sk)
        return [];
    const toArray = () => {
        if (Array.isArray(sk))
            return sk;
        try {
            return Array.isArray(sk) ? sk : Object.values(sk);
        }
        catch {
            return [];
        }
    };
    const raw = toArray().map((s) => String(s).toLowerCase().trim()).filter(Boolean);
    const canon = [];
    for (const t of raw) {
        // Mapear sinónimos comunes a tokens canónicos que usamos en features/tags
        // Profesiones → procesos
        const map = {
            'tornero': 'torneado',
            'fresador': 'fresado',
            'soldador': 'soldadura',
            'rosquero': 'roscado',
            'taladro': 'taladrado',
            'taladrar': 'taladrado',
            'pulidor': 'pulido',
            'corte': 'taladrado', // aproximación si usan "corte"
            // Dominio
            'tren delantero': 'tren_delantero',
        };
        const domainMap = {
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
        if (map[token])
            token = map[token];
        if (domainMap[token])
            token = domainMap[token];
        // normalizar espacios
        token = token.replace(/\s+/g, '_');
        canon.push(token);
    }
    return Array.from(new Set(canon));
}
export function skillOverlap(workerSkills, tags) {
    if (!workerSkills.length || !tags.length)
        return { overlap: 0, score: 0 };
    const set = new Set(workerSkills.map(s => s.toLowerCase()));
    const matched = tags.reduce((acc, t) => acc + (set.has(t.toLowerCase()) ? 1 : 0), 0);
    const score = Math.max(0, Math.min(1, matched / tags.length));
    return { overlap: matched > 0 ? 1 : 0, score };
}
export function buildBaseAndExtraFeatures(sample) {
    const pr = sample.pedido.prioridad;
    const isAlta = pr === 'ALTA' ? 1 : 0;
    const isMedia = pr === 'MEDIA' ? 1 : 0; // BAJA es baseline
    const precio = typeof sample.pedido.precio === 'object' || typeof sample.pedido.precio === 'string' ? Number(sample.pedido.precio) : (sample.pedido.precio ?? 0);
    const precioNum = isFinite(Number(precio)) ? Number(precio) : 0;
    const y = Math.max(1, sample.tiempo.duracion_sec || 0);
    const useText = String(process.env.ML_FEATURES_TEXT ?? '1') === '1';
    const useSkills = String(process.env.ML_FEATURES_SKILLS ?? '1') === '1';
    const useWorker = String(process.env.ML_FEATURES_WORKER ?? '1') === '1';
    const extraX = [];
    const extraNames = [];
    // Text-derived features
    let tags = [];
    if (useText) {
        const parsed = parseDescripcion(sample.pedido.descripcion);
        const mats = parsed.materiales;
        const procs = parsed.procesos;
        const flags = parsed.flags;
        const { diamBucket, textBucket } = parsed;
        // Materials
        extraNames.push('mat_acero', 'mat_aluminio', 'mat_bronce', 'mat_inox', 'mat_plastico');
        extraX.push(mats.acero, mats.aluminio, mats.bronce, mats.inox, mats.plastico);
        // Processes
        extraNames.push('proc_torneado', 'proc_fresado', 'proc_roscado', 'proc_taladrado', 'proc_soldadura', 'proc_pulido');
        extraX.push(procs.torneado, procs.fresado, procs.roscado, procs.taladrado, procs.soldadura, procs.pulido);
        // Domain tags
        const d = parsed.domain;
        extraNames.push('tag_rodamiento', 'tag_palier', 'tag_buje', 'tag_bandeja', 'tag_tren_delantero', 'tag_engranaje', 'tag_corona', 'tag_rellenado', 'tag_recargue', 'tag_prensa', 'tag_alineado', 'tag_torneado_base');
        extraX.push(d.rodamiento, d.palier, d.buje, d.bandeja, d.tren_delantero, d.engranaje, d.corona, d.rellenado, d.recargue, d.prensa, d.alineado, d.torneado_base);
        // Flags
        extraNames.push('has_rosca', 'has_tolerancia', 'multi_piezas');
        extraX.push(flags.has_rosca, flags.has_tolerancia, flags.multi_piezas);
        // Size buckets
        extraNames.push('diam_b_small', 'diam_b_med', 'diam_b_large', 'diam_b_xlarge');
        extraX.push(...diamBucket);
        // Text length buckets
        extraNames.push('text_short', 'text_med', 'text_long');
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
        ];
    }
    // Skills / worker-derived features
    if (useSkills || useWorker) {
        const skills = normalizeSkills(sample.trabajador?.skills ?? []);
        const { overlap, score } = useSkills ? skillOverlap(skills, tags) : { overlap: 0, score: 0 };
        extraNames.push('skill_overlap', 'skill_overlap_score');
        extraX.push(overlap, score);
        if (useWorker) {
            const carga = Number(sample.trabajador?.carga_actual ?? 0);
            const cargaBuckets = bucketize(isFinite(carga) ? carga : 0, [0, 3, 6]); // 0, 1-3, 4-6, >6
            extraNames.push('carga_b0', 'carga_b1', 'carga_b2', 'carga_b3');
            extraX.push(...cargaBuckets);
            const fi = sample.trabajador?.fecha_ingreso ? new Date(sample.trabajador.fecha_ingreso) : null;
            const days = fi ? Math.max(0, Math.round((Date.now() - fi.getTime()) / 86400000)) : 0;
            const tenureBuckets = bucketize(days, [90, 365, 730]);
            extraNames.push('tenure_b0', 'tenure_b1', 'tenure_b2', 'tenure_b3');
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
export function buildFeaturesFromSample(sample) {
    const pr = sample.pedido.prioridad;
    const isAlta = pr === 'ALTA' ? 1 : 0;
    const isMedia = pr === 'MEDIA' ? 1 : 0; // BAJA es baseline
    const precio = typeof sample.pedido.precio === 'object' || typeof sample.pedido.precio === 'string' ? Number(sample.pedido.precio) : (sample.pedido.precio ?? 0);
    const precioNum = isFinite(precio) ? Number(precio) : 0;
    const x = [1, isAlta, isMedia, precioNum];
    const y = Math.max(1, sample.tiempo.duracion_sec || 0);
    return { x, y };
}
/**
 * Scales precio and expands features to include polynomial and interactions:
 * names: ['bias','prio_ALTA','prio_MEDIA','precio','precio2','prio_ALTA_x_precio','prio_MEDIA_x_precio']
 */
export function normalizeFeatures(xs, meta) {
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
export function featuresForPedido(input, meta) {
    const isAlta = input.prioridad === 'ALTA' ? 1 : 0;
    const isMedia = input.prioridad === 'MEDIA' ? 1 : 0;
    const precioNum = isFinite(Number(input.precio)) ? Number(input.precio) : 0;
    const scaledPrecio = meta.precioScale ? (precioNum - meta.precioScale.mean) / meta.precioScale.std : precioNum;
    const map = {
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
    let tags = [];
    if (useText && Array.isArray(meta.names)) {
        const parsed = parseDescripcion(input.descripcion);
        const mats = parsed.materiales;
        const procs = parsed.procesos;
        const flags = parsed.flags;
        const { diamBucket, textBucket, domain: d } = parsed;
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
            const cb = bucketize(isFinite(carga) ? carga : 0, [0, 3, 6]);
            Object.assign(map, { 'carga_b0': cb[0], 'carga_b1': cb[1], 'carga_b2': cb[2], 'carga_b3': cb[3] });
            const fi = input.fechaIngreso ? new Date(input.fechaIngreso) : null;
            const days = fi ? Math.max(0, Math.round((Date.now() - fi.getTime()) / 86400000)) : 0;
            const tb = bucketize(days, [90, 365, 730]);
            Object.assign(map, { 'tenure_b0': tb[0], 'tenure_b1': tb[1], 'tenure_b2': tb[2], 'tenure_b3': tb[3] });
            Object.assign(map, { 'skill_overlap_x_prio_ALTA': (input.prioridad === 'ALTA' ? 1 : 0) * (useSkills ? score : 0) });
        }
    }
    const names = Array.isArray(meta?.names) && meta.names.length ? meta.names : ['bias', 'prio_ALTA', 'prio_MEDIA', 'precio'];
    return names.map(n => (n in map ? map[n] : 0));
}
