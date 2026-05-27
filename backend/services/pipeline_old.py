"""
pipeline.py — адаптивный ансамблевый пайплайн.

Логика авто-режима:
  1. Всегда: LULC (общая сегментация) + Terrain (классификация)
  2. Если water  > 3% в LULC → запускаем WaterModel    (IoU 0.81)
  3. Если forest > 3% в LULC → запускаем ForestModel   (IoU 0.82)
  4. Если urban  > 3% в LULC → запускаем BuildingModel (IoU 0.78)
  5. Дороги — только в ручном режиме (нет в LULC классах)
  Спец. маска ПЕРЕЗАПИСЫВАЕТ соответствующие пиксели LULC маски.

Ручной режим:
  Запускаются только модели из selected_models, без coverage-порога.
"""
from __future__ import annotations
import numpy as np
from PIL import Image
from dataclasses import dataclass, field
import time

# ── Единые ID классов в итоговой combined_mask ──────────────────────────────
CLASS_ID = {
    "background": 0,
    "water":      1,
    "forest":     2,
    "building":   3,
    "road":       4,
    "agriculture":5,
    "rangeland":  6,
    "barren":     7,
    "urban":      3,   # urban → building (один цвет)
}

CLASS_COLOR_BGR = {
    0: ( 20,  20,  20),   # background
    1: (200,  90,   0),   # water      — синий
    2: ( 34, 139,  34),   # forest     — зелёный
    3: ( 40,  40, 220),   # building   — красный
    4: ( 20, 160, 255),   # road       — жёлтый
    5: ( 60, 200,  60),   # agriculture— светлозелёный
    6: (100, 180,  80),   # rangeland
    7: ( 60, 130, 200),   # barren
}

CLASS_LABEL_RU = {
    0: "Фон",        1: "Вода",       2: "Лес",
    3: "Здания",     4: "Дороги",     5: "С/х угодья",
    6: "Кустарник",  7: "Пустошь",
}

COVERAGE_THRESHOLD = 0.03   # 3 %

MODEL_IOU = {
    "lulc":0.43,"water":0.81,"forest":0.82,
    "building":0.78,"road":0.74,"terrain":0.91,
}


@dataclass
class PipelineResult:
    combined_mask:  np.ndarray
    coverage:       dict[str, float]   # class_name → 0..1
    terrain:        dict | None
    models_used:    list[str] = field(default_factory=list)
    log:            list[str] = field(default_factory=list)
    ms:             float = 0.0


# ─────────────────────────────────────────────────────────────────────────────

class Pipeline:
    def __init__(self, models: dict):
        self.m = models   # {"lulc","water","road","building","forest","terrain"}

    # -------------------------------------------------------------------------
    def run(
        self,
        image: Image.Image,
        mode: str = "auto",              # "auto" | "manual"
        selected: list[str] | None = None,  # список ключей для ручного режима
    ) -> PipelineResult:

        t0   = time.perf_counter()
        log  = []
        used = []
        h, w = np.array(image).shape[:2]
        combined = np.zeros((h, w), dtype=np.uint8)

        # ── helpers ──────────────────────────────────────────────────────────
        def want(key: str) -> bool:
            """Нужно ли запускать эту модель?"""
            if mode == "auto":
                return True   # авто сам решает по coverage ниже
            return selected is not None and key in selected

        def apply_binary(mask: np.ndarray, class_id: int):
            """Спец. маска перезаписывает combined."""
            combined[mask == 1] = class_id
            combined[(mask == 0) & (combined == class_id)] = 0

        # ── 1. LULC ──────────────────────────────────────────────────────────
        lulc_coverage: dict[str, float] = {}

        if "lulc" in self.m and want("lulc"):
            log.append("▶ lulc — общая сегментация...")
            raw_lulc = self.m["lulc"].predict_mask(image)
            lulc_coverage = self.m["lulc"].coverage(image)
            used.append("lulc")

            # Переносим LULC в combined
            from models.segmentation import LULC_IDX_TO_NAME
            for idx, name in LULC_IDX_TO_NAME.items():
                cid = CLASS_ID.get(name, 0)
                combined[raw_lulc == idx] = cid

            detected = [n for n,v in lulc_coverage.items()
                        if v > COVERAGE_THRESHOLD and n != "background"]
            log.append(f"  классы: {detected}")
        else:
            log.append("  — lulc пропущен")

        # ── 2. Специализированные модели ─────────────────────────────────────
        spec = [
            ("water",    "water",    CLASS_ID["water"]),
            ("forest",   "forest",   CLASS_ID["forest"]),
            ("building", "building", CLASS_ID["building"]),
            ("road",     "road",     CLASS_ID["road"]),
        ]

        for lulc_name, model_key, class_id in spec:
            if model_key not in self.m:
                continue

            if mode == "auto":
                # Авто: запускаем если класс в LULC > порога
                # Для дорог — пропускаем (нет в LULC)
                if model_key == "road":
                    log.append("  — road пропущен в авто-режиме")
                    continue
                if model_key == "building":
                    log.append("  — building пропущен в авто-режиме")
                    continue
                cov = lulc_coverage.get(lulc_name, 0)
                # water в LULC называется "water", forest→"forest", urban→"building"
                if lulc_name == "building":
                    cov = lulc_coverage.get("urban", 0)
                if cov <= COVERAGE_THRESHOLD:
                    log.append(f"  — {model_key}: {cov*100:.1f}% < порог, пропущен")
                    continue
            else:
                # Ручной: только если выбран
                if not (selected and model_key in selected):
                    # Если явно не выбран — убираем его класс из combined
                    combined[combined == class_id] = 0
                    log.append(f"  — {model_key} отключён")
                    continue

            log.append(f"▶ {model_key} — сегментация...")
            spec_mask = self.m[model_key].predict_mask(image)
            apply_binary(spec_mask, class_id)
            used.append(model_key)
            cov_pct = float(spec_mask.mean()) * 100
            log.append(f"  ✓ {model_key}: {cov_pct:.1f}% · IoU {MODEL_IOU.get(model_key,'?')}")

        # ── 3. Terrain ───────────────────────────────────────────────────────
        terrain = None
        if "terrain" in self.m:
            log.append("▶ terrain — классификация рельефа...")
            terrain = self.m["terrain"].classify(image)
            used.append("terrain")
            log.append(f"  ✓ {terrain['icon']} {terrain['label_ru']} {terrain['confidence']*100:.0f}%")

        # ── 4. Итоговое покрытие ─────────────────────────────────────────────
        total = combined.size
        coverage = {
            name: float(np.sum(combined == cid)) / total
            for name, cid in CLASS_ID.items()
            if name not in ("urban",) and cid != 0  # убираем дубль urban
        }

        ms = (time.perf_counter() - t0) * 1000
        log.append(f"✓ Готово за {ms:.0f} мс")

        return PipelineResult(
            combined_mask=combined,
            coverage=coverage,
            terrain=terrain,
            models_used=used,
            log=log,
            ms=ms,
        )
