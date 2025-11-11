// ONNX helper with lazy import to avoid hard dependency when not used
let ort: any = null;
let session: any = null;

export async function ensureOnnxLoaded(modelPath: string) {
  if (!ort) {
    try { ort = await import('onnxruntime-node'); } catch (e) {
      throw new Error('onnxruntime-node is not installed');
    }
  }
  if (!session) {
    session = await ort.InferenceSession.create(modelPath);
  }
  return session;
}

export async function onnxPredict(features: number[], modelPath: string) {
  const s = await ensureOnnxLoaded(modelPath);
  const inputName = s.inputNames[0];
  const outputName = s.outputNames[0];
  const tensor = new ort.Tensor('float32', Float32Array.from(features), [1, features.length]);
  const out = await s.run({ [inputName]: tensor });
  const arr = out[outputName]?.data as Float32Array | number[];
  const y = Array.isArray(arr) ? Number(arr[0]) : Number((arr as any)[0]);
  return y;
}

export default { onnxPredict, ensureOnnxLoaded };

