# -*- coding: utf-8 -*-
"""
Vercel derlemesi. Proje adına veya argümana göre .env.<bölge> uygular
ve tarayıcı dosyalarını dist/ altına koyar.

  python scripts/vercel_build.py .env.ankara-servis
  VERCEL_PROJECT_NAME=ankaras python scripts/vercel_build.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
APPLY = ROOT / "scripts" / "apply_site_env.py"

PROJECT_ENV = {
    "ankaras": ".env.ankara-servis",
    "ikmapsankaraguvenlik": ".env.ankara-guvenlik",
    "ikmapsistanbulavrupaguvenlik": ".env.ist-avrupa-guvenlik",
    "ikmapistavpser": ".env.ist-avrupa-servis",
    "ikmapistandg": ".env.ist-anadolu-guvenlik",
    "ikmapsistanbulanadolu": ".env.ist-anadolu-servis",
}

STATIC_FILES = [
    "index.html",
    "config.js",
    "site-lock.js",
    "app.js",
    "tenant.js",
    "candidates.js",
    "data.js",
    "transit_network.json",
    "transit_network_geometry.json",
    "dolmus_lines.json",
]


def choose_env():
    if len(sys.argv) > 1:
        chosen = Path(sys.argv[1])
        if not chosen.is_absolute():
            chosen = ROOT / chosen
        return chosen
    explicit = os.environ.get("SITE_ENV_FILE", "").strip()
    if explicit:
        chosen = Path(explicit)
        if not chosen.is_absolute():
            chosen = ROOT / chosen
        return chosen
    name = os.environ.get("VERCEL_PROJECT_NAME", "").strip().lower()
    if name in PROJECT_ENV:
        return ROOT / PROJECT_ENV[name]
    for key, filename in PROJECT_ENV.items():
        if name.startswith(key):
            return ROOT / filename
    known = ", ".join(PROJECT_ENV)
    sys.exit(
        "Site env dosyası seçilemedi. Build komutuna dosyayı verin "
        f"(ör. python3 scripts/vercel_build.py .env.ankara-servis) "
        f"veya VERCEL_PROJECT_NAME şunlardan biri olsun: {known}"
    )


def publish():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for name in STATIC_FILES:
        source = ROOT / name
        if source.exists():
            shutil.copy2(source, DIST / name)
    assets = ROOT / "assets"
    if assets.exists():
        shutil.copytree(assets, DIST / "assets")


def main():
    env_file = choose_env()
    if not env_file.exists():
        sys.exit(f"Env dosyası yok: {env_file}")
    subprocess.check_call([sys.executable, str(APPLY), str(env_file)])
    publish()
    print(f"dist hazır: {env_file.name}")


if __name__ == "__main__":
    main()
