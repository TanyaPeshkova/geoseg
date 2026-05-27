"""
model_registry.py — реестр кастомных моделей.

Хранит метаданные в  <checkpoints_dir>/custom/registry.json
Файлы .pth хранятся в <checkpoints_dir>/custom/<key>.pth

Структура registry.json:
[
  {
    "key":          "custom_fire",          # уникальный slug
    "name":         "Пожары",               # отображаемое имя
    "description":  "...",                  # описание (опц.)
    "num_classes":  1,
    "model_type":   "binary" | "multiclass",
    "classes": [
      {"id": 1, "name": "fire", "name_ru": "Пожар", "color": [255, 80, 0]}
    ],
    "encoder_name": "efficientnet-b0",
    "img_size":     512,
    "mean":         [0.485, 0.456, 0.406],
    "std":          [0.229, 0.224, 0.225],
    "created_at":   "2025-01-01T12:00:00",
    "file":         "custom_fire.pth"
  },
  ...
]
"""
from __future__ import annotations

import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any


REGISTRY_FILENAME = "registry.json"


class ModelRegistry:
    def __init__(self, checkpoints_dir: str):
        self.ckpt_dir    = Path(checkpoints_dir)
        self.custom_dir  = self.ckpt_dir / "custom"
        self.custom_dir.mkdir(parents=True, exist_ok=True)
        self.registry_path = self.custom_dir / REGISTRY_FILENAME

    # ─── Чтение/запись реестра ───────────────────────────────────────────────

    def _load(self) -> list[dict]:
        if not self.registry_path.exists():
            return []
        try:
            with open(self.registry_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return []

    def _save(self, data: list[dict]):
        with open(self.registry_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    # ─── Публичные методы ────────────────────────────────────────────────────

    def list_models(self) -> list[dict]:
        """Возвращает список всех кастомных моделей."""
        return self._load()

    def get_model(self, key: str) -> dict | None:
        """Возвращает метаданные модели по ключу."""
        for m in self._load():
            if m["key"] == key:
                return m
        return None

    def model_path(self, key: str) -> Path | None:
        """Путь к .pth файлу модели."""
        meta = self.get_model(key)
        if meta is None:
            return None
        return self.custom_dir / meta["file"]

    def add_model(
        self,
        pth_bytes: bytes,
        name: str,
        num_classes: int,
        model_type: str,           # "binary" | "multiclass"
        classes: list[dict],       # [{id, name, name_ru, color}]
        description: str = "",
        encoder_name: str = "efficientnet-b0",
        img_size: int = 512,
        mean: list | None = None,
        std:  list | None = None,
    ) -> dict:
        """
        Сохраняет .pth и добавляет запись в реестр.
        Возвращает метаданные созданной модели.
        """
        # Генерируем уникальный slug из имени
        key = self._make_key(name)

        filename = f"{key}.pth"
        pth_path = self.custom_dir / filename

        # Сохраняем файл
        with open(pth_path, "wb") as f:
            f.write(pth_bytes)

        meta: dict[str, Any] = {
            "key":          key,
            "name":         name.strip(),
            "description":  description.strip(),
            "num_classes":  num_classes,
            "model_type":   model_type,
            "classes":      classes,
            "encoder_name": encoder_name,
            "img_size":     img_size,
            "mean":         mean or [0.485, 0.456, 0.406],
            "std":          std  or [0.229, 0.224, 0.225],
            "created_at":   datetime.utcnow().isoformat(),
            "file":         filename,
        }

        registry = self._load()
        # Удаляем старую версию с тем же ключом если есть
        registry = [m for m in registry if m["key"] != key]
        registry.append(meta)
        self._save(registry)

        return meta

    def delete_model(self, key: str) -> bool:
        """
        Удаляет модель из реестра и файл .pth.
        Возвращает True если модель была найдена и удалена.
        """
        registry = self._load()
        target   = next((m for m in registry if m["key"] == key), None)
        if target is None:
            return False

        # Удаляем файл
        pth_path = self.custom_dir / target["file"]
        if pth_path.exists():
            pth_path.unlink()

        # Убираем из реестра
        registry = [m for m in registry if m["key"] != key]
        self._save(registry)
        return True

    # ─── Генерация ключа ─────────────────────────────────────────────────────

    def _make_key(self, name: str) -> str:
        """Создаёт уникальный slug из имени модели."""
        # Транслит основных русских букв
        translit = {
            'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo',
            'ж':'zh','з':'z','и':'i','й':'j','к':'k','л':'l','м':'m',
            'н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
            'ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sch',
            'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
        }
        slug = name.lower()
        slug = "".join(translit.get(c, c) for c in slug)
        slug = re.sub(r"[^a-z0-9]+", "_", slug).strip("_")
        slug = f"custom_{slug}" if not slug.startswith("custom_") else slug
        slug = slug[:40]

        # Если такой ключ уже есть — добавляем суффикс
        existing = {m["key"] for m in self._load()}
        if slug in existing:
            i = 2
            while f"{slug}_{i}" in existing:
                i += 1
            slug = f"{slug}_{i}"

        return slug
