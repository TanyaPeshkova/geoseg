"""viz.py — маска → изображения и векторные форматы."""
from __future__ import annotations
import cv2
import numpy as np
import json
import io
import zipfile
import tempfile
import os

from .pipeline import CLASS_COLOR_BGR, CLASS_LABEL_RU, CLASS_ID


# ─── Цветная маска ────────────────────────────────────────────────────────────

def colorize(mask: np.ndarray,
             extra_palette: dict[int, tuple] | None = None) -> np.ndarray:
    out = np.zeros((*mask.shape, 3), dtype=np.uint8)
    palette = {**CLASS_COLOR_BGR}
    if extra_palette:
        palette.update(extra_palette)
    for cid, (b, g, r) in palette.items():
        out[mask == cid] = (r, g, b)
    return out


def colorize_bgr(mask: np.ndarray,
                 extra_palette: dict[int, tuple] | None = None) -> np.ndarray:
    out = np.zeros((*mask.shape, 3), dtype=np.uint8)
    palette = {**CLASS_COLOR_BGR}
    if extra_palette:
        palette.update(extra_palette)
    for cid, bgr in palette.items():
        out[mask == cid] = bgr
    return out


def overlay(orig_bgr: np.ndarray, mask: np.ndarray,
            alpha: float = 0.55,
            extra_palette: dict[int, tuple] | None = None) -> np.ndarray:
    color_bgr = colorize_bgr(mask, extra_palette=extra_palette)
    orig_res  = cv2.resize(orig_bgr, (mask.shape[1], mask.shape[0]))
    blended   = cv2.addWeighted(orig_res, 1 - alpha, color_bgr, alpha, 0)
    return cv2.cvtColor(blended, cv2.COLOR_BGR2RGB)


def contours(orig_bgr: np.ndarray, mask: np.ndarray,
             thickness: int = 2,
             extra_palette: dict[int, tuple] | None = None) -> np.ndarray:
    out = cv2.resize(orig_bgr, (mask.shape[1], mask.shape[0])).copy()
    palette = {**CLASS_COLOR_BGR}
    if extra_palette:
        palette.update(extra_palette)
    for cid, bgr in palette.items():
        if cid == 0:
            continue
        binary = (mask == cid).astype(np.uint8)
        cnts, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(out, cnts, -1, bgr, thickness)
    return cv2.cvtColor(out, cv2.COLOR_BGR2RGB)




# ─── GeoJSON ─────────────────────────────────────────────────────────────────

def _extract_polygons(geom):
    """
    Рекурсивно извлекает Polygon из любой геометрии Shapely
    (Polygon, MultiPolygon, GeometryCollection).
    """
    from shapely.geometry import Polygon, MultiPolygon, GeometryCollection
    if isinstance(geom, Polygon):
        if geom.is_valid and not geom.is_empty:
            return [geom]
    elif isinstance(geom, MultiPolygon):
        result = []
        for g in geom.geoms:
            result.extend(_extract_polygons(g))
        return result
    elif isinstance(geom, GeometryCollection):
        result = []
        for g in geom.geoms:
            result.extend(_extract_polygons(g))
        return result
    return []


def to_geojson(mask: np.ndarray) -> dict:
    """
    Конвертирует маску сегментации в GeoJSON.
    Координаты нормализованы в [0, 1].
    """
    from shapely.geometry import Polygon, mapping
    from shapely.ops import unary_union
    from shapely.validation import make_valid

    h, w = mask.shape

    def px_to_norm(px_coords):
        return [(c / w, 1.0 - r / h) for c, r in px_coords]

    features = []
    for name, cid in CLASS_ID.items():
        if cid == 0 or name == "urban":
            continue

        binary = (mask == cid).astype(np.uint8)
        if binary.sum() == 0:
            continue

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

        cnts, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_TC89_KCOS)
        polys = []
        for c in cnts:
            if cv2.contourArea(c) < 50:
                continue
            eps = 0.003 * cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, eps, True)
            if len(approx) < 3:
                continue

            px_coords = [(float(p[0][0]), float(p[0][1])) for p in approx]
            px_coords.append(px_coords[0])
            norm_coords = px_to_norm(px_coords)

            try:
                p = make_valid(Polygon(norm_coords))
                polys.extend(_extract_polygons(p))
            except Exception:
                continue

        if not polys:
            continue

        merged     = unary_union(polys)
        clean_polys = _extract_polygons(make_valid(merged))
        if not clean_polys:
            continue

        if len(clean_polys) == 1:
            final_geom = clean_polys[0]
        else:
            from shapely.geometry import MultiPolygon
            final_geom = MultiPolygon(clean_polys)

        cov_pct = round(float(np.sum(binary)) / binary.size * 100, 2)
        features.append({
            "type": "Feature",
            "geometry": mapping(final_geom),
            "properties": {
                "class_id":     cid,
                "class_name":   name,
                "label_ru":     CLASS_LABEL_RU.get(cid, name),
                "coverage_pct": cov_pct,
            },
        })

    return {
        "type": "FeatureCollection",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
        },
        "features": features,
    }


# ─── Shapefile ───────────────────────────────────────────────────────────────

def to_shapefile(mask: np.ndarray, out_path: str):
    import shapefile
    geo = to_geojson(mask)
    w   = shapefile.Writer(out_path)
    w.field("label",    "C", 50)
    w.field("class_id", "N",  5)
    w.field("coverage", "N", 10, 4)
    for f in geo["features"]:
        g = f["geometry"]
        p = f["properties"]
        if g["type"] == "Polygon":
            w.poly(g["coordinates"])
        elif g["type"] == "MultiPolygon":
            for part in g["coordinates"]:
                w.poly(part)
        else:
            continue
        w.record(p["label_ru"], p["class_id"], p["coverage_pct"])
    w.close()


# ─── ZIP экспорт ─────────────────────────────────────────────────────────────

def build_zip(mask: np.ndarray, orig_bgr: np.ndarray) -> bytes:
    """
    Для ZIP-файла используем colorize_bgr + imwrite (OpenCV сам разберётся),
    т.к. cv2.imwrite корректно сохраняет BGR в PNG файл.
    overlay и contours тоже берём BGR-версию для файла.
    """
    with tempfile.TemporaryDirectory() as tmp:
        # Для файлов используем BGR — cv2.imwrite пишет корректно
        color_bgr   = colorize_bgr(mask)
        orig_res    = cv2.resize(orig_bgr, (mask.shape[1], mask.shape[0]))
        overlay_bgr = cv2.addWeighted(orig_res, 0.45, color_bgr, 0.55, 0)

        contours_bgr = orig_res.copy()
        for cid, bgr in CLASS_COLOR_BGR.items():
            if cid == 0:
                continue
            binary = (mask == cid).astype(np.uint8)
            cnts, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(contours_bgr, cnts, -1, bgr, 2)

        cv2.imwrite(os.path.join(tmp, "mask.png"),     color_bgr)
        cv2.imwrite(os.path.join(tmp, "overlay.png"),  overlay_bgr)
        cv2.imwrite(os.path.join(tmp, "contours.png"), contours_bgr)

        geo = to_geojson(mask)
        with open(os.path.join(tmp, "segmentation.geojson"), "w", encoding="utf-8") as f:
            json.dump(geo, f, ensure_ascii=False, indent=2)

        try:
            to_shapefile(mask, os.path.join(tmp, "segmentation"))
        except Exception as e:
            print(f"[warn] shapefile: {e}")

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for name in os.listdir(tmp):
                zf.write(os.path.join(tmp, name), name)
        return buf.getvalue()