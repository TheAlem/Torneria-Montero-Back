import json
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error
from skl2onnx import to_onnx
from skl2onnx.common.data_types import FloatTensorType

ROOT = Path(__file__).resolve().parents[1]
MODELS_DIR = ROOT / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

ONNX_PATH = MODELS_DIR / "model-eta-v1.onnx"
META_PATH = MODELS_DIR / "meta.json"
CSV_PATH = ROOT / "datasets" / "duraciones.csv"

def sample_dataset():
    data = {
        "prioridad": ["ALTA","MEDIA","BAJA","ALTA","MEDIA","BAJA","ALTA","MEDIA","BAJA"],
        "precio":    [200, 400, 300, 250, 450, 350, 280, 420, 380],
        "duracion_sec": [1800, 3200, 3000, 2000, 3600, 3400, 2200, 3300, 3100],
    }
    return pd.DataFrame(data)

def load_data():
    if CSV_PATH.exists():
        df = pd.read_csv(CSV_PATH)
    else:
        df = sample_dataset()

    df["prio_ALTA"] = (df["prioridad"] == "ALTA").astype(np.float32)
    df["prio_MEDIA"] = (df["prioridad"] == "MEDIA").astype(np.float32)

    precio = df["precio"].astype(np.float32).values
    mean = float(np.mean(precio))
    std = float(np.std(precio)) if float(np.std(precio)) != 0 else 1.0
    precio_norm = (precio - mean) / std

    precio2 = precio_norm ** 2
    alta_x_precio = df["prio_ALTA"].values * precio_norm
    media_x_precio = df["prio_MEDIA"].values * precio_norm

    names = ['bias','prio_ALTA','prio_MEDIA','precio','precio2','prio_ALTA_x_precio','prio_MEDIA_x_precio']

    X = np.column_stack([
        np.ones(len(df), dtype=np.float32),
        df["prio_ALTA"].values.astype(np.float32),
        df["prio_MEDIA"].values.astype(np.float32),
        precio_norm.astype(np.float32),
        precio2.astype(np.float32),
        alta_x_precio.astype(np.float32),
        media_x_precio.astype(np.float32),
    ]).astype(np.float32)

    y = df["duracion_sec"].astype(np.float32).values

    meta = {
        "names": names,
        "precioScale": {"mean": mean, "std": std}
    }

    return X, y, meta

def main():
    X, y, meta = load_data()

    model = HistGradientBoostingRegressor(loss="absolute_error", max_depth=6, learning_rate=0.12, max_iter=400)
    model.fit(X, y)

    yhat = model.predict(X)
    mae = float(mean_absolute_error(y, yhat))
    print(f"MAE (train): {mae:.2f} sec")

    META_PATH.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"✅ Meta guardado en: {META_PATH}")

    onnx_model = to_onnx(model, initial_types=[("input", FloatTensorType([None, X.shape[1]]))], target_opset=12)
    ONNX_PATH.write_bytes(onnx_model.SerializeToString())
    print(f"✅ ONNX guardado en: {ONNX_PATH}")

if __name__ == "__main__":
    main()

