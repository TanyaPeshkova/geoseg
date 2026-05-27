"""
custom.py — Универсальная кастомная сегментационная модель.

Поддерживает:
  - Бинарную сегментацию (1 класс, выход sigmoid > 0.5)
  - Многоклассовую сегментацию (N классов, argmax)

Авто-определение числа классов из state_dict чекпоинта:
  Ищем последний Conv2d слой декодера (segmentation_head)
  и смотрим на out_channels.
"""
from __future__ import annotations

import torch
import torch.nn as nn
import numpy as np
from PIL import Image
import torchvision.transforms as T
from pathlib import Path
import cv2

import segmentation_models_pytorch as smp


# ─── Авто-детект числа классов из state_dict ─────────────────────────────────

def detect_num_classes(state_dict: dict) -> int | None:
    """
    Пробует определить число выходных классов модели UNet (smp) по весам.
    Ищет финальный Conv2d в segmentation_head.
    Возвращает int или None если не удалось.
    """
    # smp.Unet: ключ вида "segmentation_head.0.weight" shape = (num_classes, C, kH, kW)
    for key in sorted(state_dict.keys(), reverse=True):
        if "segmentation_head" in key and key.endswith(".weight"):
            shape = state_dict[key].shape
            if len(shape) == 4:          # Conv2d weight
                return int(shape[0])     # out_channels = num_classes
    # Fallback: ищем любой последний conv с маленьким числом каналов
    candidates = []
    for key, val in state_dict.items():
        if key.endswith(".weight") and len(val.shape) == 4:
            out_ch = int(val.shape[0])
            if 1 <= out_ch <= 64:
                candidates.append((key, out_ch))
    if candidates:
        # Берём последний по имени ключа
        last_key, out_ch = candidates[-1]
        return out_ch
    return None


def inspect_checkpoint(path: str) -> dict:
    """
    Загружает checkpoint и возвращает метаинфо:
      num_classes, encoder_name, img_size, mean, std
    Не бросает исключения — возвращает defaults если что-то не нашлось.
    """
    raw = torch.load(path, map_location="cpu", weights_only=False)

    if isinstance(raw, dict) and "model_state_dict" in raw:
        state_dict = raw["model_state_dict"]
    elif isinstance(raw, dict) and "state_dict" in raw:
        state_dict = raw["state_dict"]
    elif isinstance(raw, dict):
        # Может быть сам state_dict
        # Проверяем: есть ли тензоры напрямую
        has_tensors = any(isinstance(v, torch.Tensor) for v in raw.values())
        if has_tensors:
            state_dict = raw
        else:
            state_dict = {}
    else:
        state_dict = {}

    num_classes = detect_num_classes(state_dict)

    return {
        "num_classes":   num_classes,
        "encoder_name":  raw.get("encoder_name", "efficientnet-b0") if isinstance(raw, dict) else "efficientnet-b0",
        "img_size":      int(raw.get("img_size", 512)) if isinstance(raw, dict) else 512,
        "mean":          raw.get("mean", [0.485, 0.456, 0.406]) if isinstance(raw, dict) else [0.485, 0.456, 0.406],
        "std":           raw.get("std",  [0.229, 0.224, 0.225]) if isinstance(raw, dict) else [0.229, 0.224, 0.225],
    }


# ─── Универсальная модель ─────────────────────────────────────────────────────

class CustomSegModel:
    """
    Кастомная UNet-модель (EfficientNet backbone, smp).
    Работает как с бинарными, так и с многоклассовыми задачами.

    meta — словарь из custom_models.json:
      {
        "key":          "custom_fire",
        "name":         "Пожары",
        "num_classes":  1,
        "classes":      [{"id": 1, "name": "fire", "name_ru": "Пожар", "color": [0,0,255]}],
        "encoder_name": "efficientnet-b0",
        "img_size":     512,
        "mean":         [...],
        "std":          [...],
      }
    """

    def __init__(self, checkpoint_path: str, meta: dict, device: str | None = None):
        if not Path(checkpoint_path).exists():
            raise FileNotFoundError(f"Не найден: {checkpoint_path}")

        self.meta        = meta
        self.num_classes = meta["num_classes"]
        self.classes     = meta["classes"]   # list of {id, name, name_ru, color}
        self.device      = device or ("cuda" if torch.cuda.is_available() else "cpu")

        encoder   = meta.get("encoder_name", "efficientnet-b0")
        img_size  = int(meta.get("img_size", 512))
        mean      = meta.get("mean", [0.485, 0.456, 0.406])
        std       = meta.get("std",  [0.229, 0.224, 0.225])

        # Строим архитектуру
        self.model = smp.Unet(
            encoder_name=encoder,
            encoder_weights=None,
            in_channels=3,
            classes=self.num_classes,
            activation=None,
            decoder_attention_type="scse",
        )

        # Загружаем веса
        raw = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
        if isinstance(raw, dict):
            if "model_state_dict" in raw:
                sd = raw["model_state_dict"]
            elif "state_dict" in raw:
                sd = raw["state_dict"]
            else:
                sd = raw
        else:
            sd = raw

        # strip 'module.' prefix (DataParallel)
        sd = {k.replace("module.", ""): v for k, v in sd.items()}
        self.model.load_state_dict(sd, strict=False)
        self.model.eval().to(self.device)

        self.transform = T.Compose([
            T.Resize((img_size, img_size)),
            T.ToTensor(),
            T.Normalize(mean=mean, std=std),
        ])

    @torch.no_grad()
    def predict_mask(self, image: Image.Image) -> np.ndarray:
        """
        Возвращает маску (H, W) uint8.
        - Бинарная: пиксели 0 или 1
        - Многоклассовая: пиксели 0..N-1 (индексы классов)
        """
        if image.mode != "RGB":
            image = image.convert("RGB")
        orig_w, orig_h = image.size

        tensor = self.transform(image).unsqueeze(0).to(self.device)
        out    = self.model(tensor)  # (1, C, H, W)

        if self.num_classes == 1:
            mask = (torch.sigmoid(out[0, 0]) > 0.5).cpu().numpy().astype(np.uint8)
        else:
            mask = out[0].argmax(dim=0).cpu().numpy().astype(np.uint8)

        return cv2.resize(mask, (orig_w, orig_h), interpolation=cv2.INTER_NEAREST)

    def coverage(self, mask: np.ndarray) -> dict[str, float]:
        """Покрытие каждого класса в маске."""
        total = mask.size
        result = {}
        if self.num_classes == 1:
            result[self.classes[0]["name"]] = float(mask.mean())
        else:
            for cls in self.classes:
                cid = cls["id"]
                result[cls["name"]] = float(np.sum(mask == cid)) / total
        return result
