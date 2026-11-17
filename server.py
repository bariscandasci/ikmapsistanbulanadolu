#!/usr/bin/env python3
"""Yerel statik sunucu ve EGO canlı varış vekili.

Tarayıcı egocptsrvand.ego.gov.tr adresine CORS yüzünden ulaşamaz.
GET /api/live-arrival?hat=208&durak=11595 yalnızca bu sabit EGO isteğini iletir:

  https://egocptsrvand.ego.gov.tr/mblSrv14/service.asp
    ?FNC=Otobus&VER=3.1.0&LAN=tr&HAT={hat}&DURAK={durak}

Üst akış kapalıysa veya veri yoksa boş tablo döner; sayfa sefer aralığı / 2
beklemeye kendisi düşer.
"""
import json
import re
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

EGO_TEMPLATE = (
    "https://egocptsrvand.ego.gov.tr/mblSrv14/service.asp"
    "?FNC=Otobus&VER=3.1.0&LAN=tr&HAT={hat}&DURAK={durak}"
)
HAT_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z\-]{0,15}$")
DURAK_RE = re.compile(r"^\d{1,8}$")
USER_AGENT = "EGO Cepte/8 CFNetwork/1568.300.101 Darwin/24.0.0"


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/live-arrival":
            return super().do_GET()
        self._live_arrival(parse_qs(parsed.query))

    def _live_arrival(self, query):
        hat = (query.get("hat") or [""])[0]
        durak = (query.get("durak") or [""])[0]
        if not HAT_RE.fullmatch(hat) or not DURAK_RE.fullmatch(durak):
            return self._json({"table": [], "status": "FALSE", "message": "hat veya durak geçersiz"})

        url = EGO_TEMPLATE.format(hat=quote(hat), durak=quote(durak))
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=8) as res:
                raw = res.read()
            body = json.loads(raw.decode("utf-8", "replace"))
            if not isinstance(body, dict):
                body = {"table": [], "status": "FALSE"}
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
            body = {"table": [], "status": "FALSE", "message": "EGO servisi yanıt vermedi"}
        self._json(body)

    def _json(self, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8812), Handler).serve_forever()
