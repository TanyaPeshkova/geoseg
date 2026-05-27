"""
sam_engine.py — SAM (Segment Anything) integration for GeoSeg AI

Итеративная сегментация:
  1. Начинаем с центра изображения (или сетки точек)
  2. SAM генерирует сегмент по точке
  3. Классифицируем сегмент через LULC-модель (majority vote по пикселям)
  4. Помечаем сегмент как обработанный
  5. Берём следующую точку вне обработанных областей
  6. Повторяем до покрытия >= threshold

Требования:
    pip install segment-anything torch torchvision
    Скачать чекпоинт: sam_vit_b_01ec64.pth (или sam_vit_h)
"""
from __future__ import annotations
import time
import numpy as np
import cv2
from dataclasses import dataclass, field
from typing import Optional
from PIL import Image

import torch

# SAM import (lazy — загрузка при первом вызове)
_sam_model = None
_sam_predictor = None


# ─── Конфигурация ─────────────────────────────────────────────────────────────

@dataclass
class SAMConfig:
    checkpoint: str = "checkpoints/sam_vit_b_01ec64.pth"
    model_type: str = "vit_b"           # vit_b | vit_l | vit_h
    device: str = "cuda"
    min_segment_area: int = 100         # мин. площадь сегмента (пиксели)
    coverage_threshold: float = 0.95    # остановка при 95% покрытии
    max_iterations: int = 500           # макс. итераций
    grid_spacing: int = 64              # шаг сетки для начальных точек
    score_threshold: float = 0.7        # мин. уверенность SAM
    merge_iou_threshold: float = 0.5    # порог IoU для слияния сегментов


# ─── Результат ─────────────────────────────────────────────────────────────────

@dataclass
class SAMSegment:
    segment_id: int
    mask: np.ndarray            # (H, W) bool
    class_id: int               # ID класса из LULC
    class_name: str
    confidence: float           # уверенность SAM
    class_confidence: float     # доля пикселей доминантного класса
    area_pixels: int
    area_fraction: float
    point: tuple[int, int]      # точка, по которой был найден

@dataclass
class SAMResult:
    segments: list[SAMSegment] = field(default_factory=list)
    combined_mask: np.ndarray = None       # (H, W) — ID класса для каждого пикселя
    coverage: float = 0.0
    iterations: int = 0
    ms: float = 0.0
    log: list[str] = field(default_factory=list)


# ─── Загрузка SAM ─────────────────────────────────────────────────────────────

def load_sam(config: SAMConfig):
    """Ленивая загрузка SAM модели."""
    global _sam_model, _sam_predictor

    if _sam_predictor is not None:
        return _sam_predictor

    from segment_anything import sam_model_registry, SamPredictor

    device = config.device
    if device == "cuda" and not torch.cuda.is_available():
        device = "cpu"

    print(f"  [SAM] Загрузка {config.model_type} → {device}")
    sam = sam_model_registry[config.model_type](checkpoint=config.checkpoint)
    sam.to(device)
    sam.eval()

    _sam_model = sam
    _sam_predictor = SamPredictor(sam)
    print(f"  [SAM] ✓ Готов")
    return _sam_predictor


# ─── Классификация сегмента через LULC ────────────────────────────────────────

def classify_segment(
    segment_mask: np.ndarray,
    lulc_mask: np.ndarray,
    idx2name: dict,
    ignore_index: int = 255,
) -> tuple[int, str, float]:
    """
    Определяем класс сегмента по majority vote пикселей LULC-маски.

    Args:
        segment_mask: (H, W) bool — маска сегмента от SAM
        lulc_mask:    (H, W) int  — маска классов от LULC-модели
        idx2name:     {0: 'Water', 1: 'Trees', ...}
        ignore_index: индекс для игнорирования

    Returns:
        (class_id, class_name, confidence)
    """
    # Пиксели LULC внутри сегмента SAM
    pixels = lulc_mask[segment_mask]

    # Убираем ignore
    valid = pixels[pixels != ignore_index]
    if len(valid) == 0:
        return 0, idx2name.get(0, "Unknown"), 0.0

    # Majority vote
    unique, counts = np.unique(valid, return_counts=True)
    best_idx = np.argmax(counts)
    class_id = int(unique[best_idx])
    confidence = float(counts[best_idx]) / len(valid)
    class_name = idx2name.get(class_id, f"Class_{class_id}")

    return class_id, class_name, confidence


