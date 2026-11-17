# -*- coding: utf-8 -*-
"""
Seçilen site env dosyasındaki VITE_ ayarlarını tarayıcının okuduğu config.js
dosyasına yazar. Bu proje Vite ile derlenmez; statik sayfa config.js okur.

  python scripts/apply_site_env.py
  python scripts/apply_site_env.py .env.ist-avrupa-servis
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config.js"


def read_env(path):
    env = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def merged_env(chosen):
    env = {}
    if chosen is None:
        for name in (".env", ".env.local"):
            env.update(read_env(ROOT / name))
        return env
    return read_env(chosen)


def flag(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "evet"}


def main():
    chosen = None
    if len(sys.argv) > 1:
        chosen = Path(sys.argv[1])
        if not chosen.is_absolute():
            chosen = ROOT / chosen
        if not chosen.exists():
            sys.exit(f"Env dosyası yok: {chosen}")
    env = merged_env(chosen)
    url = env.get("NEXT_PUBLIC_SUPABASE_URL") or env.get("SUPABASE_URL") or ""
    key = env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") or env.get("SUPABASE_KEY") or ""
    if not url or not key:
        sys.exit("Supabase URL veya publishable anahtar env dosyasında yok.")
    locked = env.get("VITE_LOCKED_REGION", "").strip()
    hide = flag(env.get("VITE_HIDE_REGION_SELECTOR"))
    title = env.get("VITE_SITE_TITLE", "").strip()
    payload = {
        "url": url,
        "publishableKey": key,
        "companySlug": "tepe",
        "lockedRegion": locked,
        "hideRegionSelector": hide or bool(locked),
        "siteTitle": title,
    }
    body = (
        "/**\n"
        " * Tarayıcının okuduğu site ayarı. scripts/apply_site_env.py üretir.\n"
        " * Gizli servis anahtarı buraya yazılmaz.\n"
        " */\n"
        "window.SUPABASE_CONFIG = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n"
    )
    CONFIG.write_text(body, encoding="utf-8")
    print(f"config.js <- {chosen.name if chosen else '.env + .env.local'}")
    print(f"  bölge: {locked or '(seçici açık)'}")
    print(f"  başlık: {title or '(bölge adından)'}")


if __name__ == "__main__":
    main()
