"""
Запуск:
    cd backend
    uvicorn main:app --port 8000
"""
from __future__ import annotations
import io, os, json, base64, traceback
import cv2, numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from models import LULCModel, WaterModel, RoadModel, BuildingModel, ForestModel, TerrainClassifier
from services import Pipeline, colorize, overlay, contours, to_geojson, build_zip

app = FastAPI(title="GeoSeg AI", version="2.0")
app.add_middleware(CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

CKPT = os.path.join(os.path.dirname(__file__), "checkpoints")

# ─── Загрузка моделей ─────────────────────────────────────────────────────────
MODELS: dict  = {}
ERRORS: dict  = {}
_cache: dict  = {}   # кэш последней сегментации для экспорта
pipeline: Pipeline | None = None


def _load(key, cls, fname):
    path = os.path.join(CKPT, fname)
    try:
        MODELS[key] = cls(path)
        print(f"  ✓ {fname}")
    except Exception as e:
        ERRORS[key] = str(e)
        print(f"  ✗ {fname}: {e}")


@app.on_event("startup")
async def startup():
    global pipeline
    print("\n═══ Загрузка моделей ═══")
    _load("lulc",     LULCModel,        "lulc_checkpoint_1.pth")
    _load("water",    WaterModel,        "water_bodies_checkpoint.pth")
    _load("road",     RoadModel,         "road_seg_checkpoint.pth")
    _load("building", BuildingModel,     "building_seg_checkpoint.pth")
    _load("forest",   ForestModel,       "forest_seg_checkpoint.pth")
    _load("terrain",  TerrainClassifier, "terrain_checkpoint.pth")
    pipeline = Pipeline(MODELS)
    print(f"Загружено: {list(MODELS.keys())}")
    print("═════════════════════════\n")


# ─── Хелперы ─────────────────────────────────────────────────────────────────

def read_pil(data: bytes) -> Image.Image:
    arr = np.frombuffer(data, np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None: raise ValueError("Не удалось прочитать изображение")
    return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))

def to_bgr(img: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

def b64(arr: np.ndarray) -> str:
    _, buf = cv2.imencode(".png", arr)
    return base64.b64encode(buf).decode()


# ─── /api/health ─────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {
        "ok": pipeline is not None,
        "loaded": list(MODELS.keys()),
        "failed": ERRORS,
    }


# ─── /api/segment ─────────────────────────────────────────────────────────────

@app.post("/api/segment")
async def segment(
    file:             UploadFile = File(...),
    mode:             str        = Form("auto"),
    selected_models:  str        = Form(""),
):
    """
    mode: "auto" | "manual"
    selected_models: "lulc,water,forest" (через запятую, только для manual)
    """
    if pipeline is None:
        raise HTTPException(503, "Модели не загружены")

    raw = await file.read()
    try:
        image = read_pil(raw)
    except ValueError as e:
        raise HTTPException(400, str(e))

    selected = None
    if mode == "manual" and selected_models.strip():
        selected = [s.strip() for s in selected_models.split(",") if s.strip()]

    try:
        result = pipeline.run(image, mode=mode, selected=selected)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))

    orig_bgr = to_bgr(image)

    # Кэшируем для экспорта
    _cache["mask"]     = result.combined_mask
    _cache["orig_bgr"] = orig_bgr

    color   = colorize(result.combined_mask)
    ov      = overlay(orig_bgr, result.combined_mask)
    cnt     = contours(orig_bgr, result.combined_mask)

    return JSONResponse({
        "terrain":     result.terrain,
        "coverage":    {k: round(v*100, 2) for k,v in result.coverage.items()},
        "models_used": result.models_used,
        "log":         result.log,
        "ms":          round(result.ms),
        "size":        [image.height, image.width],
        "images": {
            "mask":     b64(color),
            "overlay":  b64(ov),
            "contours": b64(cnt),
        },
    })


# ─── /api/export ─────────────────────────────────────────────────────────────

@app.post("/api/export/{fmt}")
async def export(fmt: str):
    """fmt: geojson | zip"""
    if fmt not in ("geojson", "zip"):
        raise HTTPException(400, "Допустимые форматы: geojson, zip")
    if not _cache:
        raise HTTPException(400, "Сначала выполните сегментацию")

    mask     = _cache["mask"]
    orig_bgr = _cache["orig_bgr"]

    try:
        if fmt == "geojson":
            geo = to_geojson(mask)
            return StreamingResponse(
                io.BytesIO(json.dumps(geo, ensure_ascii=False, indent=2).encode()),
                media_type="application/geo+json",
                headers={"Content-Disposition": "attachment; filename=segmentation.geojson"})

        data = build_zip(mask, orig_bgr)
        return StreamingResponse(
            io.BytesIO(data),
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=geoseg_export.zip"})

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))