def classify_segment_multi(
    segment_mask: np.ndarray,
    model_masks: dict[str, np.ndarray],
    idx2name: dict,
) -> tuple[int, str, float]:
    """
    Классификация через несколько моделей (LULC + water + forest + ...).
    Каждая модель голосует за пиксели внутри сегмента.

    Приоритет: binary-модели (water, road, building, forest) имеют
    больший вес если их уверенность > 50%.
    """
    # Если есть LULC — используем как базу
    if "lulc" in model_masks:
        base_id, base_name, base_conf = classify_segment(
            segment_mask, model_masks["lulc"], idx2name
        )
    else:
        base_id, base_name, base_conf = 0, "Unknown", 0.0

    # Binary модели: water, road, building, forest
    binary_map = {
        "water":    (1, "Water"),
        "road":     (7, "Road"),       # зависит от вашего CLASS_MAP
        "building": (8, "Building"),
        "forest":   (2, "Forest"),
    }

    segment_pixels = segment_mask.sum()
    if segment_pixels == 0:
        return base_id, base_name, base_conf

    for model_key, (cls_id, cls_name) in binary_map.items():
        if model_key not in model_masks:
            continue
        mask = model_masks[model_key]
        # Доля положительных пикселей binary-модели внутри сегмента
        positive = (mask[segment_mask] > 0).sum()
        fraction = float(positive) / segment_pixels

        # Если > 60% пикселей сегмента — этот класс
        if fraction > 0.6:
            return cls_id, cls_name, fraction

    return base_id, base_name, base_conf


# ─── Выбор следующей точки ─────────────────────────────────────────────────────

def next_point_grid(
    covered: np.ndarray,
    h: int, w: int,
    grid_spacing: int = 64,
    iteration: int = 0,
) -> Optional[tuple[int, int]]:
    """
    Выбирает следующую точку из сетки, которая ещё не покрыта.
    На каждой итерации сдвигаем сетку для лучшего покрытия.
    """
    offset_x = (iteration * 17) % grid_spacing  # псевдо-случайный сдвиг
    offset_y = (iteration * 13) % grid_spacing

    ys = np.arange(offset_y, h, grid_spacing)
    xs = np.arange(offset_x, w, grid_spacing)

    # Перемешиваем для разнообразия
    coords = [(y, x) for y in ys for x in xs]
    np.random.shuffle(coords)

    for y, x in coords:
        if not covered[y, x]:
            return (int(x), int(y))  # (x, y) для SAM

    return None


def next_point_largest_uncovered(
    covered: np.ndarray,
) -> Optional[tuple[int, int]]:
    """
    Находит центроид самой большой непокрытой области.
    Более точный, но медленнее.
    """
    uncovered = (~covered).astype(np.uint8)
    if uncovered.sum() == 0:
        return None

    # Находим связные компоненты
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        uncovered, connectivity=8
    )

    if num_labels <= 1:  # только фон
        return None

    # Самая большая компонента (не фон)
    areas = stats[1:, cv2.CC_STAT_AREA]
    largest = np.argmax(areas) + 1
    cx, cy = centroids[largest]

    return (int(cx), int(cy))


# ─── Основной алгоритм ────────────────────────────────────────────────────────

