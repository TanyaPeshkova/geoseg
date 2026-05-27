"""
Запуск:
    cd backend
    uvicorn main:app --port 8000
"""
from __future__ import annotations
import io, os, json, base64, traceback, tempfile
import cv2, numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from models import LULCModel, WaterModel, RoadModel, BuildingModel, ForestModel, TerrainClassifier
from models.custom import CustomSegModel, inspect_checkpoint
from services import Pipeline, colorize, overlay, contours, to_geojson, build_zip
from services.model_registry import ModelRegistry

app = FastAPI(title="GeoSeg AI", version="2.1", redirect_slashes=False)
app.add_middleware(CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

CKPT = os.path.join(os.path.dirname(__file__), "checkpoints")

MODELS: dict           = {}
ERRORS: dict           = {}
_cache: dict           = {}
pipeline: Pipeline | None = None
registry: ModelRegistry   = ModelRegistry(CKPT)


def _load(key, cls, fname):
    path = os.path.join(CKPT, fname)
    try:
        MODELS[key] = cls(path)
        print(f"  ✓ {fname}")
    except Exception as e:
        ERRORS[key] = str(e)
        print(f"  ✗ {fname}: {e}")


def _load_custom_model(meta: dict) -> bool:
    global pipeline
    key  = meta["key"]
    path = registry.model_path(key)
    if path is None or not path.exists():
        ERRORS[key] = "Файл не найден"
        return False
    try:
        MODELS[key] = CustomSegModel(str(path), meta)
        print(f"  ✓ custom: {meta['name']} ({key})")
        pipeline = Pipeline(MODELS)
        return True
    except Exception as e:
        ERRORS[key] = str(e)
        print(f"  ✗ custom {key}: {e}")
        return False


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

    custom_list = registry.list_models()
    if custom_list:
        print(f"\n─── Кастомные модели ({len(custom_list)}) ───")
        for meta in custom_list:
            _load_custom_model(meta)

    pipeline = Pipeline(MODELS)
    print(f"\nЗагружено: {list(MODELS.keys())}")
    print("═════════════════════════\n")


# ─── Хелперы ─────────────────────────────────────────────────────────────────

def read_pil(data: bytes) -> Image.Image:
    arr = np.frombuffer(data, np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("Не удалось прочитать изображение")
    return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))

def to_bgr(img: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

def rgb_to_b64(rgb_arr: np.ndarray) -> str:
    """
    RGB numpy array → base64 PNG строка для браузера.
    Используем PIL чтобы избежать BGR/RGB путаницы cv2.imencode.
    PIL работает с RGB напрямую и сохраняет корректно.
    """
    pil_img = Image.fromarray(rgb_arr.astype(np.uint8))
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

def _build_extra_palette(custom_results: list) -> dict:
    """
    Строит extra_palette для colorize/contours из custom_results.
    Ключ — id класса в combined_mask (уже пропатченный dyn_id для бинарных).
    Значение — (B, G, R) tuple.
    """
    palette = {}
    for cr in custom_results:
        for cls in cr["classes"]:
            cid = cls["id"]
            b, g, r = cls["color"]  # color хранится как BGR
            palette[cid] = (b, g, r)
    return palette


# ─── /api/health ─────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {
        "ok":     pipeline is not None,
        "loaded": list(MODELS.keys()),
        "failed": ERRORS,
        "custom": registry.list_models(),
    }


# ─── /api/segment ─────────────────────────────────────────────────────────────

