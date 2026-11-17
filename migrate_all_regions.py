# -*- coding: utf-8 -*-
"""
Altı bölgenin hat, durak, proje ve (varsa) aday verisini Supabase'e taşır.

Hedef tablolar: companies, regions, transit_lines, map_points.
Her satır company_id taşır; hat ve noktalar ayrıca region_id ile süzülür.

Kaynak klasörler (ilk bulunan data.js kullanılır):
  ankara-guvenlik       Desktop/ankarag            (ikmapsankaraguvenlik)
  ankara-servis         bu repo (ikmapsv2) — güncel veri
  ist-avrupa-guvenlik   ~/ikmapsistanbulavrupaguvenlik, yoksa Desktop/ikmapistavpg
  ist-avrupa-servis     Desktop/ikmapistavpser
  ist-anadolu-guvenlik  Desktop/ikmapistandg
  ist-anadolu-servis    Desktop/ikmapsistandser

Çalıştırma (proje kökünden):
  python migrate_all_regions.py

SUPABASE_KEY yazma yetkisi olmayan publishable anahtarsa betik durur ve
supabase/tenant_write_policy.sql dosyasını gösterir. Gizli anahtar
(sb_secret_...) .env içindeki SUPABASE_KEY değerine konursa yükleme sürer.
"""

from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXTRACT_JS = ROOT / "scripts" / "extract_region_data.js"
HOME = Path.home()
DESKTOP = HOME / "Desktop"

COMPANY_SLUG = "tepe"
COMPANY_NAME = "Tepe"