def sam_iterative_segment(
    image: Image.Image,
    lulc_mask: np.ndarray,
    idx2name: dict,
    model_masks: dict[str, np.ndarray] | None = None,
    config: SAMConfig | None = None,
) -> SAMResult:
    """
    Итеративная сегментация SAM + классификация через LULC.

    Алгоритм:
        1. SAM embed изображения (один раз)
        2. Цикл:
           a. Выбираем точку вне покрытой области
           b. SAM predict по точке → маска сегмента
           c. Классифицируем сегмент через LULC-маску
           d. Сохраняем сегмент, помечаем покрытым
        3. Пока покрытие < threshold или итерации < max
    """
    if config is None:
        config = SAMConfig()

    t0 = time.time()
    result = SAMResult()
    result.log.append("[SAM] Старт итеративной сегментации")

    img_np = np.array(image)
    h, w = img_np.shape[:2]
    total_pixels = h * w

    # Загружаем SAM
    try:
        predictor = load_sam(config)
    except Exception as e:
        result.log.append(f"[SAM] ✗ Ошибка загрузки: {e}")
        return result

    # Embed изображения (один раз — дорогая операция)
    result.log.append(f"[SAM] Embedding {w}×{h}...")
    predictor.set_image(img_np)
    result.log.append("[SAM] Embedding ✓")

    # Маска покрытия
    covered = np.zeros((h, w), dtype=bool)

    # Комбинированная маска классов (результат)
    combined = np.full((h, w), -1, dtype=np.int32)

    # Все маски моделей для multi-model classification
    all_masks = model_masks or {}
    if "lulc" not in all_masks:
        all_masks["lulc"] = lulc_mask

    segment_id = 0

    for iteration in range(config.max_iterations):
        # Покрытие
        coverage = covered.sum() / total_pixels
        if coverage >= config.coverage_threshold:
            result.log.append(
                f"[SAM] Покрытие {coverage:.1%} >= {config.coverage_threshold:.0%}, стоп"
            )
            break

        # Выбираем точку
        if iteration < 200:
            point = next_point_grid(covered, h, w, config.grid_spacing, iteration)
        else:
            point = next_point_largest_uncovered(covered)

        if point is None:
            result.log.append("[SAM] Нет непокрытых точек, стоп")
            break

        px, py = point

        # SAM predict
        input_point = np.array([[px, py]])
        input_label = np.array([1])  # foreground

        masks, scores, _ = predictor.predict(
            point_coords=input_point,
            point_labels=input_label,
            multimask_output=True,
        )

        # Берём маску с лучшим score
        best_idx = np.argmax(scores)
        mask = masks[best_idx]
        score = float(scores[best_idx])

        if score < config.score_threshold:
            # Помечаем точку как покрытую чтобы не застревать
            covered[py, px] = True
            continue

        # Убираем уже покрытые пиксели из маски
        mask = mask & ~covered

        # Фильтр по площади
        area = mask.sum()
        if area < config.min_segment_area:
            covered[py, px] = True
            continue

        # Классификация
        if model_masks:
            cls_id, cls_name, cls_conf = classify_segment_multi(
                mask, all_masks, idx2name
            )
        else:
            cls_id, cls_name, cls_conf = classify_segment(
                mask, lulc_mask, idx2name
            )

        # Сохраняем
        segment = SAMSegment(
            segment_id=segment_id,
            mask=mask,
            class_id=cls_id,
            class_name=cls_name,
            confidence=score,
            class_confidence=cls_conf,
            area_pixels=int(area),
            area_fraction=float(area) / total_pixels,
            point=(px, py),
        )
        result.segments.append(segment)

        # Обновляем маски
        combined[mask] = cls_id
        covered |= mask
        segment_id += 1

        if segment_id % 50 == 0:
            result.log.append(
                f"[SAM] {segment_id} сегментов, покрытие {coverage:.1%}"
            )

    # Заполняем оставшиеся пиксели через LULC (fallback)
    uncovered = combined == -1
    if uncovered.any() and lulc_mask is not None:
        combined[uncovered] = lulc_mask[uncovered]
        result.log.append(
            f"[SAM] Fallback: {uncovered.sum()} пикселей заполнены через LULC"
        )

    result.combined_mask = combined.astype(np.uint8)
    result.coverage = float(covered.sum()) / total_pixels
    result.iterations = iteration + 1
    result.ms = (time.time() - t0) * 1000

    result.log.append(
        f"[SAM] Готово: {len(result.segments)} сегментов, "
        f"покрытие {result.coverage:.1%}, {result.ms:.0f}ms"
    )

    return result


# ─── GeoJSON экспорт сегментов ─────────────────────────────────────────────────

def segments_to_geojson(segments: list[SAMSegment]) -> dict:
    """Конвертируем SAM-сегменты в GeoJSON с контурами."""
    features = []

    for seg in segments:
        mask_u8 = seg.mask.astype(np.uint8) * 255
        contours_list, _ = cv2.findContours(
            mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        for cnt in contours_list:
            if len(cnt) < 3:
                continue
            coords = cnt.squeeze().tolist()
            if len(coords) < 3:
                continue
            # Замыкаем полигон
            coords.append(coords[0])

            features.append({
                "type": "Feature",
                "properties": {
                    "segment_id": seg.segment_id,
                    "class_id": seg.class_id,
                    "class_name": seg.class_name,
                    "confidence": round(seg.confidence, 3),
                    "class_confidence": round(seg.class_confidence, 3),
                    "area_pixels": seg.area_pixels,
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [coords],
                },
            })

    return {
        "type": "FeatureCollection",
        "features": features,
    }
