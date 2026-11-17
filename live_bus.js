// Canlı durak varışı. Tarayıcı EGO sunucusuna doğrudan istek atamaz (CORS yok);
// aynı kaynaktaki /api/live-arrival bu adresi sunucu tarafında iletir.
// Servis kapalıysa, boş dönerse veya durak kodu yoksa hiç fırlatmaz:
// çağıranın verdiği fallbackWaitMin (hat sefer aralığı / 2) ile döner.
//
// Gerçek istek şablonu (EGO Cep'te ile aynı uç):
//   GET https://egocptsrvand.ego.gov.tr/mblSrv14/service.asp
//       ?FNC=Otobus&VER=3.1.0&LAN=tr&HAT={hat}&DURAK={durak}
// Cevap: { table: [ { hat_no, saniye, sure, ... } ], status: "TRUE" }
// saniye, durağa kalan saniyedir. 999999 ve "Geçti" o aracı elemek içindir.

(function () {
  var EGO_REQUEST_TEMPLATE =
    "https://egocptsrvand.ego.gov.tr/mblSrv14/service.asp?FNC=Otobus&VER=3.1.0&LAN=tr&HAT={hat}&DURAK={durak}";
  var PROXY_PATH = "/api/live-arrival";
  var CACHE_MS = 20000;
  var cache = new Map();
  var inflight = new Map();

  function egoStopNo(stopId) {
    var match = String(stopId || "").match(/^ego_(\d+)$/);
    return match ? match[1] : null;
  }

  function hatCode(lineId, hatNo) {
    if (hatNo) return String(hatNo);
    var match = String(lineId || "").match(/^ego_line_(.+)$/);
    return match ? match[1] : null;
  }

  function staticResult(stopId, lineId, hatNo, fallbackWaitMin) {
    var wait = Number(fallbackWaitMin);
    return {
      source: "static",
      estimatedWaitMin: Number.isFinite(wait) && wait >= 0 ? wait : 6,
      stopId: stopId || null,
      lineId: lineId || null,
      hatNo: hatNo || null,
      stopNo: egoStopNo(stopId),
    };
  }

  function liveWaitMin(rows, hat) {
    var best = null;
    (rows || []).forEach(function (row) {
      var codes = [row.hat_no, row.hat_kod, row.hat_kisa_kod].map(function (value) {
        return value == null ? "" : String(value);
      });
      if (codes.indexOf(hat) === -1) return;
      var seconds = Number(row.saniye);
      if (!Number.isFinite(seconds) || seconds >= 999000) return;
      if (/geçti/i.test(String(row.sure || ""))) return;
      if (best == null || seconds < best) best = seconds;
    });
    if (best == null) return null;
    if (best <= 0) return 0;
    return Math.max(1, Math.ceil(best / 60));
  }

  function fetchArrival(hat, durak) {
    var key = hat + "|" + durak;
    var hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.minutes);
    if (inflight.has(key)) return inflight.get(key);

    var url = PROXY_PATH + "?hat=" + encodeURIComponent(hat) + "&durak=" + encodeURIComponent(durak);
    var pending = fetch(url, { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("live arrival " + res.status);
        return res.json();
      })
      .then(function (body) {
        var minutes = liveWaitMin(body && body.table, hat);
        if (minutes == null) throw new Error("no live bus");
        cache.set(key, { at: Date.now(), minutes: minutes });
        return minutes;
      })
      .finally(function () {
        inflight.delete(key);
      });
    inflight.set(key, pending);
    return pending;
  }

  function getLiveBusArrival(stopId, lineId, options) {
    var opts = options || {};
    var hat = hatCode(lineId, opts.hatNo);
    var fallback = staticResult(stopId, lineId, hat, opts.fallbackWaitMin);
    var durak = egoStopNo(stopId);
    if (!hat || !durak) return Promise.resolve(fallback);
    return fetchArrival(hat, durak)
      .then(function (minutes) {
        return {
          source: "live",
          estimatedWaitMin: minutes,
          stopId: stopId,
          lineId: lineId,
          hatNo: hat,
          stopNo: durak,
          requestTemplate: EGO_REQUEST_TEMPLATE,
        };
      })
      .catch(function () {
        return fallback;
      });
  }

  window.LiveBus = {
    getLiveBusArrival: getLiveBusArrival,
    requestTemplate: EGO_REQUEST_TEMPLATE,
  };
})();
