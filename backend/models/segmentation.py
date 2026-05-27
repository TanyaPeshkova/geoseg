"""
Архитектура всех сегментационных моделей:
  UNet + EfficientNet-B0 + SCSE attention  (segmentation_models_pytorch)

LULC class_map из чекпоинта: {1:0, 2:1, 3:2, 4:3, 5:4, 6:5, 7:6}
  → модель выдаёт индексы 0..6, реальные SEN-LULC метки 1..7
  SEN-LULC классы:
    1=Urban/Built-up, 2=Agriculture, 3=Rangeland,
    4=Forest, 5=Water, 6=Barren, 7=Unknown/bg
"""
from __future__ import annotations
import torch
import torch.nn as nn
import numpy as np
from PIL import Image
import torchvision.transforms as T
import torchvision.models as cls_models
from pathlib import Path
import cv2

import segmentation_models_pytorch as smp


# ─── SEN-LULC: метка → имя класса (метки 1..7 → индексы модели 0..6) ────────
# class_map = {real_label: model_idx}  т.е. {1:0, 2:1, ...}
# Переворачиваем: model_idx → имя
LULC_IDX_TO_NAME = {
    0: "urban",       # label 1 → Urban/Built-up
    1: "agriculture", # label 2 → Agriculture / Fields
    2: "rangeland",   # label 3 → Rangeland / Shrub
    3: "forest",      # label 4 → Forest
    4: "water",       # label 5 → Water
    5: "barren",      # label 6 → Barren / Desert
    6: "background",  # label 7 → Unknown
}

# Имена которые совпадают со спец. моделями (для ансамбля)
LULC_TO_SPEC = {
    "forest":      "forest",
    "water":       "water",
    "urban":       "building",
    "agriculture": None,
    "rangeland":   None,
    "barren":      None,
    "background":  None,
}


# ─────────────────────────────────────────────────────────────────────────────
# БАЗОВЫЙ КЛАСС
# ─────────────────────────────────────────────────────────────────────────────

class BaseSegModel:
    def __init__(self, checkpoint_path: str, device: str | None = None):
        if not Path(checkpoint_path).exists():
            raise FileNotFoundError(f"Не найден: {checkpoint_path}")

        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        raw = torch.load(checkpoint_path, map_location="cpu", weights_only=False)

        self.encoder_name = raw.get("encoder_name", "efficientnet-b0")
        self.img_size     = int(raw.get("img_size", 512))
        mean = raw.get("mean", [0.485, 0.456, 0.406])
        std  = raw.get("std",  [0.229, 0.224, 0.225])
        state_dict = raw["model_state_dict"]

        self.model = self._build_model()
        self.model.load_state_dict(state_dict, strict=True)
        self.model.eval()
        self.model.to(self.device)

        self.transform = T.Compose([
            T.Resize((self.img_size, self.img_size)),
            T.ToTensor(),
            T.Normalize(mean=mean, std=std),
        ])

    def _build_model(self) -> nn.Module:
        raise NotImplementedError

    def _unet(self, classes: int) -> nn.Module:
        return smp.Unet(
            encoder_name=self.encoder_name,
            encoder_weights=None,
            in_channels=3,
            classes=classes,
            activation=None,
            decoder_attention_type="scse",
        )

    @torch.no_grad()
    def predict_mask(self, image: Image.Image) -> np.ndarray:
        if image.mode != "RGB":
            image = image.convert("RGB")
        orig_w, orig_h = image.size

        tensor = self.transform(image).unsqueeze(0).to(self.device)
        out    = self.model(tensor)  # (1, C, H, W)

        if out.shape[1] == 1:
            mask = (torch.sigmoid(out[0, 0]) > 0.5).cpu().numpy().astype(np.uint8)
        else:
            mask = out[0].argmax(dim=0).cpu().numpy().astype(np.uint8)

        return cv2.resize(mask, (orig_w, orig_h), interpolation=cv2.INTER_NEAREST)


# ─────────────────────────────────────────────────────────────────────────────
# МОДЕЛИ
# ─────────────────────────────────────────────────────────────────────────────

class LULCModel(BaseSegModel):
    """7-классовая общая сегментация SEN-LULC."""
    NUM_CLASSES = 7

    def _build_model(self):
        return self._unet(self.NUM_CLASSES)

    def predict_named(self, image: Image.Image) -> dict[str, np.ndarray]:
        """Возвращает {class_name: binary_mask} для каждого класса."""
        raw = self.predict_mask(image)
        return {name: (raw == idx).astype(np.uint8)
                for idx, name in LULC_IDX_TO_NAME.items()}

    def coverage(self, image: Image.Image) -> dict[str, float]:
        raw   = self.predict_mask(image)
        total = raw.size
        return {name: float(np.sum(raw == idx)) / total
                for idx, name in LULC_IDX_TO_NAME.items()}


class WaterModel(BaseSegModel):
    def _build_model(self): return self._unet(1)


class RoadModel(BaseSegModel):
    def _build_model(self): return self._unet(1)


class BuildingModel(BaseSegModel):
    def _build_model(self): return self._unet(1)


class ForestModel(BaseSegModel):
    def _build_model(self): return self._unet(1)


class TerrainClassifier:
    """EfficientNet-B0 классификатор: desert / forest / mountain / plain / urban."""
    CLASSES   = ["desert", "forest", "mountain", "plain", "urban"]
    LABELS_RU = {"desert":"Пустыня","forest":"Лес","mountain":"Горы","plain":"Равнина","urban":"Город"}
    ICONS     = {"desert":"🏜","forest":"🌲","mountain":"🏔","plain":"🌾","urban":"🏙"}

    def __init__(self, checkpoint_path: str, device: str | None = None):
        if not Path(checkpoint_path).exists():
            raise FileNotFoundError(f"Не найден: {checkpoint_path}")
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")

        self.model = cls_models.efficientnet_b0(weights=None)
        self.model.classifier[1] = nn.Linear(
            self.model.classifier[1].in_features, len(self.CLASSES))

        raw = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
        if isinstance(raw, dict):
            for k in ("model_state_dict","state_dict","model"):
                if k in raw: raw = raw[k]; break
        self.model.load_state_dict(
            {k.replace("module.",""): v for k,v in raw.items()}, strict=False)
        self.model.eval().to(self.device)

        self.transform = T.Compose([
            T.Resize((224,224)), T.ToTensor(),
            T.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])])

    @torch.no_grad()
    def classify(self, image: Image.Image) -> dict:
        if image.mode != "RGB": image = image.convert("RGB")
        probs = torch.softmax(
            self.model(self.transform(image).unsqueeze(0).to(self.device))[0], 0
        ).cpu().numpy()
        idx   = int(np.argmax(probs))
        label = self.CLASSES[idx]
        return {"label": label, "label_ru": self.LABELS_RU[label],
                "icon": self.ICONS[label], "confidence": float(probs[idx]),
                "all_probs": {c: float(p) for c,p in zip(self.CLASSES, probs)}}