@app.post("/api/segment")
async def segment_image(
    file:             UploadFile = File(...),
    mode:             str        = Form("auto"),
    selected_models:  str        = Form(""),
):
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

    # Диагностика маски
    mask = result.combined_mask
    unique_vals = np.unique(mask).tolist()
    print(f"[segment] mask unique values: {unique_vals}")
    print(f"[segment] mask shape: {mask.shape}, dtype: {mask.dtype}")
    print(f"[segment] models_used: {result.models_used}")

    _cache["mask"]     = mask
    _cache["orig_bgr"] = orig_bgr

    # colorize/overlay/contours возвращают RGB после исправления viz.py
    extra = _build_extra_palette(result.custom_results)
    print(f"[DEBUG] extra_palette: {extra}")          # ← добавь
    print(f"[DEBUG] custom_results: {result.custom_results}")  # ← добавь

    color_rgb = colorize(mask,    extra_palette=extra)
    ov_rgb    = overlay(orig_bgr, mask, extra_palette=extra)
    cnt_rgb   = contours(orig_bgr, mask, extra_palette=extra)

    print(f"[segment] color_rgb unique pixels sample: {np.unique(color_rgb.reshape(-1,3), axis=0)[:5]}")
    print(f"[DEBUG] mask unique: {np.unique(mask).tolist()}")
    print(f"[DEBUG] mask shape: {mask.shape}")
    print(f"[DEBUG] color_rgb shape: {color_rgb.shape}")
    print(f"[DEBUG] color_rgb max: {color_rgb.max()}")
    print(f"[DEBUG] models_used: {result.models_used}")
    print(f"[DEBUG] log:\n" + "\n".join(result.log))
    print(f"[DEBUG] color_rgb всех уникальных цветов: {np.unique(color_rgb.reshape(-1,3), axis=0).tolist()}")

    return JSONResponse({
        "terrain":        result.terrain,
        "coverage":       {k: round(v*100, 2) for k,v in result.coverage.items()},
        "models_used":    result.models_used,
        "custom_results": result.custom_results,
        "log":            result.log,
        "ms":             round(result.ms),
        "size":           [image.height, image.width],
        "images": {
            "mask":     rgb_to_b64(color_rgb),
            "overlay":  rgb_to_b64(ov_rgb),
            "contours": rgb_to_b64(cnt_rgb),
        },
    })


# ─── /api/export ─────────────────────────────────────────────────────────────

@app.post("/api/export/{fmt}")
async def export(fmt: str):
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


# ══════════════════════════════════════════════════════════════════════════════
# КАСТОМНЫЕ МОДЕЛИ
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/models/inspect")
async def inspect_model(file: UploadFile = File(...)):
    raw = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".pth", delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        info = inspect_checkpoint(tmp_path)
        return JSONResponse(info)
    except Exception as e:
        raise HTTPException(400, f"Не удалось прочитать checkpoint: {e}")
    finally:
        os.unlink(tmp_path)


@app.post("/api/models/upload")
async def upload_model(
    file:         UploadFile = File(...),
    name:         str        = Form(...),
    description:  str        = Form(""),
    num_classes:  int        = Form(...),
    model_type:   str        = Form(...),
    classes_json: str        = Form(...),
    encoder_name: str        = Form("efficientnet-b0"),
    img_size:     int        = Form(512),
    mean_json:    str        = Form(""),
    std_json:     str        = Form(""),
):
    if not file.filename.endswith(".pth"):
        raise HTTPException(400, "Ожидается файл .pth")

    try:
        classes = json.loads(classes_json)
    except json.JSONDecodeError:
        raise HTTPException(400, "Некорректный JSON классов")

    mean = json.loads(mean_json) if mean_json.strip() else None
    std  = json.loads(std_json)  if std_json.strip()  else None

    pth_bytes = await file.read()

    try:
        meta = registry.add_model(
            pth_bytes    = pth_bytes,
            name         = name,
            num_classes  = num_classes,
            model_type   = model_type,
            classes      = classes,
            description  = description,
            encoder_name = encoder_name,
            img_size     = img_size,
            mean         = mean,
            std          = std,
        )
    except Exception as e:
        raise HTTPException(500, f"Ошибка сохранения: {e}")

    ok = _load_custom_model(meta)
    if not ok:
        err = ERRORS.get(meta["key"], "неизвестная ошибка")
        registry.delete_model(meta["key"])
        raise HTTPException(500, f"Модель зарегистрирована, но не загружена: {err}")
    
    return JSONResponse({
        "ok":   True,
        "meta": meta,
        "msg":  f"Модель «{name}» добавлена и загружена",
    })


@app.get("/api/models/custom")
def list_custom_models():
    models = registry.list_models()
    for m in models:
        m["loaded"] = m["key"] in MODELS
        m["error"]  = ERRORS.get(m["key"])
    return JSONResponse(models)


@app.delete("/api/models/custom/{key}")
def delete_custom_model(key: str):
    global pipeline

    if not key.startswith("custom_"):
        raise HTTPException(400, "Можно удалять только кастомные модели")

    MODELS.pop(key, None)
    ERRORS.pop(key, None)
    pipeline = Pipeline(MODELS)

    deleted = registry.delete_model(key)
    if not deleted:
        raise HTTPException(404, f"Модель {key} не найдена")


    return JSONResponse({"ok": True, "msg": f"Модель {key} удалена"})