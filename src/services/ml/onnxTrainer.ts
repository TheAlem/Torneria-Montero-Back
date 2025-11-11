import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../prisma/client';
import { reloadOnnxSession } from './onnx';
import { modelsDir, getModelPath } from './storage';

export type OnnxTrainResult = {
  ok: boolean;
  mae_sec?: number | null;
  meta?: any | null;
  pathOnnx: string;
  pathMeta: string;
};

function parseMae(stdout: string): number | null {
  const m = stdout.match(/MAE \(train\):\s*([0-9]+(?:\.[0-9]+)?)\s*sec/i);
  return m ? Number(m[1]) : null;
}

export async function trainOnnxModel(limit?: number): Promise<OnnxTrainResult> {
  const py = process.env.PYTHON_BIN || 'python';
  const script = path.resolve(process.cwd(), 'scripts', 'train.py');
  const dir = modelsDir();
  const pathOnnx = getModelPath();
  const pathMeta = path.join(dir, 'meta.json');

  return new Promise<OnnxTrainResult>((resolve) => {
    let out = '';
    let err = '';
    const env = { ...process.env };
    if (limit && Number.isFinite(limit)) env.ML_TRAIN_LIMIT = String(limit);

    const child = spawn(py, [script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });

    child.on('close', async (code) => {
      const mae = parseMae(out + '\n' + err);
      let meta: any | null = null;
      try { if (fs.existsSync(pathMeta)) meta = JSON.parse(fs.readFileSync(pathMeta, 'utf8')); } catch {}

      const ok = code === 0 && fs.existsSync(pathOnnx);

      try {
        await prisma.historico_modelo.create({
          data: {
            fecha_entrenamiento: new Date(),
            total_pedidos: null,
            mae: mae ?? null,
            precision: null,
            parametros: {
              provider: 'onnx',
              paths: { onnx: pathOnnx, meta: pathMeta },
              meta,
            } as any,
          },
        });
      } catch {}

      try { if (ok) await reloadOnnxSession(pathOnnx); } catch {}

      resolve({ ok, mae_sec: mae ?? null, meta, pathOnnx, pathMeta });
    });
  });
}

export default { trainOnnxModel };

