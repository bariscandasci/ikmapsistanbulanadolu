# -*- coding: utf-8 -*-
"""
Altı bölgenin proje ve aday kayıtlarını canlı Google Sheets (Apps Script) kaynağından
Supabase map_points tablosuna yazar.

Yerel klasör okumaz. Adresler, ilgili GitHub reposunun main dalındaki
SHEET_API_URL değeridir. Apps Script, bağlı olduğu Sheet'in "Projeler"
sekmesini (ve varsa "Adaylar" sekmesini) döndürür.

Ankara Güvenlik reposunda (ikmapsankaraguvenlik) SHEET_API_URL boştur;
proje listesi o reponun data.js dosyasından alınır. Başka bir yerel klasör kullanılmaz.

Çalıştırma:
  python sync_from_sheets.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXTRACT_JS = ROOT / "scripts" / "extract_region_data.js"
COMPANY_SLUG = "tepe"

# tenant.js SHEET_SOURCES ile aynı adresler.
SHEET_SOURCES = [
    {
        "slug": "ankara-servis",
        "name": "Ankara Servis",
        "repo": "ankaras",
        "sheet_name": "Projeler",
        "url": "https://script.google.com/macros/s/AKfycbxprctzoQPNbHz1kA3g4qQciSZ9hqIGtN_BC_q0YzSEvOmUGYxW9PKWTTpA7z6SoPw/exec",
    },
    {
        "slug": "ankara-guvenlik",
        "name": "Ankara Güvenlik",
        "repo": "ikmapsankaraguvenlik",
        "sheet_name": None,
        "url": "",
        "github_data": "https://raw.githubusercontent.com/bariscandasci/ikmapsankaraguvenlik/main/data.js",
    },
    {
        "slug": "ist-avrupa-guvenlik",
        "name": "İstanbul Avrupa Güvenlik",
        "repo": "ikmapsistanbulavrupaguvenlik",
        "sheet_name": "istguvavp",
        "url": "https://script.google.com/macros/s/AKfycbxK0P6RVaMEqxJaAdvxFhBh0MbHIeiywb3NfTxdqTKjC8KTY5OXVZGFroUkK4D87u8/exec",
    },
    {
        "slug": "ist-avrupa-servis",
        "name": "İstanbul Avrupa Servis",
        "repo": "ikmapistavpser",
        "sheet_name": "Projeler",
        "url": "https://script.google.com/macros/s/AKfycbxj6m9Kv2J0I2lFJJjP6XUVc3-04pO0TS2CriInYaW3Yp9j3NS0j9_eKq7juOokbNPI/exec",
    },
    {
        "slug": "ist-anadolu-guvenlik",
        "name": "İstanbul Anadolu Güvenlik",
        "repo": "ikmapistandg",
        "sheet_name": "Projeler",
        "url": "https://script.google.com/macros/s/AKfycbxWXq2J0JS2YLoqKY9aQntbT6SAvkWUrDAWhHd66YlRyz9yvoTxCjeoOH9crRh6q0cx/exec",
    },
    {
        "slug": "ist-anadolu-servis",
        "name": "İstanbul Anadolu Servis",
        "repo": "ikmapsistanbulanadolu",
        "sheet_name": "Projeler",
        "url": "https://script.google.com/macros/s/AKfycbxWlbu0OwKM76SKoExW_1UtnLlK7fQFP4EqKSRo_3cFGn6nc6Gha7qPwTKYOeJO6r4/exec",
    },
]


def load_env():
    env = {}
    for name in (".env.local", ".env"):
        path = ROOT / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    url = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_KEY") or env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL ve SUPABASE_KEY .env içinde yok.")
    return url.rstrip("/"), key


class Supabase:
    def __init__(self, url, key):
        self.url = url
        self.key = key

    def request(self, method, path, body=None, prefer=None):
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {
            "apikey": self.key,
            "Authorization": "Bearer " + self.key,
            "Accept": "application/json",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(self.url + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            raise SystemExit(f"{method} {path} -> {exc.code}\n{detail}") from exc

    def select(self, table, query):
        return self.request("GET", f"/rest/v1/{table}?{query}") or []


def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ikmaps-sync"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def coord_ok(lat, lng):
    try:
        lat = float(lat)
        lng = float(lng)
    except (TypeError, ValueError):
        return False
    return -90 <= lat <= 90 and -180 <= lng <= 180


def fetch_sheet(source):
    if source.get("url"):
        data = http_json(source["url"])
        if not isinstance(data, dict) or data.get("ok") is False or not isinstance(data.get("projects"), list):
            raise SystemExit(f"{source['name']} Sheet yanıtı proje listesi içermiyor.")
        return data.get("projects") or [], data.get("candidates") or [], "sheet"
    projects, candidates = fetch_github_data(source)
    return projects, candidates, "github-data.js"


def fetch_github_data(source):
    req = urllib.request.Request(source["github_data"], headers={"User-Agent": "ikmaps-sync"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        text = resp.read()
    tmp = Path(tempfile.gettempdir()) / "ikmaps_ankara_guvenlik_data.js"
    tmp.write_bytes(text)
    proc = subprocess.run(
        ["node", str(EXTRACT_JS), str(tmp)],
        check=False,
        capture_output=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr.decode("utf-8", "replace"))
        raise SystemExit("Ankara Güvenlik data.js okunamadı.")
    data = json.loads(proc.stdout.decode("utf-8"))
    return data.get("projects") or [], data.get("candidates") or [], 


def project_row(company_id, region_id, project):
    lat = project.get("lat")
    lng = project.get("lng")
    if not coord_ok(lat, lng):
        return None
    details = dict(project)
    details.pop("_rowId", None)
    details["role"] = "project"
    return {
        "company_id": company_id,
        "region_id": region_id,
        "point_type": "project",
        "title": str(project.get("name") or project.get("id") or "proje")[:300],
        "lat": float(lat),
        "lng": float(lng),
        "details": details,
    }


def candidate_row(company_id, region_id, candidate):
    coords = candidate.get("coords") if isinstance(candidate.get("coords"), dict) else {}
    lat = candidate.get("lat", coords.get("lat"))
    lng = candidate.get("lng", coords.get("lng"))
    if not coord_ok(lat, lng):
        return None
    details = dict(candidate)
    details.pop("_rowId", None)
    details["role"] = "candidate"
    details["lat"] = float(lat)
    details["lng"] = float(lng)
    return {
        "company_id": company_id,
        "region_id": region_id,
        "point_type": "candidate",
        "title": str(candidate.get("fullName") or candidate.get("name") or candidate.get("id") or "aday")[:300],
        "lat": float(lat),
        "lng": float(lng),
        "details": details,
    }


def chunked(rows, size=200):
    for index in range(0, len(rows), size):
        yield rows[index : index + size]


def replace_people(db, company_id, region, projects, candidates):
    region_id = region["id"]
    for point_type in ("project", "candidate"):
        query = (
            f"company_id=eq.{company_id}&region_id=eq.{region_id}&point_type=eq.{point_type}"
        )
        db.request("DELETE", f"/rest/v1/map_points?{query}", prefer="return=minimal")

    rows = []
    skipped = []
    for project in projects:
        row = project_row(company_id, region_id, project)
        if row:
            rows.append(row)
        else:
            skipped.append(project.get("id") or project.get("name"))
    loose = []
    placed = 0
    for candidate in candidates:
        row = candidate_row(company_id, region_id, candidate)
        if row:
            rows.append(row)
            placed += 1
        else:
            loose.append(candidate)
    for batch in chunked(rows):
        db.request("POST", "/rest/v1/map_points", batch, prefer="return=minimal")

    configs = db.select(
        "map_points",
        "select=id,details&company_id=eq."
        + company_id
        + "&region_id=eq."
        + region_id
        + "&point_type=eq.config&limit=1",
    )
    if configs:
        details = configs[0].get("details") or {}
        if isinstance(details, str):
            details = json.loads(details)
        details["candidatesWithoutCoords"] = loose
        db.request(
            "PATCH",
            f"/rest/v1/map_points?id=eq.{configs[0]['id']}&company_id=eq.{company_id}&region_id=eq.{region_id}",
            {"details": details},
            prefer="return=minimal",
        )
    return len(rows) - placed, placed, len(loose), skipped


def main():
    url, key = load_env()
    db = Supabase(url, key)
    companies = db.select("companies", f"select=id,name,slug&slug=eq.{COMPANY_SLUG}")
    if not companies:
        sys.exit("Tepe şirketi Supabase'de yok.")
    company_id = companies[0]["id"]
    print(f"şirket: {companies[0]['name']} {company_id}")
    regions = db.select(
        "regions",
        "select=id,slug,name&company_id=eq." + company_id,
    )
    by_slug = {region["slug"]: region for region in regions}

    for source in SHEET_SOURCES:
        region = by_slug.get(source["slug"])
        print(f"\n== {source['name']} ({source['repo']})")
        if not region:
            print("  bölge kaydı yok, atlandı")
            continue
        projects, candidates, kind = fetch_sheet(source)
        print(f"  kaynak: {kind} · sheet projesi {len(projects)} · aday {len(candidates)}")
        written, placed, loose, skipped = replace_people(db, company_id, region, projects, candidates)
        print(f"  yazıldı: {written} proje, {placed} aday, koordinatsız aday {loose}")
        if skipped:
            print(f"  koordinatsız proje atlandı: {skipped[:8]}")
    print("\nTamam.")


if __name__ == "__main__":
    main()