REGIONS = [
    {
        "slug": "ankara-guvenlik",
        "name": "Ankara Güvenlik",
        "paths": [DESKTOP / "ankarag", HOME / "ikmapsankaraguvenlik", DESKTOP / "ikmapsankaraguvenlik"],
        "fallback_center": (39.9334, 32.8597),
    },
    {
        "slug": "ankara-servis",
        "name": "Ankara Servis",
        "paths": [ROOT],
        "fallback_center": (39.9334, 32.8597),
    },
    {
        "slug": "ist-avrupa-guvenlik",
        "name": "İstanbul Avrupa Güvenlik",
        "paths": [HOME / "ikmapsistanbulavrupaguvenlik", DESKTOP / "ikmapistavpg", DESKTOP / "ikmapsistanbulavrupaguvenlik"],
        "fallback_center": (41.0422, 28.9850),
    },
    {
        "slug": "ist-avrupa-servis",
        "name": "İstanbul Avrupa Servis",
        "paths": [DESKTOP / "ikmapistavpser", HOME / "ikmapsistanbul", DESKTOP / "GİT" / "ikmaps-istanbul"],
        "fallback_center": (41.0422, 28.9850),
    },
    {
        "slug": "ist-anadolu-guvenlik",
        "name": "İstanbul Anadolu Güvenlik",
        "paths": [DESKTOP / "ikmapistandg", HOME / "ikmapsistanbulanadolu", DESKTOP / "ikmapsistanbulanadolu"],
        "fallback_center": (40.9900, 29.0300),
    },
    {
        "slug": "ist-anadolu-servis",
        "name": "İstanbul Anadolu Servis",
        "paths": [DESKTOP / "ikmapsistandser", DESKTOP / "ikmapsistanbulanadolu"],
        "fallback_center": (40.9900, 29.0300),
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
                return resp.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            raise SystemExit(f"{method} {path} -> {exc.code}\n{detail}") from exc

    def select(self, table, query):
        _status, data = self.request("GET", f"/rest/v1/{table}?{query}")
        return data or []

    def insert(self, table, rows, on_conflict=None):
        if not rows:
            return []
        path = f"/rest/v1/{table}"
        if on_conflict:
            path += "?on_conflict=" + urllib.parse.quote(on_conflict)
        prefer = "return=representation"
        if on_conflict:
            prefer = "resolution=merge-duplicates,return=representation"
        _status, data = self.request("POST", path, rows, prefer=prefer)
        return data or []

    def delete(self, table, filters):
        query = "&".join(f"{key}=eq.{urllib.parse.quote(str(value))}" for key, value in filters.items())
        self.request("DELETE", f"/rest/v1/{table}?{query}", prefer="return=minimal")


def find_source(paths):
    for path in paths:
        if (path / "data.js").exists():
            return path
    return None


def load_data_js(folder):
    proc = subprocess.run(
        ["node", str(EXTRACT_JS), str(folder / "data.js")],
        check=False,
        capture_output=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr.decode("utf-8", "replace"))
        raise SystemExit(f"data.js okunamadı: {folder}")
    return json.loads(proc.stdout.decode("utf-8"))


def load_json(path):
    if not path.exists() or path.stat().st_size == 0:
        return None
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def thin(coords, limit=600):
    if not isinstance(coords, list) or len(coords) <= limit:
        return coords or None
    if limit < 2:
        return coords[:1]
    step = (len(coords) - 1) / (limit - 1)
    thinned = [coords[int(i * step)] for i in range(limit - 1)]
    thinned.append(coords[-1])
    return thinned


def _lng_lat_pair(pair, swap_lat_lng):
    """Kaynak çiftler [lat, lng]. GeoJSON [lng, lat] ister."""
    if not isinstance(pair, (list, tuple)) or len(pair) < 2:
        return None
    first, second = as_float(pair[0]), as_float(pair[1])
    if first is None or second is None:
        return None
    lng, lat = (second, first) if swap_lat_lng else (first, second)
    return [round(lng, 6), round(lat, 6)]


def _line_coordinates(raw_pairs, swap_lat_lng):
    if not isinstance(raw_pairs, list):
        return []
    points = []
    for pair in thin(raw_pairs) or []:
        converted = _lng_lat_pair(pair, swap_lat_lng)
        if converted is not None:
            points.append(converted)
    return points if len(points) >= 2 else []


def to_geojson(raw):
    """PostGIS geometry sütunu ham [[lat,lng], ...] kabul etmez.
    Geçerli GeoJSON LineString / MultiLineString döner; koordinat yoksa None.
    """
    if raw is None or raw == "" or raw == []:
        return None
    if isinstance(raw, dict):
        gtype = raw.get("type")
        coords = raw.get("coordinates")
        if gtype == "LineString":
            line = _line_coordinates(coords, swap_lat_lng=False)
            return {"type": "LineString", "coordinates": line} if line else None
        if gtype == "MultiLineString":
            parts = []
            for part in coords or []:
                line = _line_coordinates(part, swap_lat_lng=False)
                if line:
                    parts.append(line)
            if not parts:
                return None
            if len(parts) == 1:
                return {"type": "LineString", "coordinates": parts[0]}
            return {"type": "MultiLineString", "coordinates": parts}
        return None
    if not isinstance(raw, list) or not raw:
        return None
    # İç içe hatlar: [[[lat, lng], ...], [[lat, lng], ...]]
    first = raw[0]
    nested = (
        isinstance(first, (list, tuple))
        and first
        and isinstance(first[0], (list, tuple))
    )
    if nested:
        parts = []
        for part in raw:
            line = _line_coordinates(part, swap_lat_lng=True)
            if line:
                parts.append(line)
        if not parts:
            return None
        if len(parts) == 1:
            return {"type": "LineString", "coordinates": parts[0]}
        return {"type": "MultiLineString", "coordinates": parts}
    line = _line_coordinates(raw, swap_lat_lng=True)
    if not line:
        return None
    return {"type": "LineString", "coordinates": line}


def as_float(value):
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def as_bool(value, default=True):
    if isinstance(value, bool):
        return value
    if value is None or value == "":
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "evet"}


def read_csv_projects(folder, existing_ids):
    path = folder / "projeler.csv"
    if not path.exists():
        return []
    added = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            project_id = (row.get("id") or "").strip()
            if not project_id or project_id in existing_ids:
                continue
            lat = as_float(row.get("lat"))
            lng = as_float(row.get("lng"))
            if lat is None or lng is None:
                continue
            capacity = row.get("capacity")
            added.append(
                {
                    "id": project_id,
                    "name": row.get("name") or project_id,
                    "sector": row.get("sector") or "",
                    "address": row.get("address") or "",
                    "lat": lat,
                    "lng": lng,
                    "accessStopId": row.get("accessStopId") or "",
                    "shift": row.get("shift") or "",
                    "salary": row.get("salary") or "",
                    "meal": row.get("meal") or "",
                    "transport": row.get("transport") or "",
                    "referral": row.get("referral") or "",
                    "gender": row.get("gender") or "",
                    "urgent": as_bool(row.get("urgent"), False),
                    "active": as_bool(row.get("active"), True),
                    "capacity": as_float(capacity) if capacity else None,
                    "position": row.get("position") or "",
                }
            )
            existing_ids.add(project_id)
    return added


def read_candidate_files(folder):
    found = []
    for name in ("candidates.json", "personel.json", "adaylar.json"):
        payload = load_json(folder / name)
        if isinstance(payload, list):
            found.extend(payload)
        elif isinstance(payload, dict) and isinstance(payload.get("candidates"), list):
            found.extend(payload["candidates"])
    csv_path = folder / "candidates.csv"
    if csv_path.exists():
        with csv_path.open(encoding="utf-8-sig", newline="") as handle:
            found.extend(list(csv.DictReader(handle)))
    return found


def centroid(projects, stops, fallback):
    points = []
    for project in projects:
        lat, lng = as_float(project.get("lat")), as_float(project.get("lng"))
        if lat is not None and lng is not None:
            points.append((lat, lng))
    if not points:
        for stop in stops:
            lat, lng = as_float(stop.get("lat")), as_float(stop.get("lng"))
            if lat is not None and lng is not None:
                points.append((lat, lng))
    if not points:
        return fallback
    return (
        round(sum(item[0] for item in points) / len(points), 6),
        round(sum(item[1] for item in points) / len(points), 6),
    )


def chunked(items, size):
    for index in range(0, len(items), size):
        yield items[index : index + size]


def line_row(company_id, region_id, slug, line, role):
    external_id = str(line.get("id") or line.get("hatNo") or "")
    geometry = to_geojson(line.get("geometry"))
    metadata = {
        "externalId": external_id,
        "role": role,
        "mode": line.get("mode") or "otobus",
        "verified": line.get("verified", True),
        "source": line.get("source") or "",
        "stopIds": line.get("stopIds") or [],
        "hatNo": line.get("hatNo") or "",
        "operator": line.get("operator") or "",
        "headwayMin": line.get("headwayMin"),
        "regionSlug": slug,
    }
    return {
        "company_id": company_id,
        "region_id": region_id,
        "line_code": f"{slug}:{external_id}"[:180],
        "line_name": (line.get("name") or external_id)[:300],
        "geometry": geometry,
        "metadata": metadata,
    }


def point_row(company_id, region_id, point_type, title, lat, lng, details):
    # lat/lng NOT NULL. Koordinatı olmayan satır haritaya yazılmaz.
    if lat is None or lng is None:
        return None
    return {
        "company_id": company_id,
        "region_id": region_id,
        "point_type": point_type,
        "title": (title or point_type)[:300],
        "lat": lat,
        "lng": lng,
        "details": details,
    }


def build_rows(company_id, region_id, spec, folder):
    data = load_data_js(folder)
    projects = list(data.get("projects") or [])
    known_ids = {project.get("id") for project in projects}
    projects.extend(read_csv_projects(folder, known_ids))

    network = load_json(folder / "transit_network.json") or {"stops": [], "lines": []}
    geometry_by_id = load_json(folder / "transit_network_geometry.json") or {}
    dolmus = load_json(folder / "dolmus_lines.json") or {"stops": [], "lines": []}
    if not isinstance(geometry_by_id, dict):
        geometry_by_id = {}

    network_lines = []
    for line in network.get("lines") or []:
        copied = dict(line)
        if not copied.get("geometry"):
            copied["geometry"] = geometry_by_id.get(copied.get("id"))
        network_lines.append(copied)

    dolmus_lines = [dict(line) for line in (dolmus.get("lines") or [])]
    for line in dolmus_lines:
        line["mode"] = line.get("mode") or "dolmus"

    curated_stops = list(data.get("transitStops") or [])
    network_stops = list(network.get("stops") or [])
    dolmus_stops = list(dolmus.get("stops") or [])

    center_lat, center_lng = centroid(projects, curated_stops + network_stops, spec["fallback_center"])

    line_rows = [line_row(company_id, region_id, spec["slug"], line, "curated") for line in (data.get("transitLines") or [])]
    line_rows.extend(line_row(company_id, region_id, spec["slug"], line, "network") for line in network_lines)
    line_rows.extend(line_row(company_id, region_id, spec["slug"], line, "dolmus") for line in dolmus_lines)
    seen_codes = set()
    unique_lines = []
    for row in line_rows:
        if row["line_code"] in seen_codes:
            continue
        seen_codes.add(row["line_code"])
        unique_lines.append(row)
    line_rows = unique_lines

    point_rows = []
    stops_without_coords = []
    candidates_without_coords = []

    def push_point(point_type, title, lat, lng, details, keep_without_coords=None):
        row = point_row(company_id, region_id, point_type, title, lat, lng, details)
        if row:
            point_rows.append(row)
        elif keep_without_coords is not None:
            keep_without_coords.append(details)

    for project in projects:
        push_point(
            "project",
            project.get("name"),
            as_float(project.get("lat")),
            as_float(project.get("lng")),
            {**project, "role": "project"},
        )
    for district in data.get("districts") or []:
        push_point(
            "district",
            district.get("name"),
            as_float(district.get("lat")),
            as_float(district.get("lng")),
            {**district, "role": "district"},
        )
    for stop in curated_stops:
        push_point(
            "stop",
            stop.get("name"),
            as_float(stop.get("lat")),
            as_float(stop.get("lng")),
            {**stop, "role": "curated"},
            stops_without_coords,
        )
    for stop in network_stops:
        push_point(
            "stop",
            stop.get("name"),
            as_float(stop.get("lat")),
            as_float(stop.get("lng")),
            {
                "id": stop.get("id"),
                "name": stop.get("name"),
                "address": stop.get("address") or "",
                "mode": stop.get("mode") or "",
                "coordSource": stop.get("coordSource") or "",
                "knownStopId": stop.get("knownStopId") or "",
                "role": "network",
            },
        )
    for stop in dolmus_stops:
        push_point(
            "stop",
            stop.get("name"),
            as_float(stop.get("lat")),
            as_float(stop.get("lng")),
            {**stop, "role": "dolmus"},
        )

    candidates = list(data.get("candidates") or []) + list(data.get("personnel") or [])
    candidates.extend(read_candidate_files(folder))
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        lat = as_float(candidate.get("lat") or (candidate.get("coords") or {}).get("lat"))
        lng = as_float(candidate.get("lng") or (candidate.get("coords") or {}).get("lng"))
        title = candidate.get("fullName") or candidate.get("name") or "Aday"
        push_point(
            "candidate",
            title,
            lat,
            lng,
            {**candidate, "role": "candidate"},
            candidates_without_coords,
        )

    push_point(
        "config",
        "hubs",
        center_lat,
        center_lng,
        {
            "hubStopIds": data.get("hubStopIds") or [],
            "role": "hubs",
            "stopsWithoutCoords": stops_without_coords,
            "candidatesWithoutCoords": candidates_without_coords,
        },
    )

    summary = {
        "projects": len(projects),
        "districts": len(data.get("districts") or []),
        "curated_lines": len(data.get("transitLines") or []),
        "network_lines": len(network_lines),
        "dolmus_lines": len(dolmus_lines),
        "stops": len(curated_stops) + len(network_stops) + len(dolmus_stops),
        "candidates": len(candidates),
        "center": (center_lat, center_lng),
    }
    return line_rows, point_rows, summary


def ensure_company(db):
    existing = db.select("companies", f"select=id,name,slug&slug=eq.{COMPANY_SLUG}")
    if existing:
        print(f"şirket var: {existing[0]['name']} ({existing[0]['id']})")
        return existing[0]["id"]
    try:
        created = db.insert("companies", [{"name": COMPANY_NAME, "slug": COMPANY_SLUG}])
    except SystemExit as exc:
        if "42501" in str(exc) or "row-level security" in str(exc):
            raise SystemExit(
                "Yazma, satır düzeyi güvenlik (RLS) tarafından reddedildi.\n"
                "Publishable anahtar tabloları okuyabiliyor, satır ekleyemiyor.\n"
                "Supabase SQL Editor'da supabase/tenant_write_policy.sql dosyasını çalıştırın\n"
                "veya .env içindeki SUPABASE_KEY değerini gizli anahtarla (sb_secret_...) değiştirip betiği yeniden çalıştırın.\n"
                f"Ayrıntı: {exc}"
            ) from exc
        raise
    print(f"şirket eklendi: {created[0]['id']}")
    return created[0]["id"]


def ensure_region(db, company_id, spec, center):
    existing = db.select(
        "regions",
        "select=id,slug,name&company_id=eq."
        + company_id
        + "&slug=eq."
        + urllib.parse.quote(spec["slug"]),
    )
    payload = {
        "company_id": company_id,
        "name": spec["name"],
        "slug": spec["slug"],
        "center_lat": center[0],
        "center_lng": center[1],
    }
    if existing:
        # Merkez koordinatını bu yüklemenin hesapladığı değerle güncelle.
        db.request(
            "PATCH",
            "/rest/v1/regions?id=eq." + existing[0]["id"] + "&company_id=eq." + company_id,
            {"center_lat": center[0], "center_lng": center[1], "name": spec["name"]},
            prefer="return=minimal",
        )
        print(f"  bölge güncellendi: {spec['slug']}")
        return existing[0]["id"]
    created = db.insert("regions", [payload])
    print(f"  bölge eklendi: {spec['slug']}")
    return created[0]["id"]


def upload_region(db, company_id, spec):
    folder = find_source(spec["paths"])
    if folder is None:
        print(f"ATLANDI {spec['slug']}: data.js bulunamadı ({', '.join(str(p) for p in spec['paths'])})")
        return
    print(f"\n== {spec['name']} <= {folder}")
    # Merkez, satırlar kurulurken belli olur; bölge satırını ondan sonra yazarız.
    # Önce geçici merkezle bölgeyi açmak yerine veriyi okuyup sonra yazıyoruz.
    # region_id insert için gerekli olduğundan önce fallback merkezle oluşturup
    # centroid hazır olunca PATCH ediyoruz. build_rows region_id ister, o yüzden
    # iki geçiş yerine fallback ile oluşturup satırlara o id'yi basıyoruz,
    # ardından merkezi patch'liyoruz.
    region_id = ensure_region(db, company_id, spec, spec["fallback_center"])
    line_rows, point_rows, summary = build_rows(company_id, region_id, spec, folder)
    db.request(
        "PATCH",
        "/rest/v1/regions?id=eq." + region_id + "&company_id=eq." + company_id,
        {"center_lat": summary["center"][0], "center_lng": summary["center"][1]},
        prefer="return=minimal",
    )
    print(
        "  kaynak: {projects} proje, {districts} ilçe, {curated_lines} özet hat, "
        "{network_lines} ağ hattı, {dolmus_lines} dolmuş, {stops} durak, {candidates} aday".format(**summary)
    )
    print(f"  merkez: {summary['center'][0]}, {summary['center'][1]}")
    db.delete("transit_lines", {"company_id": company_id, "region_id": region_id})
    db.delete("map_points", {"company_id": company_id, "region_id": region_id})
    inserted_lines = 0
    for batch in chunked(line_rows, 40):
        db.insert("transit_lines", batch)
        inserted_lines += len(batch)
        print(f"  hat {inserted_lines}/{len(line_rows)}", flush=True)
    inserted_points = 0
    for batch in chunked(point_rows, 200):
        db.insert("map_points", batch)
        inserted_points += len(batch)
        print(f"  nokta {inserted_points}/{len(point_rows)}", flush=True)


def main():
    if "--dry-run" in sys.argv:
        for spec in REGIONS:
            folder = find_source(spec["paths"])
            if folder is None:
                print(f"MISSING {spec['slug']}")
                continue
            _lines, _points, summary = build_rows("dry-company", "dry-region", spec, folder)
            print(f"{spec['slug']} <= {folder}")
            print(" ", summary)
        return
    url, key = load_env()
    print(f"hedef: {url}")
    db = Supabase(url, key)
    company_id = ensure_company(db)
    for spec in REGIONS:
        upload_region(db, company_id, spec)
    print("\nTamam. Arayüz bölge seçicisi bu company_id ile süzülür:", company_id)


if __name__ == "__main__":
    main()
