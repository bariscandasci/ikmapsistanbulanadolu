/**
 * Ulaşım & Proje Eşleştirme Modülü — uygulama mantığı.
 * Classic script (module değil) — file:// üzerinden de çalışsın diye.
 * ISTANBUL_DATA global değişkeni data.js tarafından tanımlanır.
 */

// ---------------------------------------------------------------------------
// 0) PAYLAŞIMLI PROJE VERİTABANI (Google Sheets + Apps Script)
// ---------------------------------------------------------------------------
// Proje listesi artık data.js'teki statik listeyle SINIRLI değil: sayfa
// açılışında paylaşımlı bir Google Sheet'ten canlı olarak çekilir, böylece
// İK ekibindeki herkes (hangi bilgisayardan girerse girsin) aynı güncel
// listeyi görür ve "Proje Ekle"/"Acil"/"Aç-Kapa" değişiklikleri herkese
// yansır. data.js'teki liste yalnızca ilk yükleme anında (Sheet'e henüz
// ulaşılamadıysa) çevrimdışı bir yedek olarak kullanılır.
// ⚠️ İSTANBUL İÇİN HENÜZ KURULMADI. Ankara'daki Apps Script URL'i buraya
// KOPYALANMAMALI — o URL Ankara'nın kendi Google Sheet'ine yazıyor, aynı
// anda İstanbul'un projelerini de oraya karıştırır. İstanbul için: Ankara'daki
// Sheet + Apps Script'in bir kopyasını (Dosya > Kopya Oluştur) yapıp yeni bir
// Web App olarak deploy edin, çıkan /exec URL'ini aşağıya yapıştırın. Boş
// kaldığı sürece uygulama sessizce data.js'teki statik listeyle çalışır
// ("Proje Ekle" ile eklenen projeler sayfa yenilenince kaybolur).
const SHEET_API_URL = "";
const SHEET_CACHE_KEY = "ist_ulasim_sheet_cache_v1";

// Sheet'e başarılı bir yazmadan hemen sonra yerel önbelleği de günceller.
// Bunu atlarsak, kullanıcı bir projeyi aç/kapat edip kaydettikten sonra
// sayfayı yenilediğinde, sayfa açılışında ÖNCE eski önbellek anında
// gösterildiği için (canlı Sheet verisi arka planda gelene kadar) değişiklik
// "sıfırlanmış" gibi görünüyordu.
function saveProjectsCache() {
  try {
    localStorage.setItem(SHEET_CACHE_KEY, JSON.stringify(ISTANBUL_DATA.projects));
  } catch {
    /* localStorage kullanılamıyorsa sessizce yoksay */
  }
}

// data.js'teki statik projelerde henüz urgent/active alanı yok — bunları
// eski (ISTANBUL_DATA.urgentProjectIds / referral==="Aktif değil") mantığından
// türeterek her projeye ekliyoruz; Sheet'ten canlı veri geldiğinde bu
// alanların üzerine (Sheet'teki gerçek değerlerle) yazılır.
(function seedStaticActiveUrgentFields() {
  const staticUrgentIds = new Set(ISTANBUL_DATA.urgentProjectIds || []);
  ISTANBUL_DATA.projects.forEach((p) => {
    if (p.urgent === undefined) p.urgent = staticUrgentIds.has(p.id);
    if (p.active === undefined) p.active = p.referral !== "Aktif değil";
  });
})();

// URGENT_PROJECT_IDS / INACTIVE_PROJECT_IDS artık projelerin kendi
// urgent/active alanlarından TÜRETİLİR (Sheet = tek doğruluk kaynağı).
// Modallardan kaydedince önce Sheet'e yazılır, sonra bu setler yenilenir.
let URGENT_PROJECT_IDS = new Set();
let INACTIVE_PROJECT_IDS = new Set();
function recomputeUrgentInactiveSets() {
  URGENT_PROJECT_IDS = new Set(ISTANBUL_DATA.projects.filter((p) => p.urgent).map((p) => p.id));
  INACTIVE_PROJECT_IDS = new Set(ISTANBUL_DATA.projects.filter((p) => !p.active).map((p) => p.id));
}
recomputeUrgentInactiveSets();

function activeProjects() {
  return ISTANBUL_DATA.projects.filter((p) => !INACTIVE_PROJECT_IDS.has(p.id));
}

// Apps Script'e yazma isteği gönderir. Content-Type kasıtlı olarak
// "text/plain" — Apps Script Web App'leri tarayıcının CORS ön-kontrol
// (preflight OPTIONS) isteğini desteklemiyor; "application/json" kullanmak
// tarayıcının otomatik preflight göndermesine ve isteğin başarısız olmasına
// yol açardı. Gövde yine de geçerli JSON metni olarak gönderilir.
async function postToSheet(body) {
  if (!SHEET_API_URL) throw new Error("Sheet henüz kurulmadı (SHEET_API_URL boş)");
  const res = await fetch(SHEET_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Sheet isteği başarısız");
  return data;
}

// Birden fazla proje güncellemesini TEK bir istekte gönderir (Apps Script
// tarafında da tek bir Sheet okuma + tek bir Sheet yazma ile uygulanır) —
// her öğe için ayrı bir Apps Script çalıştırması (ve her birinin ~2-3sn'lik
// kilit/okuma/yazma maliyeti) gerekmediği için toplu Acil/Aç-Kapa
// kaydetmelerinde çok daha hızlıdır.
// patches: [{ id, patch }, ...]. Dönüş: { ok, updatedIds: Set, notFound: [] }.
async function postBatchUpdate(patches) {
  const data = await postToSheet({ action: "updateBatch", patches });
  const notFound = new Set(data.notFound || []);
  const updatedIds = new Set(patches.map((p) => p.id).filter((id) => !notFound.has(id)));
  return { updatedIds, notFound: [...notFound] };
}

// transitStops artık çoğu durak için (OSM tabanlı gerçek veri setinden
// eşleştirilmiş) kendi lat/lng'sini taşıyor — bunlar öncelikli kullanılır.
// Hâlâ koordinatsız kalan birkaç durak için (ör. stop_etlik, stop_pursaklar_est)
// eskisi gibi, o durağı accessStopId olarak kullanan ilçe/mahalle ve
// projelerin konumlarından yaklaşık bir konum türetiliyor.
let stopApproxCoordsCache = null;
function stopApproxCoords() {
  if (stopApproxCoordsCache) return stopApproxCoordsCache;
  const map = {};
  const add = (stopId, lat, lng) => {
    if (!stopId || map[stopId]) return;
    map[stopId] = { lat, lng };
  };
  ISTANBUL_DATA.transitStops.forEach((s) => {
    if (s.lat != null && s.lng != null) add(s.id, s.lat, s.lng);
  });
  ISTANBUL_DATA.districts.forEach((d) => {
    add(d.accessStopId, d.lat, d.lng);
    (d.neighborhoods || []).forEach((n) => add(n.accessStopId, n.lat, n.lng));
  });
  ISTANBUL_DATA.projects.forEach((p) => add(p.accessStopId, p.lat, p.lng));
  stopApproxCoordsCache = map;
  return map;
}

/** Basit haversine ile en yakın gerçek durağı bulur — yeni eklenen bir proje için otomatik durak ataması. */
function nearestTransitStop(lat, lng) {
  const coords = stopApproxCoords();
  let best = null;
  let bestDist = Infinity;
  ISTANBUL_DATA.transitStops.forEach((s) => {
    const c = coords[s.id];
    if (!c) return;
    const d = haversineKm({ lat, lng }, c);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  });
  return best;
}

// ---------------------------------------------------------------------------
// 1) YARDIMCI ARAMA TABLOLARI
// ---------------------------------------------------------------------------

const stopsById = Object.fromEntries(ISTANBUL_DATA.transitStops.map((s) => [s.id, s]));
const linesByStopId = {}; // stopId -> [lineId, ...]
ISTANBUL_DATA.transitLines.forEach((line) => {
  line.stopIds.forEach((stopId) => {
    (linesByStopId[stopId] = linesByStopId[stopId] || []).push(line.id);
  });
});
const linesById = Object.fromEntries(ISTANBUL_DATA.transitLines.map((l) => [l.id, l]));

function stopName(stopId) {
  return stopsById[stopId] ? stopsById[stopId].name : stopId;
}

// ---------------------------------------------------------------------------
// 2) MESAFE + TAHMİNİ ULAŞIM SÜRESİ HESABI (mock ulaşım matrisi motoru)
// ---------------------------------------------------------------------------

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Proje adı/adres/yönlendirme gibi alanlar artık paylaşımlı bir Google
// Sheet'ten geliyor (bkz. SHEET_API_URL) — herhangi bir ekip üyesi (veya
// "Proje Ekle" formu) bu metni yazabiliyor. innerHTML/bindTooltip'e ÇIĞ
// GİBİ basılırsa bu, herkesin tarayıcısında çalışan kalıcı (stored) bir XSS
// açığı olur. Bu yüzden Sheet'ten/kullanıcıdan gelen HER metin, bir HTML
// şablonuna gömülmeden önce buradan geçirilir. candidates.js (aday adı,
// yorumlar — yorumlar da aynı Sheet'i kullanıyor) app.js'ten SONRA
// yüklendiği için bu fonksiyonu aynen kullanır.
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function roundTo5(n) {
  return Math.round(n / 5) * 5;
}

// ---------------------------------------------------------------------------
// 2) GERÇEK GRAF TABANLI ROTA MOTORU (Ankara'daki motorun İstanbul uyarlaması)
// ---------------------------------------------------------------------------
//
// Önceden burada, hatları "ortak durak"la bağlayan hat-düzeyi bir BFS
// (resolveTransfer/findLinePath) vardı: hat sayısına göre aktarma sayısını
// buluyor, süreyi ise kuş uçuşu mesafe / sabit hız formülüyle tahmin ediyordu
// — gerçek hat güzergâhını, duraklar arası yürümeyi ve bekleme süresini hesaba
// katmıyordu. Ankara'da bu yaklaşımın yanlış/gerçekçi olmayan rotalar
// ürettiği görülüp yerine DURAK düzeyinde bir graf + çok-kaynaklı Dijkstra
// konmuştu; İstanbul da aynı motora geçirildi.
//
// Graf iki kaynaktan kurulur (bkz. buildRoutingNetwork, §3b):
//   - data.js: metro/tramvay/Marmaray/füniküler/vapur (275 durak, 27 hat)
//   - transit_network.json: İETT'nin resmi GTFS verisinden 1486 otobüs hattı,
//     13.183 durak (koordinatların tamamı gerçek GPS)
// Farklı isimli/idli ama birbirine ≤350m yakın duraklar (ör. Kadıköy iskelesi
// ile M4 Kadıköy) otomatik yürüme kenarıyla bağlanır — eskiden elle tutulan
// WALK_TRANSFERS listesine ve knownStopId eşleşmesine artık gerek yok.

const MODE_SPEED_KMH = { otobus: 16, metrobus: 38, metro: 33, tramvay: 20, funikuler: 15, marmaray: 40, vapur: 25 };
const WALK_SPEED_KMH = 4.5;
const STOP_DWELL_MIN = 0.4;
// Her araca binişte (ilk biniş DAHİL, sadece aktarmalarda değil) o modun
// ortalama sefer sıklığının yarısı kadar bekleme süresi eklenir — gerçekte
// araç tam istediğin an orada olmuyor. Aynı hatta kalmaya devam etmek
// (biniş değişmiyorsa) tamamen bedava. Değerler İstanbul'daki tipik sefer
// sıklıklarına dayalı kaba ortalamalardır (resmi sefer saatlerinden
// hesaplanmadı); Google Maps çıktısıyla karşılaştırıp ayarlanmalı.
const MODE_HEADWAY_MIN = { otobus: 12, metrobus: 3, metro: 5, tramvay: 6, funikuler: 4, marmaray: 10, vapur: 20 };
function avgWaitMin(mode) {
  return (MODE_HEADWAY_MIN[mode] !== undefined ? MODE_HEADWAY_MIN[mode] : MODE_HEADWAY_MIN.otobus) / 2;
}
const WALK_TRANSFER_MAX_KM = 0.35; // farklı hatların yakın duraklarını "aktarma" olarak bağlayan yürüme kenarları
const NEAREST_STOP_SEARCH_KM = 2.0; // bir nokta çevresinde graf'a giriş/çıkış için aranan yarıçap
const NEAREST_STOP_MAX_CANDIDATES = 10;
// Şehrin kenarındaki bir nokta (ör. İstanbul Havalimanı'ndaki proje, en yakın
// durağa 2.02km) NEAREST_STOP_SEARCH_KM içinde hiç durak bulamayınca doğrudan
// "doğrulanamadı" tahminine düşmesin: yarıçap içinde SIFIR durak varsa bu daha
// geniş yarıçapla tekrar aranır. Yürüme süresi gerçek mesafeyle hesaplandığı
// için (2km ≈ 27 dk) sonuç yine dürüst — sadece ağın dışında kalmıyor.
const NEAREST_STOP_FALLBACK_KM = 3.0;
// İstanbul'da bir noktanın 300m çevresinde onlarca otobüs durağı olabilir; en
// yakın 10 durak SADECE otobüs duraklarıyla dolarsa 600-800m'deki bir
// metro/Marmaray/vapur istasyonu hiç aday olamıyor. Bu yüzden en yakın
// NEAREST_STOP_MAX_CANDIDATES adaya ek olarak, yarıçap içindeki en yakın
// NEAREST_RAIL_EXTRA_CANDIDATES raylı/deniz durağı da her zaman aday sayılır.
const NEAREST_RAIL_EXTRA_CANDIDATES = 4;
const WALK_STEP_MIN_KM = 0.12; // bundan kısa yürümeler ayrı adım olarak gösterilmez (süreye yine de dahil)
const GRID_CELL_DEG = 0.006; // ~500-650m'lik ızgara hücresi (İstanbul enleminde)

// Koordinatı gerçek GPS olmayıp hattın iki gerçek durağı arasına düz çizgiyle
// serpiştirilmiş (enterpolasyon/ekstrapolasyon) duraklar ne adrese en yakın
// biniş/iniş adayı ne de başka hatta "aktarma" köprüsü olabilir — hayalet bir
// durak "kapının önünde" görünüp gerçekçi olmayan bir rota üretebiliyor (Ankara'da
// yaşanan hata). İstanbul verisinde (resmi İBB GTFS) şu an böyle durak YOK; ileride
// başka kaynaktan veri eklenirse aynı korumanın hazır olması için burada duruyor.
const UNRELIABLE_COORD_SOURCES = new Set(["enterpolasyon", "ekstrapolasyon"]);

function walkMinutes(km) {
  return (km / WALK_SPEED_KMH) * 60;
}

function gridCellKey(lat, lng) {
  return `${Math.floor(lat / GRID_CELL_DEG)}:${Math.floor(lng / GRID_CELL_DEG)}`;
}

/** Basit ikili min-heap — Dijkstra'nın öncelik kuyruğu için (10k+ düğümde O(n) pop performans sorunu yaratırdı). */
class MinHeap {
  constructor() {
    this.items = [];
  }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].minutes <= a[i].minutes) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        let smallest = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < n && a[l].minutes < a[smallest].minutes) smallest = l;
        if (r < n && a[r].minutes < a[smallest].minutes) smallest = r;
        if (smallest === i) break;
        [a[i], a[smallest]] = [a[smallest], a[i]];
        i = smallest;
      }
    }
    return top;
  }
  get isEmpty() {
    return this.items.length === 0;
  }
}

let transitGraph = null; // buildTransitGraph() tamamlanınca dolar (bkz. loadLocalTransitNetwork)

/**
 * network: {stops, lines} ile bir graf kurar:
 * - Biniş kenarları: her hattın ardışık durakları arası, iki yönde de,
 *   gerçek mesafe/mod hızına göre süreli.
 * - Yürüme/aktarma kenarları: ızgara komşuluğuyla (O(n²) tarama YOK)
 *   ≤350m'deki FARKLI duraklar arası.
 */
function buildTransitGraph(network) {
  const stopsById = new Map();
  const grid = new Map();
  network.stops.forEach((s) => {
    if (typeof s.lat !== "number" || typeof s.lng !== "number") return;
    stopsById.set(s.id, s);
    const key = gridCellKey(s.lat, s.lng);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(s.id);
  });

  const adjacency = new Map();
  const addEdge = (fromId, toId, minutes, lineId, mode) => {
    if (!adjacency.has(fromId)) adjacency.set(fromId, []);
    adjacency.get(fromId).push({ to: toId, minutes, lineId, mode });
  };

  const linesByLocalId = new Map();
  network.lines.forEach((line) => {
    linesByLocalId.set(line.id, line);
    const speed = MODE_SPEED_KMH[line.mode] || MODE_SPEED_KMH.otobus;
    const ids = line.stopIds || [];
    for (let i = 0; i < ids.length - 1; i++) {
      const a = stopsById.get(ids[i]);
      const b = stopsById.get(ids[i + 1]);
      if (!a || !b) continue;
      const km = haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
      const minutes = (km / speed) * 60 + STOP_DWELL_MIN;
      addEdge(a.id, b.id, minutes, line.id, line.mode);
      addEdge(b.id, a.id, minutes, line.id, line.mode);
    }
  });

  const offsets = [-1, 0, 1];
  network.stops.forEach((s) => {
    if (typeof s.lat !== "number") return;
    // Konumu tahmini bir durak, başka bir hatta "aktarma" köprüsü kurmak
    // için kullanılamaz — bkz. UNRELIABLE_COORD_SOURCES tanımındaki not.
    if (UNRELIABLE_COORD_SOURCES.has(s.coordSource)) return;
    const cellLat = Math.floor(s.lat / GRID_CELL_DEG);
    const cellLng = Math.floor(s.lng / GRID_CELL_DEG);
    offsets.forEach((dLat) => {
      offsets.forEach((dLng) => {
        const bucket = grid.get(`${cellLat + dLat}:${cellLng + dLng}`);
        if (!bucket) return;
        bucket.forEach((otherId) => {
          if (otherId === s.id) return;
          const other = stopsById.get(otherId);
          if (UNRELIABLE_COORD_SOURCES.has(other.coordSource)) return;
          const km = haversineKm({ lat: s.lat, lng: s.lng }, { lat: other.lat, lng: other.lng });
          if (km <= WALK_TRANSFER_MAX_KM) {
            addEdge(s.id, otherId, walkMinutes(km), null, "yurume");
          }
        });
      });
    });
  });

  return { stopsById, grid, adjacency, linesByLocalId };
}

/**
 * Bir {lat,lng} noktasının radiusKm çevresindeki gerçek durakları (uzaklığa
 * göre sıralı) döner. requireReliableCoord=true iken, koordinatı tahmini
 * (UNRELIABLE_COORD_SOURCES) duraklar adaylıktan tamamen elenir — bir
 * adres/proje konumunun en yakın biniş/iniş noktası ARANIRKEN bu her zaman
 * true geçilmeli (findRealRoute/getDijkstraFrom'a bkz.).
 */
function stopsWithinRadius(graph, lat, lng, radiusKm, requireReliableCoord) {
  const cellSpan = Math.ceil(radiusKm / 0.5) + 1;
  const cellLat = Math.floor(lat / GRID_CELL_DEG);
  const cellLng = Math.floor(lng / GRID_CELL_DEG);
  const results = [];
  for (let dLat = -cellSpan; dLat <= cellSpan; dLat++) {
    for (let dLng = -cellSpan; dLng <= cellSpan; dLng++) {
      const bucket = graph.grid.get(`${cellLat + dLat}:${cellLng + dLng}`);
      if (!bucket) continue;
      bucket.forEach((id) => {
        const s = graph.stopsById.get(id);
        if (requireReliableCoord && UNRELIABLE_COORD_SOURCES.has(s.coordSource)) return;
        const km = haversineKm({ lat, lng }, { lat: s.lat, lng: s.lng });
        if (km <= radiusKm) results.push({ stop: s, km });
      });
    }
  }
  results.sort((a, b) => a.km - b.km);
  return results;
}

/**
 * Bir noktanın graf'a giriş/çıkış adaylarını seçer: en yakın
 * NEAREST_STOP_MAX_CANDIDATES durak + (bunların dışında kalan) en yakın
 * NEAREST_RAIL_EXTRA_CANDIDATES raylı/deniz durağı (bkz. o sabitin notu).
 */
function accessCandidates(graph, coords) {
  let all = stopsWithinRadius(graph, coords.lat, coords.lng, NEAREST_STOP_SEARCH_KM, true);
  if (all.length === 0) all = stopsWithinRadius(graph, coords.lat, coords.lng, NEAREST_STOP_FALLBACK_KM, true);
  const picked = all.slice(0, NEAREST_STOP_MAX_CANDIDATES);
  let extra = 0;
  for (let i = NEAREST_STOP_MAX_CANDIDATES; i < all.length && extra < NEAREST_RAIL_EXTRA_CANDIDATES; i++) {
    if (all[i].stop.rail) {
      picked.push(all[i]);
      extra += 1;
    }
  }
  return picked;
}

/**
 * Çok kaynaklı Dijkstra. ÖNEMLİ: durum sadece durak değil, "hangi hatta
 * bulunuluyor" bilgisini de taşır (stopId + lineId birlikte bir durum
 * oluşturur) — sadece durağa göre tek bir en-iyi-süre tutmak, gerçek bir
 * hatta binmişken ARA istasyonlardan birine başka (daha ucuz ama farklı)
 * bir hatla da ulaşılabiliyorsa, o ara istasyonun "daha ucuz" kaydını
 * kilitleyip asıl hattın devamını keşfetmeyi engelliyordu. Bu yüzden aynı
 * durağa aynı hatla ulaşan her farklı "durum" ayrı ayrı takip ediliyor;
 * bir durağa gerçekten en hızlı ulaşım ise tüm hat-durumları arasındaki
 * minimum olarak (bestAtStop) ayrıca tutuluyor.
 *
 * transferPenaltyMin > 0 verilirse, her araca binişe (gerçek bekleme süresinin
 * ÜSTÜNE) bu kadar yapay bir ceza eklenir — Dijkstra'yı gerçek süreden ÖNCE
 * aktarma sayısını azaltmaya zorlamak için ("En Az Aktarmalı" seçeneği,
 * bkz. buildMinTransfersAlternative). Sıralama bu cezalı süreye (minutes)
 * göre yapılır ama GERÇEK süre (ceza hariç) ayrıca realMinutes'ta tutulur —
 * kullanıcıya cezalı/uydurma bir süre asla gösterilmez.
 */
function runDijkstra(graph, sources, transferPenaltyMin = 0) {
  const NONE = " "; // henüz hiçbir hatta binilmemiş/sadece yürünüyor durumu
  const dist = new Map(); // "stopId|lineKey" -> sıralama için kullanılan (cezalı olabilir) dakika
  const realDist = new Map(); // "stopId|lineKey" -> GERÇEK dakika (ceza hariç)
  const prev = new Map(); // "stopId|lineKey" -> { fromKey, lineId, mode }
  const keyStopId = new Map(); // "stopId|lineKey" -> stopId
  const bestAtStop = new Map(); // stopId -> tüm hat-durumları arasında en iyi (cezalı olabilir) dakika
  const bestStateAtStop = new Map(); // stopId -> o en iyiye ulaşan durum anahtarı
  const bestRealMinutesAtStop = new Map(); // stopId -> o en iyiye karşılık gelen GERÇEK süre
  const heap = new MinHeap();

  function relaxBestAtStop(stopId, key, minutes, realMinutes) {
    const cur = bestAtStop.get(stopId);
    if (cur === undefined || minutes < cur - 1e-9) {
      bestAtStop.set(stopId, minutes);
      bestStateAtStop.set(stopId, key);
      bestRealMinutesAtStop.set(stopId, realMinutes);
    }
  }

  sources.forEach(({ stopId, startMinutes }) => {
    const key = stopId + "|" + NONE;
    if (!dist.has(key) || dist.get(key) > startMinutes) {
      dist.set(key, startMinutes);
      realDist.set(key, startMinutes);
      keyStopId.set(key, stopId);
      heap.push({ stopId, lineKey: NONE, minutes: startMinutes });
      relaxBestAtStop(stopId, key, startMinutes, startMinutes);
    }
  });

  while (!heap.isEmpty) {
    const cur = heap.pop();
    const curKey = cur.stopId + "|" + cur.lineKey;
    if (cur.minutes > dist.get(curKey) + 1e-6) continue; // eski/geçersiz kayıt
    const curLine = cur.lineKey === NONE ? null : cur.lineKey;
    const curRealMinutes = realDist.get(curKey);
    const edges = graph.adjacency.get(cur.stopId) || [];
    edges.forEach((e) => {
      // Yürüme kenarları durumu HER ZAMAN nötrler (NONE) — hangi hatla
      // gelindiği bilgisini taşımaya devam etseydi, yoğun aktarma
      // bölgelerinde durum sayısı yürüme zincirleri üzerinden katlanarak
      // patlıyordu. Yürümenin kendisi bedava (sadece kendi süresi var);
      // bekleme cezası SADECE bir araca binerken uygulanıyor (bkz.
      // avgWaitMin). Aynı hatta kalmaya devam etmek hâlâ tamamen bedava.
      let waitCost = 0;
      let newLineKey;
      const boarding = e.lineId && curLine !== e.lineId;
      if (e.lineId) {
        if (boarding) waitCost = avgWaitMin(e.mode);
        newLineKey = e.lineId;
      } else {
        newLineKey = NONE;
      }
      const penalty = boarding ? transferPenaltyMin : 0;
      const newMinutes = cur.minutes + e.minutes + waitCost + penalty;
      const newRealMinutes = curRealMinutes + e.minutes + waitCost;
      const newKey = e.to + "|" + newLineKey;
      const known = dist.get(newKey);
      if (known === undefined || newMinutes < known - 1e-9) {
        dist.set(newKey, newMinutes);
        realDist.set(newKey, newRealMinutes);
        keyStopId.set(newKey, e.to);
        prev.set(newKey, { fromKey: curKey, lineId: e.lineId, mode: e.mode });
        heap.push({ stopId: e.to, lineKey: newLineKey, minutes: newMinutes });
        relaxBestAtStop(e.to, newKey, newMinutes, newRealMinutes);
      }
    });
  }
  return { prev, keyStopId, bestAtStop, bestStateAtStop, bestRealMinutesAtStop };
}

// rankProjectsForOrigin/rankDistrictsForProject tek bir tarafı sabit tutup
// diğerini döngüyle değiştiriyor; hangi taraf sabitse Dijkstra'yı SADECE
// ondan bir kez çalıştırıp sonucu burada önbelleğe alıyoruz (aksi halde her
// proje/ilçe çifti için ayrı bir tam graf taraması gerekirdi). Graf içinde
// ayrıca transferPenaltyMin'e göre AYRI bir tek-girişlik yuva tutulur
// ("varyant") — aksi halde "En Hızlı" (ceza 0) ve "En Az Aktarmalı" (ceza>0)
// hesapları sırayla birbirinin önbelleğini geçersiz kılıp her seferinde
// sıfırdan koşardı.
const dijkstraCacheByGraph = new Map();

function getDijkstraFrom(coords, graph = transitGraph, transferPenaltyMin = 0) {
  const key = coords.lat.toFixed(4) + "," + coords.lng.toFixed(4);
  const variant = transferPenaltyMin || 0;
  let variants = dijkstraCacheByGraph.get(graph);
  if (!variants) {
    variants = new Map();
    dijkstraCacheByGraph.set(graph, variants);
  }
  const cached = variants.get(variant);
  if (cached && cached.key === key) return cached.result;
  const sources = accessCandidates(graph, coords).map(({ stop, km }) => ({
    stopId: stop.id,
    startMinutes: walkMinutes(km),
  }));
  const result = runDijkstra(graph, sources, transferPenaltyMin);
  variants.set(variant, { key, result });
  return result;
}

/**
 * originCoords/destCoords: {lat, lng}. graph verilmezse transitGraph kullanılır.
 * fixedSide: bir dizi çağrı boyunca hangi ucun SABİT kaldığını belirtir
 * ("origin" varsayılan). Dijkstra HER ZAMAN fixedSide tarafından koşturulur
 * (getDijkstraFrom tek girişlik önbelleğinden faydalansın diye) — origin
 * sabitken (ör. rankProjectsForOrigin: aynı aday için onlarca proje
 * taranıyor) bu zaten varsayılan davranıştır. fixedSide="dest" ise (ör.
 * rankDistrictsForProject: aynı proje için onlarca ilçe taranıyor) Dijkstra
 * dest'ten koşturulup yol sonradan origin->dest sırasına çevrilir — kenarın
 * hat/modu yöne bağlı olmadığı için (bkz. buildTransitGraph, her kenar iki
 * yönde de eklenir) bu çevirme sonucu ETKİLEMEZ, sadece SIRAYI düzeltir.
 * Dönüş: { totalMinutes, pathStopIds, edgeAtStop } ya da her iki nokta
 * arasında (yarıçap içinde hiç durak yoksa) null.
 */
function findRealRoute(originCoords, destCoords, graph = transitGraph, fixedSide = "origin", transferPenaltyMin = 0) {
  if (!graph) return null;
  const fromCoords = fixedSide === "dest" ? destCoords : originCoords;
  const toCoords = fixedSide === "dest" ? originCoords : destCoords;
  const { prev, keyStopId, bestAtStop, bestStateAtStop, bestRealMinutesAtStop } = getDijkstraFrom(
    fromCoords,
    graph,
    transferPenaltyMin
  );
  const toCandidates = accessCandidates(graph, toCoords);

  let best = null;
  toCandidates.forEach(({ stop, km }) => {
    const d = bestAtStop.get(stop.id);
    if (d === undefined) return;
    const walk = walkMinutes(km);
    const total = d + walk; // sıralama için kullanılan (cezalı olabilir) toplam
    if (!best || total < best.total) {
      best = { total, stopId: stop.id, realTotal: bestRealMinutesAtStop.get(stop.id) + walk };
    }
  });
  if (!best) return null;

  const pathStopIds = [];
  const edgeAtStop = new Map(); // varış durağı stopId -> o durağa gelirken kullanılan {lineId, mode}
  let curKey = bestStateAtStop.get(best.stopId);
  while (curKey) {
    const stopId = keyStopId.get(curKey);
    pathStopIds.unshift(stopId);
    const p = prev.get(curKey);
    if (p) edgeAtStop.set(stopId, { lineId: p.lineId, mode: p.mode });
    curKey = p ? p.fromKey : null;
  }

  if (fixedSide !== "dest") {
    return { totalMinutes: best.realTotal, pathStopIds, edgeAtStop };
  }

  // Dijkstra dest'ten koşturuldu; pathStopIds şu an dest->origin sırasında.
  // Çağıranın beklediği origin->dest sırasına çeviriyoruz.
  const reversedIds = [...pathStopIds].reverse();
  const reversedEdgeAtStop = new Map();
  for (let i = 0; i < pathStopIds.length - 1; i++) {
    reversedEdgeAtStop.set(pathStopIds[i], edgeAtStop.get(pathStopIds[i + 1]));
  }
  return { totalMinutes: best.realTotal, pathStopIds: reversedIds, edgeAtStop: reversedEdgeAtStop };
}

/** Bir durak dizisini (ve prev'deki hat bilgisini), ardışık aynı hattı tek adımda birleştirerek adımlara çevirir. */
function pathToSteps(pathStopIds, edgeAtStop, graph) {
  const rawEdges = [];
  for (let i = 1; i < pathStopIds.length; i++) {
    const info = edgeAtStop.get(pathStopIds[i]);
    rawEdges.push({ from: pathStopIds[i - 1], to: pathStopIds[i], lineId: info.lineId, mode: info.mode });
  }

  // Aynı fiziksel noktaya çok yakın ama farklı isimli/yönlü iki durak arası
  // (ör. bir caddenin gidiş/dönüş durakları) sıfıra yakın bir yürüme kenarı
  // oluşturabilir. Bunu BİRLEŞTİRMEDEN ÖNCE elemek gerekiyor — aksi halde
  // aynı hattın iki bacağı arasına sıkışan böyle bir kenar, birleşmeyi
  // engelleyip aynı hattı yapay şekilde iki ayrı adım gibi gösterebiliyor.
  const meaningfulEdges = rawEdges.filter((e) => {
    if (e.lineId) return true;
    const a = graph.stopsById.get(e.from);
    const b = graph.stopsById.get(e.to);
    return haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) > WALK_STEP_MIN_KM;
  });

  const merged = [];
  meaningfulEdges.forEach((e) => {
    const last = merged[merged.length - 1];
    if (last && last._lineId === e.lineId) {
      last.toStopId = e.to;
    } else {
      merged.push({ _lineId: e.lineId, mode: e.mode, fromStopId: e.from, toStopId: e.to });
    }
  });

  return merged.map((s) => {
    const fromName = graph.stopsById.get(s.fromStopId).name;
    const toName = graph.stopsById.get(s.toStopId).name;
    if (s._lineId) {
      const line = graph.linesByLocalId.get(s._lineId);
      return {
        mode: line ? line.mode : s.mode,
        line: line ? formatLineLabel(line.hatNo, line.name) : "Hat",
        from: fromName,
        to: toName,
        verified: line ? line.verified !== false : true,
        lineId: s._lineId,
      };
    }
    return { mode: "hub", line: "Yürüyüş", from: fromName, to: toName, verified: true, lineId: null };
  });
}

/** Bir rotanın başına/sonuna, gerçek ilk/son durağa olan yürümeyi (yeterince uzunsa) ayrı adım olarak ekler. */
function addAccessWalkSteps(steps, route, graph, origin, dest, originLabel, destLabel) {
  const firstStop = graph.stopsById.get(route.pathStopIds[0]);
  const lastStop = graph.stopsById.get(route.pathStopIds[route.pathStopIds.length - 1]);
  const firstWalkKm = haversineKm(origin.coords, { lat: firstStop.lat, lng: firstStop.lng });
  const lastWalkKm = haversineKm({ lat: lastStop.lat, lng: lastStop.lng }, dest.coords);

  if (lastWalkKm > WALK_STEP_MIN_KM) {
    steps.push({ mode: "hub", line: "Yürüyüş", from: lastStop.name, to: destLabel, verified: true, lineId: null });
  }
  if (firstWalkKm > WALK_STEP_MIN_KM) {
    steps.unshift({ mode: "hub", line: "Yürüyüş", from: originLabel, to: firstStop.name, verified: true, lineId: null });
  }
  return steps;
}

/**
 * originCoords/destCoords: {lat, lng}
 * fixedSide: bir dizi çağrı boyunca hangi ucun sabit kaldığını belirtir —
 * Dijkstra önbelleğinin isabet etmesi için findRealRoute'a olduğu gibi
 * iletilir (bkz. findRealRoute'un başındaki not).
 * Dönüş: { durationMin, transfers, routeSummary, steps, distanceKm, verified, minTransfersAlternative }
 */
function estimateTransit(origin, dest, fixedSide = "origin") {
  const distanceKm = haversineKm(origin.coords, dest.coords);
  const destLabel = dest.name || stopName(dest.stopId);
  const originLabel = origin.name || stopName(origin.stopId);

  if (!transitGraph) {
    // Graf henüz kurulmadı (transit_network.json hâlâ indiriliyor) — kaba bir
    // geçici tahmin döneriz; graf hazır olur olmaz runSearch() otomatik
    // tekrar çağrılıp sonuç sessizce gerçek rotayla güncellenir.
    const durationMin = Math.max(roundTo5((distanceKm / 18) * 60 + 10), 12);
    return {
      durationMin, transfers: 0,
      routeSummary: "Hesaplanıyor…",
      steps: [{ mode: "hub", line: "Hesaplanıyor…", from: originLabel, to: destLabel, verified: false, lineId: null }],
      distanceKm, verified: false,
    };
  }

  const route = findRealRoute(origin.coords, dest.coords, transitGraph, fixedSide);
  if (!route) {
    // Güvenlik ağı: bir uç, gerçek ağın yarıçapında (NEAREST_STOP_SEARCH_KM)
    // hiç durağa denk gelmiyorsa (ör. İstanbul dışı bir adres) düz tahmine düşülür.
    const durationMin = Math.max(roundTo5((distanceKm / 18) * 60 + 10), 12);
    return {
      durationMin, transfers: 0,
      routeSummary: `Yerel hat (doğrulanamadı) (${destLabel} civarı)`,
      steps: [{ mode: "otobus", line: "Yerel hat (doğrulanamadı)", from: originLabel, to: destLabel, verified: false, lineId: null, approx: true }],
      distanceKm, verified: false,
    };
  }

  const steps = addAccessWalkSteps(
    pathToSteps(route.pathStopIds, route.edgeAtStop, transitGraph),
    route, transitGraph, origin, dest, originLabel, destLabel
  );

  const rideSteps = steps.filter((s) => s.lineId);
  const transfers = Math.max(rideSteps.length - 1, 0);
  const durationMin = Math.max(roundTo5(route.totalMinutes), 5);
  const routeSummary = `${rideSteps.length ? rideSteps.map((s) => s.line).join(" + ") : "Yürüyüş"} (${destLabel} civarı)`;
  const verified = steps.every((s) => s.verified);

  const minTransfersAlternative = buildMinTransfersAlternative(origin, dest, originLabel, destLabel, transfers, durationMin, fixedSide);

  return { durationMin, transfers, routeSummary, steps, distanceKm, verified, minTransfersAlternative };
}

// "En Az Aktarmalı" seçenek: aynı grafta, aktarma başına büyük bir yapay süre
// cezası (bkz. runDijkstra transferPenaltyMin) ekleyerek AYRI bir Dijkstra
// çalıştırır. Ceza, olası herhangi bir gerçek süre farkından kat kat büyük
// olduğu için algoritma süreden ÖNCE aktarma sayısını azaltmaya zorlanır —
// ama kullanıcıya gösterilen süre yine GERÇEK süredir (bkz. findRealRoute'un
// realTotal'i). Sadece PRİMER (En Hızlı) rotadan GERÇEKTEN daha az
// aktarmalıysa ayrı bir seçenek olarak sunulur; aksi halde ikisi zaten aynı
// rotadır.
const MIN_TRANSFERS_PENALTY_MIN = 2000;

function buildMinTransfersAlternative(origin, dest, originLabel, destLabel, primaryTransfers, primaryDurationMin, fixedSide = "origin") {
  if (!transitGraph || primaryTransfers === 0) return null; // zaten aktarmasız — daha azı yok

  const altRoute = findRealRoute(origin.coords, dest.coords, transitGraph, fixedSide, MIN_TRANSFERS_PENALTY_MIN);
  if (!altRoute) return null;

  const altSteps = addAccessWalkSteps(
    pathToSteps(altRoute.pathStopIds, altRoute.edgeAtStop, transitGraph),
    altRoute, transitGraph, origin, dest, originLabel, destLabel
  );

  const altRideSteps = altSteps.filter((s) => s.lineId);
  const altTransfers = Math.max(altRideSteps.length - 1, 0);
  if (altTransfers >= primaryTransfers) return null; // gerçekten daha az aktarmalı değilse ayrı bir seçenek olarak gösterme

  const durationMin = Math.max(roundTo5(altRoute.totalMinutes), 5);
  const routeSummary = altRideSteps.length ? altRideSteps.map((s) => s.line).join(" + ") : "Yürüyüş";
  const verified = altSteps.every((s) => s.verified);

  return {
    durationMin,
    transfers: altTransfers,
    routeSummary,
    steps: altSteps,
    verified,
    extraMin: Math.max(roundTo5(durationMin - primaryDurationMin), 0),
  };
}

// ---------------------------------------------------------------------------
// 3) İLÇE BAZLI CACHE (localStorage) — gerçek API entegrasyonunda maliyet düşürür
// ---------------------------------------------------------------------------

const TransitCache = {
  KEY: "ist_ulasim_cache_v5", // v5: SHEET_API_URL kuruldu, statik data.js artık yalnızca çevrimdışı yedek
  _mem: null,
  _load() {
    if (this._mem) return this._mem;
    try {
      this._mem = JSON.parse(localStorage.getItem(this.KEY) || "{}");
    } catch {
      this._mem = {};
    }
    return this._mem;
  },
  _save() {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this._mem || {}));
    } catch {
      /* localStorage kullanılamıyorsa sessizce yoksay (örn. gizli sekme) */
    }
  },
  get(key) {
    return this._load()[key];
  },
  set(key, value) {
    this._load();
    this._mem[key] = value;
    this._save();
  },
  clearAll() {
    this._mem = {};
    this._save();
  },
};

/**
 * originId/destId: stabil kimlikler (ör. "kecioren" ilçe id'si, "proj_bilkent_center" proje id'si)
 * origin/dest: { coords: {lat,lng}, stopId }
 *
 * NOT: Gerçek entegrasyonda bu fonksiyonun içindeki estimateTransit çağrısı
 * Google Maps Transit API (Directions API, mode=transit) isteğiyle
 * değiştirilir. Cache anahtarı (originId_destId) aynı kalır; böylece aynı
 * ilçe-proje çifti tekrar sorgulandığında API'ye tekrar gidilmez.
 */
function getTransitEstimate(originId, origin, destId, dest, fixedSide = "origin") {
  const cacheKey = `${originId}__${destId}`;
  const cached = TransitCache.get(cacheKey);
  if (cached) return cached;

  const result = estimateTransit(origin, dest, fixedSide);
  TransitCache.set(cacheKey, result);
  return result;
}

// Cache anahtarı "originId__destId" biçiminde; id, anahtarın herhangi bir
// tarafında olabilir ("Aday → Proje" modunda origin ilk taraf, "Proje →
// Aday Havuzu" modunda proje ikinci taraftır) — bu yüzden ikisini de kontrol eder.
function invalidateCacheForOrigin(id) {
  const mem = TransitCache._load();
  Object.keys(mem)
    .filter((k) => k.startsWith(`${id}__`) || k.endsWith(`__${id}`))
    .forEach((k) => delete mem[k]);
  TransitCache._save();
}

// ---------------------------------------------------------------------------
// 3b) CANLI ADRES ARAMA + YAKIN DURAK/HAT KEŞFİ (Nominatim + Overpass)
// ---------------------------------------------------------------------------
//
// Etlik gibi bir semtte tek bir hat değil onlarca gerçek EGO hattı var. Statik
// veri seti (data.js) her ilçe/mahalle için sadece bir-iki doğrulanmış hat
// içeriyor. Bu bölüm, seçilen HERHANGİ BİR konum (serbest metinle aranan bir
// adres ya da hazır ilçe/mahalle seçimi) için OpenStreetMap/Overpass üzerinden
// o noktaya yürüme mesafesindeki TÜM gerçek durakları ve oradan geçen TÜM
// gerçek hatları canlı olarak bulur, bilinen aktarma ağımıza (Kızılay,
// Batıkent, Ankara Gar ve bunlara bağlı istasyonlar) isim eşleştirmesiyle
// ekler. Sonuçlar localStorage'da önbelleğe alınır.

let customOrigins = {}; // id -> { id, name, coords, stopId, discovery }
let customOriginCounter = 0;

function readJsonCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}
function writeJsonCache(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {
    /* localStorage kullanılamıyorsa sessizce yoksay */
  }
}

const GEOCODE_CACHE_KEY = "ist_ulasim_geocode_cache_v1";
const DISCOVERY_CACHE_KEY = "ist_ulasim_discovery_cache_v1"; // v3: KNOWN_STOP_NAME_INDEX genişletildi (yeni gerçek duraklar), önbellek sıfırlandı

// Nominatim'in kullanım politikası saniyede en fazla ~1 isteğe izin veriyor.
// Yüzlerce adaylık bir Excel'in ilk kez puanlanması sırasında (bkz.
// candidates.js) geocode istekleri Promise.all ile AYNI ANDA ateşlenirse hem
// politika ihlal edilir hem de Nominatim bir kısmını sessizce reddedip o
// adayları "konum belirlenemedi" diye yanlışlıkla eletebilir. Bu yüzden tüm
// geocode istekleri TEK bir kuyruktan, aralarında en az GEOCODE_MIN_INTERVAL_MS
// ile geçiyor — kaynak kaç eşzamanlı çağrı yaparsa yapsın.
const GEOCODE_MIN_INTERVAL_MS = 1100;
let geocodeQueueTail = Promise.resolve();
function queueGeocodeFetch(url) {
  const runNow = geocodeQueueTail.then(() => fetch(url, { headers: { Accept: "application/json" } }));
  geocodeQueueTail = runNow.catch(() => {}).then(() => new Promise((resolve) => setTimeout(resolve, GEOCODE_MIN_INTERVAL_MS)));
  return runNow;
}

/** Serbest metin bir adresi/semt adını İstanbul sınırlarıyla sınırlı şekilde koordinata çevirir (OSM Nominatim). */
async function geocodeAddress(query) {
  const cache = readJsonCache(GEOCODE_CACHE_KEY);
  const cacheKey = query.trim().toLocaleLowerCase("tr");
  if (cache[cacheKey]) return cache[cacheKey];

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    query + ", İstanbul, Türkiye"
  )}&viewbox=28.45,41.60,29.90,40.75&bounded=1&limit=1&countrycodes=tr`;
  const res = await queueGeocodeFetch(url);
  if (!res.ok) throw new Error("Nominatim isteği başarısız");
  const data = await res.json();
  if (!data.length) return null;

  const result = { label: data[0].display_name.split(",").slice(0, 2).join(",").trim(), lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  cache[cacheKey] = result;
  writeJsonCache(GEOCODE_CACHE_KEY, cache);
  return result;
}

// Gerçek hat verisinde (from/to/via/name alanlarında) bu isimlerden biri
// geçiyorsa, o hattın bilinen ağımızdaki karşılık gelen durağa ulaştığını
// kabul ediyoruz. SADECE gerçek durak adıyla BİREBİR eşleşen (yaklaşık/komşu
// semt değil) girdiler bulunmalı — bkz. Ankara'daki ikmaps-main/app.js'teki
// aynı bloğun başındaki gerekçe.
//
// Tamamı ISTANBUL_DATA.transitStops'taki GERÇEK (Overpass'ten doğrulanmış)
// durak adlarına ve id'lerine karşılık gelir — bkz. data.js'teki kaynak notu.
// Esenyurt/Sefaköy/Başakşehir gibi ağda doğrudan karşılığı olmayan semtler
// burada YOK (uydurmamak için) — data.js'te en yakın gerçek durağa yönlendirildi.
const KNOWN_STOP_NAME_INDEX = [
  ["kadıköy", "stop_kadikoy"],
  ["bostancı", "stop_bostanci"],
  ["üsküdar", "stop_uskudar"],
  ["altunizade", "stop_altunizade"],
  ["bulgurlu", "stop_bulgurlu"],
  ["ümraniye", "stop_umraniye"],
  ["kozyatağı", "stop_kozyatagi"],
  ["içerenköy", "stop_icerenkoy"],
  ["maltepe", "stop_maltepe"],
  ["gülsuyu", "stop_gulsuyu"],
  ["kartal", "stop_kartal"],
  ["soğanlık", "stop_soganlik"],
  ["pendik", "stop_pendik"],
  ["kurtköy", "stop_kurtkoy"],
  ["sabiha gökçen", "stop_sabiha_gokcen_havalimani"],
  ["ayrılık çeşmesi", "stop_ayrilik_cesmesi"],
  ["göztepe", "stop_goztepe"],
  ["küçükyalı", "stop_kucukyali"],
  ["kabataş", "stop_kabatas"],
  ["taksim", "stop_taksim"],
  ["levent", "stop_levent"],
  ["gayrettepe", "stop_gayrettepe"],
  ["etiler", "stop_etiler"],
  ["şişli", "stop_sisli"],
  ["mecidiyeköy", "stop_mecidiyekoy"],
  ["osmanbey", "stop_osmanbey"],
  ["kağıthane", "stop_kagithane"],
  ["seyrantepe", "stop_seyrantepe"],
  ["bakırköy", "stop_bakirkoy"],
  ["yeşilköy", "stop_yesilkoy"],
  ["florya", "stop_florya"],
  ["ataköy", "stop_atakoy"],
  ["bağcılar meydan", "stop_bagcilar_meydan"],
  ["bağcılar", "stop_bagcilar"],
  ["kirazlı", "stop_kirazli"],
  ["küçükçekmece", "stop_kucukcekmece"],
  ["yeşilyurt", "stop_yesilyurt"],
  ["halkalı", "stop_halkali"],
  ["onurkent", "stop_onurkent"],
  ["başakşehir", "stop_sehir_hastanesi"],
  ["mahmutbey", "stop_mahmutbey"],
  ["ikitelli", "stop_ikitelli_sanayi"],
  ["aksaray", "stop_aksaray"],
  ["yenikapı", "stop_yenikapi"],
  ["sirkeci", "stop_sirkeci"],
  ["eminönü", "stop_eminonu"],
  ["karaköy", "stop_karakoy"],
  ["zeytinburnu", "stop_zeytinburnu"],
  ["otogar", "stop_otogar"],
  ["topkapı", "stop_topkapi"],
  ["dudullu", "stop_dudullu"],
  ["çekmeköy", "stop_cekmekoy"],
  ["sancaktepe", "stop_sancaktepe"],
  ["sultanbeyli", "stop_sultanbeyli"],
  ["hacıosman", "stop_haciosman"],
  ["4. levent", "stop_4_levent"],
  ["büyükada", "stop_buyukada"],
  ["heybeliada", "stop_heybeliada"],
  ["burgazada", "stop_burgazada"],
  ["kınalıada", "stop_kinaliada"],
  ["beşiktaş iskelesi", "stop_besiktas_iskele"],
  ["beşiktaş", "stop_kabatas"],
];

// OSM'deki "name" etiketi çoğunlukla hat numarasını zaten içeriyor
// (ör. "279-2: Yükseltepe-...-Kızılay"); bu durumda ref'i tekrar başa eklemiyoruz.
function formatLineLabel(ref, name) {
  const safeName = name || "Hat";
  if (ref && safeName.startsWith(ref)) return safeName;
  return `${ref ? ref + ": " : ""}${safeName}`.trim();
}

function findKnownStopMatch(text) {
  if (!text) return null;
  const norm = text.toLocaleLowerCase("tr");
  const hit = KNOWN_STOP_NAME_INDEX.find(([kw]) => norm.includes(kw));
  return hit ? hit[1] : null;
}

// ---------------------------------------------------------------------------
// Yerel toplu taşıma ağı (transit_network.json — İBB Açık Veri Portalı, İETT
// resmi GTFS verisi, 21.04.2026): 1486 gerçek otobüs hattı ve 13.183 gerçek
// durak. Adres/semt arama artık ÖNCELİKLE bu önceden hazırlanmış, internet
// gerektirmeyen veri setini kullanıyor — canlı Overpass sorgusundan (tek
// nokta etrafında 700m, çoğu otobüs hattını kaçırabiliyordu) çok daha
// eksiksiz ve anında sonuç veriyor. discoverNearbyTransit() (Overpass) artık
// sadece bu yerel dosya hiç yüklenemezse yedek olarak kullanılıyor.
// ---------------------------------------------------------------------------
let localTransitNetwork = null;
let localTransitNetworkPromise = null;
let linesByLocalStopId = null;
let localStopsById = null;

// Metrobüs (34, 34A, 34AS, 34B, 34BZ, 34C, 34G, 34Z) İETT verisinde diğer
// otobüslerle aynı "otobus" modunda geliyor, ama kendi yolunda (BRT) gittiği
// için sıradan otobüsün 16 km/s hızıyla hesaplanınca gerçekte olduğundan
// yaklaşık 2.5 kat yavaş görünüyordu. Bu hatlar ayrı bir moda alınır.
const METROBUS_HAT_NO = /^34[A-Z]{0,2}$/;

/**
 * Rota grafı için tek bir {stops, lines} ağı kurar: data.js'teki raylı/deniz
 * ağı (metro, tramvay, Marmaray, füniküler, vapur — stop.rail=true, giriş/çıkış
 * adayı seçiminde öncelik alır, bkz. accessCandidates) + İETT otobüs ağı.
 */
function buildRoutingNetwork(busData) {
  const railStops = ISTANBUL_DATA.transitStops.map((s) => ({
    id: s.id, name: s.name, lat: s.lat, lng: s.lng, rail: true, coordSource: "data.js (OSM/Overpass)",
  }));
  const railLines = ISTANBUL_DATA.transitLines.map((l) => ({
    // Vapur hatlarının id'si ("F_KADIKOY_BESIKTAS") iç bir kod — etiket olarak gösterilmesin.
    id: l.id, hatNo: l.mode === "vapur" ? "" : l.id, name: l.name, mode: l.mode, verified: l.verified !== false, stopIds: l.stopIds,
  }));
  const busLines = busData.lines.map((l) =>
    l.mode === "otobus" && METROBUS_HAT_NO.test(l.hatNo || "") ? { ...l, mode: "metrobus" } : l
  );
  return { stops: railStops.concat(busData.stops), lines: railLines.concat(busLines) };
}

function loadLocalTransitNetwork() {
  if (localTransitNetworkPromise) return localTransitNetworkPromise;
  localTransitNetworkPromise = fetch("transit_network.json?v=2")
    .then((res) => res.json())
    .then((data) => {
      localTransitNetwork = data;
      localStopsById = Object.fromEntries(data.stops.map((s) => [s.id, s]));
      linesByLocalStopId = {};
      data.lines.forEach((line) => {
        (line.stopIds || []).forEach((sid) => {
          (linesByLocalStopId[sid] = linesByLocalStopId[sid] || []).push(line);
        });
      });
      // Gerçek graf tabanlı rota motorunu (bkz. §2) bu veriyle kur. Kurulana
      // kadar estimateTransit() kaba bir geçici tahmin döner; kurulur kurulmaz
      // (henüz bir arama gösteriliyorsa) sonuçlar sessizce gerçek rotayla
      // güncellensin diye mevcut arama tekrar çalıştırılır.
      transitGraph = buildTransitGraph(buildRoutingNetwork(data));
      if (typeof runSearch === "function") runSearch();
      return data;
    })
    .catch(() => null);
  return localTransitNetworkPromise;
}
loadLocalTransitNetwork(); // sayfa açılışında arka planda hemen başlat

// Hat geometrileri (gerçek güzergah şekilleri) ayrı, biraz daha büyük bir
// dosyada (transit_network_geometry.json, ~1.8MB, seyreltilmiş) tutuluyor ve
// stops/lines'tan SONRA, arka planda yükleniyor — sayfa açılışını yavaşlatmasın
// diye. Yüklendiğinde, o ana kadar çizilmiş olabilecek rotayı gerçek
// güzergah şekliyle yeniden çizmek için mevcut aramayı tekrarlar.
let localTransitGeometry = null;
let localTransitGeometryPromise = null;
function loadLocalTransitGeometry() {
  if (localTransitGeometryPromise) return localTransitGeometryPromise;
  localTransitGeometryPromise = fetch("transit_network_geometry.json?v=2")
    .then((res) => res.json())
    .then((data) => {
      localTransitGeometry = data;
      // Geometri yüklenmeden ÖNCE keşfedilip spliceDiscoveredLines ile
      // eklenmiş olabilecek hatlara (o an geometrisiz kaldılar) geometriyi
      // şimdi işle — runSearch() tek başına bunu yapmaz, çünkü aynı origin
      // ikinci kez enrichOriginInBackground'dan geçmez (enrichedOriginIds).
      Object.values(linesById).forEach((line) => {
        if (!line.geometry && line.localLineId && data[line.localLineId]) {
          line.geometry = data[line.localLineId];
        }
      });
      if (typeof runSearch === "function") runSearch();
      return data;
    })
    .catch(() => null);
  return localTransitGeometryPromise;
}
loadLocalTransitNetwork().then(() => loadLocalTransitGeometry());

/**
 * discoverNearbyTransit ile AYNI sözleşmeye sahip ({stops, lines, nearestStopName})
 * ama yerel veri setini kullanır — ağ isteği yok, anında sonuç. Bir hattın
 * "hubStopId"si artık sadece rota adının metnine bakılarak değil, hattın
 * TÜM gerçek durak sırası (stopIds) taranıp bilinen 54 duraktan birine denk
 * gelen gerçek bir durak var mı diye kontrol edilerek bulunuyor — bu yüzden
 * ismi bilinen bir hub'ı anmayan ama gerçekte oradan geçen hatlar da artık
 * doğru şekilde bağlanabiliyor.
 */
async function discoverNearbyTransitLocal(lat, lng) {
  const net = await loadLocalTransitNetwork();
  if (!net) return null;

  const nearby = net.stops
    .map((s) => ({ s, distanceM: Math.round(haversineKm({ lat, lng }, { lat: s.lat, lng: s.lng }) * 1000) }))
    .filter((x) => x.distanceM <= 700)
    .sort((a, b) => a.distanceM - b.distanceM);

  const seenLineIds = new Set();
  const lines = [];
  nearby.forEach(({ s }) => {
    (linesByLocalStopId[s.id] || []).forEach((line) => {
      if (seenLineIds.has(line.id)) return;
      seenLineIds.add(line.id);
      let hubStopId = null;
      for (const sid of line.stopIds || []) {
        const stop = localStopsById[sid];
        if (stop && stop.knownStopId) {
          hubStopId = stop.knownStopId;
          break;
        }
      }
      lines.push({ ref: line.hatNo || "", name: line.name, mode: line.mode, hubStopId, localLineId: line.id });
    });
  });
  lines.sort((a, b) => (a.hubStopId ? 0 : 1) - (b.hubStopId ? 0 : 1));

  return {
    stops: nearby.slice(0, 8).map(({ s, distanceM }) => ({ name: s.name, distanceM })),
    lines,
    nearestStopName: nearby[0] ? nearby[0].s.name : null,
  };
}

/** Önce yerel veri setini dener, hiç yüklenemediyse (ör. dosya erişilemedi) canlı Overpass'e düşer. */
async function discoverNearbyTransitBest(lat, lng) {
  const local = await discoverNearbyTransitLocal(lat, lng);
  if (local) return local;
  try {
    return await discoverNearbyTransit(lat, lng);
  } catch {
    return { stops: [], lines: [], nearestStopName: null };
  }
}

/**
 * Bir koordinatın ~700m çevresindeki gerçek toplu taşıma duraklarını ve
 * oradan geçen hat (route) ilişkilerini Overpass API'den canlı çeker.
 * Dönüş: { stops: [{name, distanceM}], lines: [{ref,name,mode,hubStopId}] }
 */
async function discoverNearbyTransit(lat, lng) {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cache = readJsonCache(DISCOVERY_CACHE_KEY);
  if (cache[cacheKey]) return cache[cacheKey];

  const query = `[out:json][timeout:25];
(
  node(around:700,${lat},${lng})["public_transport"="platform"];
  node(around:700,${lat},${lng})["highway"="bus_stop"];
)->.st;
.st out body;
rel(bn.st)["route"];
out tags;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error("Overpass isteği başarısız");
  const data = await res.json();

  const stops = [];
  const lines = [];
  const seenLineNames = new Set();
  (data.elements || []).forEach((el) => {
    if (el.type === "node" && el.tags && el.tags.name) {
      stops.push({ name: el.tags.name, distanceM: Math.round(haversineKm({ lat, lng }, { lat: el.lat, lng: el.lon }) * 1000) });
    } else if (el.type === "relation") {
      const t = el.tags || {};
      if (!["bus", "subway", "light_rail", "train"].includes(t.route)) return;
      const label = formatLineLabel(t.ref, t.name);
      if (!t.name && !t.ref) return;
      if (seenLineNames.has(label)) return;
      seenLineNames.add(label);
      lines.push({
        ref: t.ref || "",
        name: t.name || t.ref || "Hat",
        mode: t.route === "bus" ? "otobus" : t.route === "train" ? "tren" : t.route === "light_rail" ? "tramvay" : "metro",
        hubStopId: findKnownStopMatch(`${t.name || ""} ${t.from || ""} ${t.to || ""} ${t.via || ""}`),
      });
    }
  });

  stops.sort((a, b) => a.distanceM - b.distanceM);
  lines.sort((a, b) => (a.hubStopId ? 0 : 1) - (b.hubStopId ? 0 : 1));

  const result = { stops: stops.slice(0, 8), lines, nearestStopName: stops[0] ? stops[0].name : null };
  cache[cacheKey] = result;
  writeJsonCache(DISCOVERY_CACHE_KEY, cache);
  return result;
}

/**
 * Bir discovery sonucundaki hub'a bağlanabilen hatları, verilen stopId'ye
 * canlı hat olarak ekler (linesById/linesByStopId'ye yeni satırlar ekler —
 * bunlar rota hesaplamasını değil, yalnızca "bu bölgeden geçen gerçek
 * hatlar" bilgi panelini besliyor; rota transitGraph üzerinden hesaplanıyor,
 * bkz. §2). Zaten eklenmiş hatları tekrar eklemez.
 */
function spliceDiscoveredLines(stopId, discovery) {
  linesByStopId[stopId] = linesByStopId[stopId] || [];
  const existingNames = new Set(linesByStopId[stopId].map((lid) => linesById[lid] && linesById[lid].name));
  let addedCount = 0;

  discovery.lines.forEach((l, idx) => {
    if (!l.hubStopId) return;
    const label = formatLineLabel(l.ref, l.name);
    if (existingNames.has(label)) return;

    const lineId = `LIVE_${stopId}_${idx}`;
    // localLineId varsa bu hat, yerel veri setinden (transit_network.json)
    // geldi — geometrisi zaten yüklendiyse (transit_network_geometry.json)
    // gerçek güzergah şekli haritada çizilebilir; henüz yüklenmediyse
    // drawRoute eskisi gibi düz/kesikli çizgiye döner, geometri gelince
    // (loadLocalTransitGeometry -> runSearch) otomatik yeniden çizilir.
    const geometry = l.localLineId && localTransitGeometry ? localTransitGeometry[l.localLineId] : null;
    linesById[lineId] = {
      id: lineId,
      name: label,
      mode: l.mode,
      verified: true,
      source: l.localLineId ? "OSM/Overpass, EGO Genel Müdürlüğü — 28.08.2026" : "OSM/Overpass canlı sorgu",
      stopIds: [stopId, l.hubStopId],
      geometry: geometry || undefined,
      localLineId: l.localLineId || undefined, // geometri sonradan yüklenirse doldurulabilsin diye saklanır
    };
    linesByStopId[stopId].push(lineId);
    (linesByStopId[l.hubStopId] = linesByStopId[l.hubStopId] || []).push(lineId);
    addedCount += 1;
  });

  return addedCount;
}

function registerCustomOrigin(label, lat, lng) {
  customOriginCounter += 1;
  const stopId = `stop_custom_${customOriginCounter}`;
  const originId = `custom_${customOriginCounter}`;

  stopsById[stopId] = { id: stopId, name: label, mode: "custom" };
  linesByStopId[stopId] = [];

  const origin = {
    id: originId,
    kind: "custom",
    name: label,
    districtName: label,
    coords: { lat, lng },
    stopId,
  };
  customOrigins[originId] = origin;
  return origin;
}

// ---------------------------------------------------------------------------
// 4) VERİ ERİŞİM YARDIMCILARI
// ---------------------------------------------------------------------------

function allOrigins() {
  // İlçeler + mahalleler, tek düz liste olarak (mahalle kendi stopId'sini
  // taşımıyorsa ilçenin access stop'unu miras alır)
  const items = [];
  ISTANBUL_DATA.districts.forEach((d) => {
    items.push({
      id: d.id,
      kind: "district",
      name: d.name,
      districtName: d.name,
      coords: { lat: d.lat, lng: d.lng },
      stopId: d.accessStopId,
    });
    (d.neighborhoods || []).forEach((n) => {
      items.push({
        id: n.id,
        kind: "neighborhood",
        name: `${n.name} (${d.name})`,
        districtName: d.name,
        coords: { lat: n.lat, lng: n.lng },
        stopId: n.accessStopId || d.accessStopId,
      });
    });
  });
  return items;
}

function originById(id) {
  if (customOrigins[id]) return customOrigins[id];
  return allOrigins().find((o) => o.id === id);
}

function projectById(id) {
  const p = ISTANBUL_DATA.projects.find((x) => x.id === id);
  if (!p) return null;
  return { id: p.id, kind: "project", name: p.name, coords: { lat: p.lat, lng: p.lng }, stopId: p.accessStopId, sector: p.sector, address: p.address };
}

// ---------------------------------------------------------------------------
// 5) ANA EŞLEŞTİRME ALGORİTMASI
// ---------------------------------------------------------------------------

/**
 * Aday -> Proje: bir başlangıç (ilçe/mahalle) için tüm projeleri süreye göre sıralar.
 * thresholdMin verilirse (30/45/60) sadece o sürenin altındakiler döner.
 */
function rankProjectsForOrigin(originId, thresholdMin = null) {
  const origin = originById(originId);
  if (!origin) return [];

  const rows = applyPositionFilter(activeProjects()).map((p) => {
    const dest = projectById(p.id);
    const estimate = getTransitEstimate(originId, origin, p.id, dest);
    return { project: p, origin, ...estimate };
  });

  // Acil projeler, mesafe/süre ne olursa olsun listenin en üstünde çıkar
  // (haftalık acil kadroların önce görülüp ilerletilmesi için); acil olanlar
  // kendi aralarında yine süreye göre sıralanır.
  rows.sort((a, b) => {
    const aUrgent = URGENT_PROJECT_IDS.has(a.project.id) ? 1 : 0;
    const bUrgent = URGENT_PROJECT_IDS.has(b.project.id) ? 1 : 0;
    if (aUrgent !== bUrgent) return bUrgent - aUrgent;
    return a.durationMin - b.durationMin;
  });
  return thresholdMin ? rows.filter((r) => r.durationMin <= thresholdMin) : rows;
}

/**
 * Proje -> Aday Havuzu: bir proje için tüm ilçeleri (mahalle değil, ilçe
 * seviyesinde) süreye göre sıralar. thresholdMin ile filtrelenebilir.
 */
function rankDistrictsForProject(projectId, thresholdMin = null) {
  const dest = projectById(projectId);
  if (!dest) return [];

  const rows = ISTANBUL_DATA.districts.map((d) => {
    const origin = originById(d.id);
    // fixedSide="dest": proje bu döngü boyunca sabit, ilçe her satırda
    // değişiyor — Dijkstra'nın proje tarafından koşup önbelleğe isabet
    // etmesi için (aksi halde her ilçe için sıfırdan tam graf taraması
    // gerekirdi, bkz. findRealRoute'un başındaki not).
    const estimate = getTransitEstimate(d.id, origin, projectId, dest, "dest");
    return { district: d, dest, ...estimate };
  });

  rows.sort((a, b) => a.durationMin - b.durationMin);
  return thresholdMin ? rows.filter((r) => r.durationMin <= thresholdMin) : rows;
}

function durationBucket(min) {
  if (min <= 30) return { key: "good", label: "≤30 dk", color: "#16a34a" };
  if (min <= 45) return { key: "ok", label: "31-45 dk", color: "#d97706" };
  if (min <= 60) return { key: "warn", label: "46-60 dk", color: "#ea580c" };
  return { key: "bad", label: "60+ dk", color: "#dc2626" };
}

const MODE_ICON = {
  metro: "🚇", tramvay: "🚊", marmaray: "🚆", funikuler: "🚡", tren: "🚆",
  otobus: "🚌", metrobus: "🚍", vapur: "⛴️", hub: "📍", yurume: "🚶",
};
// Haritada bacak başına renk: İstanbul toplu taşıma kurumsal renklerine
// yakın bir palet (metro kırmızı, tramvay mavi, Marmaray mor, füniküler turuncu).
const MODE_LINE_COLOR = {
  metro: "#dc2626", tramvay: "#2563eb", marmaray: "#7c3aed", funikuler: "#ea580c",
  tren: "#7c3aed", otobus: "#0d9488", metrobus: "#d97706", vapur: "#0891b2", hub: "#64748b", yurume: "#94a3b8",
};

/**
 * estimate.steps dizisinden, "hangi hatta binip nerede inecek" şeklinde
 * numaralı bir adım adım rota listesi (HTML) üretir. Doğrulanmamış (mock)
 * hatlar için ayrıca bir "TAHMİNİ" rozeti gösterilir.
 */
function renderRouteSteps(steps) {
  return steps
    .map((s, i) => {
      const icon = MODE_ICON[s.mode] || "➡️";
      const badge = s.verified === false ? `<span class="route-step-badge">TAHMİNİ</span>` : "";
      if (s.mode === "hub") {
        return `
          <div class="route-step">
            <span class="route-step-icon">${icon}</span>
            <div class="route-step-body">
              <div class="route-step-line">${s.line}</div>
              <div class="route-step-stops">${s.from} / ${s.to} — yürüme mesafesinde</div>
            </div>
          </div>`;
      }
      if (s.approx) {
        return `
          <div class="route-step">
            <span class="route-step-num">${i + 1}</span>
            <span class="route-step-icon">${icon}</span>
            <div class="route-step-body">
              <div class="route-step-line">${s.line}${badge}</div>
              <div class="route-step-stops"><b>${s.from}</b> durağından binip <b>${s.to}</b> bölgesine yakın bir noktada inin (kesin durak belli değil, yaklaşık)</div>
            </div>
          </div>`;
      }
      return `
        <div class="route-step">
          <span class="route-step-num">${i + 1}</span>
          <span class="route-step-icon">${icon}</span>
          <div class="route-step-body">
            <div class="route-step-line">${s.line}${badge}</div>
            <div class="route-step-stops"><b>${s.from}</b>'den binin → <b>${s.to}</b>'de inin</div>
          </div>
        </div>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// 6) UI KATMANI
// ---------------------------------------------------------------------------

const map = L.map("map", { zoomControl: true }).setView([41.005, 28.98], 10.4);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap katkıda bulunanlar",
  maxZoom: 19,
  subdomains: "abc",
}).addTo(map);
L.control.scale({ metric: true, imperial: false, position: "bottomright" }).addTo(map);

const projectIcon = L.divIcon({
  className: "",
  html: `<div class="pin pin-project"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});
const urgentProjectIcon = L.divIcon({
  className: "",
  html: `<div class="pin pin-project pin-project-urgent"></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});
function districtIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div class="pin pin-district" style="background:${color}"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

let markersLayer = L.layerGroup().addTo(map);
let routesLayer = L.layerGroup().addTo(map);

// Proje pinleri (53 adet) çok kalabalık olduğundan (ör. Bilkent'te 15+ proje
// üst üste biniyor) kümeleme kullanıyoruz: yakınlaşınca otomatik ayrışırlar.
const projectCluster = L.markerClusterGroup({
  maxClusterRadius: 45,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  iconCreateFunction: (cluster) =>
    L.divIcon({
      html: `<div>${cluster.getChildCount()}</div>`,
      className: "marker-cluster-custom",
      iconSize: [38, 38],
    }),
});

const projectMarkersById = {};

function buildProjectMarker(p) {
  const isUrgent = URGENT_PROJECT_IDS.has(p.id);
  const m = L.marker([p.lat, p.lng], { icon: isUrgent ? urgentProjectIcon : projectIcon });
  m.bindTooltip(`${isUrgent ? "🔴 ACİL — " : ""}${escapeHtml(p.name)} — ${escapeHtml(p.address)}`, { direction: "top" });
  projectMarkersById[p.id] = m;
  if (!INACTIVE_PROJECT_IDS.has(p.id)) {
    projectCluster.addLayer(m);
  }
  return m;
}
ISTANBUL_DATA.projects.forEach(buildProjectMarker);
map.addLayer(projectCluster);

// Proje listesi kökten değiştiğinde (Sheet'ten canlı veri geldiğinde ya da
// yeni bir proje eklendiğinde) tüm pinleri sıfırdan kurar.
function rebuildAllProjectMarkers() {
  projectCluster.clearLayers();
  Object.keys(projectMarkersById).forEach((id) => delete projectMarkersById[id]);
  ISTANBUL_DATA.projects.forEach(buildProjectMarker);
}

// Acil/aktiflik seçimi değiştiğinde (modal'dan kaydedince) harita pinlerini/
// tooltip'lerini ve kümedeki üyeliğini yeniden hesaplar — sayfayı
// yenilemeye gerek kalmaz. Kapalı projelerin pini haritada hiç görünmez.
function refreshProjectMarkers() {
  ISTANBUL_DATA.projects.forEach((p) => {
    const marker = projectMarkersById[p.id];
    if (!marker) return;
    const isActive = !INACTIVE_PROJECT_IDS.has(p.id);
    const isUrgent = URGENT_PROJECT_IDS.has(p.id);
    marker.setIcon(isUrgent ? urgentProjectIcon : projectIcon);
    marker.setTooltipContent(`${isUrgent ? "🔴 ACİL — " : ""}${escapeHtml(p.name)} — ${escapeHtml(p.address)}`);
    const inCluster = projectCluster.hasLayer(marker);
    if (isActive && !inCluster) {
      projectCluster.addLayer(marker);
    } else if (!isActive && inCluster) {
      projectCluster.removeLayer(marker);
    }
  });
}

// ---- DOM referansları ----
const modeButtons = document.querySelectorAll(".mode-btn[data-mode]");
const originPanel = document.getElementById("panel-origin");
const projectPanel = document.getElementById("panel-project");
const originSelect = document.getElementById("originSelect");
const projectSelect = document.getElementById("projectSelect");
const thresholdButtons = document.querySelectorAll(".threshold-btn[data-threshold]");
const positionButtons = document.querySelectorAll(".position-btn");
const resultsList = document.getElementById("resultsList");
const resultsHeading = document.getElementById("resultsHeading");
const emptyState = document.getElementById("emptyState");
const routeDetail = document.getElementById("routeDetail");
const routeDetailTitle = document.getElementById("routeDetailTitle");
const routeDetailSteps = document.getElementById("routeDetailSteps");
const routeDetailWarning = document.getElementById("routeDetailWarning");
const routeDetailVariantToggle = document.getElementById("routeDetailVariantToggle");
const routeVariantFastestBtn = document.getElementById("routeVariantFastestBtn");
const routeVariantFewestBtn = document.getElementById("routeVariantFewestBtn");
const addressInput = document.getElementById("addressInput");
const addressSearchBtn = document.getElementById("addressSearchBtn");
const addressStatus = document.getElementById("addressStatus");
const nearbyLinesPanel = document.getElementById("nearbyLinesPanel");
const nearbyLinesList = document.getElementById("nearbyLinesList");
const nearbyLinesToggle = document.getElementById("nearbyLinesToggle");
const nearbyLinesSummary = document.getElementById("nearbyLinesSummary");
const nearbyLinesChevron = document.getElementById("nearbyLinesChevron");

nearbyLinesToggle.addEventListener("click", () => {
  const expanded = !nearbyLinesList.classList.contains("hidden");
  nearbyLinesList.classList.toggle("hidden", expanded);
  nearbyLinesChevron.textContent = expanded ? "▾ göster" : "▴ gizle";
});

let currentMode = "origin-to-project"; // veya "project-to-origin"
let currentThreshold = null; // null = tümü
let currentPositionFilter = null; // null = tümü — proje.position ile eşleşir (bkz. Pozisyon Filtresi)

/** Pozisyon Filtresi seçiliyse listeyi proje.position'a göre daraltır; seçili değilse (Tümü) olduğu gibi döner. */
function applyPositionFilter(projects) {
  return currentPositionFilter ? projects.filter((p) => p.position === currentPositionFilter) : projects;
}
const enrichedOriginIds = new Set(); // canlı Overpass sorgusu zaten yapılmış origin id'leri

// Select doldur
ISTANBUL_DATA.districts.forEach((d) => {
  const optGroup = document.createElement("optgroup");
  optGroup.label = d.name;
  const districtOpt = document.createElement("option");
  districtOpt.value = d.id;
  districtOpt.textContent = `${d.name} (ilçe merkezi)`;
  optGroup.appendChild(districtOpt);
  (d.neighborhoods || []).forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n.id;
    opt.textContent = n.name;
    optGroup.appendChild(opt);
  });
  originSelect.appendChild(optGroup);
});

// Kapalı (pasif) projeler bu kutuda hiç görünmez; aktiflik "Proje Aç/Kapa"
// penceresinden değiştirildiğinde bu fonksiyon yeniden çağrılarak kutu
// güncel tutulur — seçili proje pasife düşerse seçim ve sonuçlar temizlenir.
function rebuildProjectSelect() {
  const previouslySelected = projectSelect.value;
  projectSelect.innerHTML = '<option value="">Seçiniz…</option>';

  const projectsBySector = {};
  applyPositionFilter(activeProjects()).forEach((p) => {
    (projectsBySector[p.sector] = projectsBySector[p.sector] || []).push(p);
  });
  Object.keys(projectsBySector)
    .sort()
    .forEach((sector) => {
      const optGroup = document.createElement("optgroup");
      optGroup.label = sector;
      projectsBySector[sector]
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "tr"))
        .forEach((p) => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = `${p.name} — ${p.address}`;
          optGroup.appendChild(opt);
        });
      projectSelect.appendChild(optGroup);
    });

  if (previouslySelected && !INACTIVE_PROJECT_IDS.has(previouslySelected)) {
    projectSelect.value = previouslySelected;
  }
}
rebuildProjectSelect();

// ---- Mod değişimi ----
modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentMode = btn.dataset.mode;
    modeButtons.forEach((b) => b.classList.toggle("mode-btn-active", b === btn));
    originPanel.classList.toggle("hidden", currentMode !== "origin-to-project");
    // Hem "Proje -> Aday Havuzu" hem "Proje -> Gerçek Adaylar" aynı proje
    // seçim kutusunu (panel-project) kullanır.
    projectPanel.classList.toggle("hidden", currentMode === "origin-to-project");
    clearResults();
    // "Proje -> Gerçek Adaylar" harita/sidebar yerine tam ekran ayrı bir
    // görünümde açılır (candidates.js) — yüzlerce aday cramped bir listeye
    // sığmıyor, aday detayı da ayrı bir panelde gösterilmesi gerekiyordu.
    if (typeof toggleCandidateFullscreen === "function") {
      toggleCandidateFullscreen(currentMode === "project-to-candidates");
    }
  });
});

thresholdButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentThreshold = btn.dataset.threshold === "all" ? null : Number(btn.dataset.threshold);
    thresholdButtons.forEach((b) => b.classList.toggle("threshold-btn-active", b === btn));
    runSearch();
  });
});

positionButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentPositionFilter = btn.dataset.position === "all" ? null : btn.dataset.position;
    positionButtons.forEach((b) => b.classList.toggle("threshold-btn-active", b === btn));
    rebuildProjectSelect();
    // candidates.js app.js'ten SONRA yüklenir — ilk çağrıda henüz tanımlı
    // olmayabilir, o yüzden varlığı kontrol edilir (bkz. toggleCandidateFullscreen deseni).
    if (typeof populateCandidateFsProjectSelect === "function") populateCandidateFsProjectSelect();
    if (
      (currentMode === "project-to-origin" || currentMode === "project-to-candidates") &&
      projectSelect.value &&
      !applyPositionFilter(activeProjects()).some((p) => p.id === projectSelect.value)
    ) {
      clearResults();
    } else {
      runSearch();
    }
  });
});

originSelect.addEventListener("change", runSearch);
projectSelect.addEventListener("change", runSearch);

// ---- Serbest metin adres/konum arama (Nominatim + Overpass canlı keşif) ----
addressSearchBtn.addEventListener("click", handleAddressSearch);
addressInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAddressSearch();
});

// NOT: canlı otobüs/durak taraması (discoverNearbyTransit -> Overpass) birkaç
// saniye sürebiliyor (Overpass yoğunken 8-10sn+). Önceden bu taramanın
// bitmesi TÜM aramayı bloke ediyordu — kullanıcı sonuçları görmeden önce
// uzun süre bekliyordu. Şimdi ilçe/mahalle akışındaki (enrichOriginInBackground)
// aynı desen kullanılıyor: konum bulunur bulunmaz (en yakın gerçek durağın
// bağlantıları ödünç alınarak) sonuçlar hemen gösterilir, canlı tarama arka
// planda devam edip bittiğinde sonuçlar sessizce daha da iyileştirilir.
async function handleAddressSearch() {
  const query = addressInput.value.trim();
  if (!query) return;

  addressSearchBtn.disabled = true;
  addressStatus.textContent = "Konum aranıyor…";
  try {
    const geo = await geocodeAddress(query);
    if (!geo) {
      addressStatus.textContent = "Konum bulunamadı. Farklı bir yazımla (ör. \"Etlik Şehir Hastanesi\") deneyin.";
      return;
    }

    const origin = registerCustomOrigin(geo.label, geo.lat, geo.lng);
    const nearest = nearestTransitStop(geo.lat, geo.lng);
    if (nearest) {
      // Canlı tarama bitene kadar en yakın gerçek durağın bağlantılarını
      // geçici olarak kullan — böylece ilk gösterilen rotalar da anlamlı olur.
      linesByStopId[origin.stopId] = [...(linesByStopId[nearest.id] || [])];
    }

    const opt = document.createElement("option");
    opt.value = origin.id;
    opt.textContent = `📍 ${origin.name}`;
    originSelect.insertBefore(opt, originSelect.firstChild.nextSibling);
    originSelect.value = origin.id;

    addressStatus.textContent = "Yakındaki gerçek duraklar/hatlar taranıyor…";
    runSearch();

    const discovery = await discoverNearbyTransitBest(geo.lat, geo.lng);
    const addedCount = spliceDiscoveredLines(origin.stopId, discovery);
    enrichedOriginIds.add(origin.id);
    currentDiscoveryByOriginId[origin.id] = discovery;
    addressStatus.textContent = `${discovery.lines.length} gerçek hat bulundu (${addedCount} tanesi rotaya bağlanabildi).`;
    if (originSelect.value === origin.id) {
      renderNearbyLinesPanel(origin.id);
      if (addedCount > 0) runSearch();
    }
  } catch (err) {
    addressStatus.textContent = "Bağlantı hatası — internet bağlantınızı kontrol edip tekrar deneyin.";
  } finally {
    addressSearchBtn.disabled = false;
  }
}

const currentDiscoveryByOriginId = {};

// Bir origin/project id'sinin şu an ekranda aktif seçili olan taraf olup
// olmadığını (yani panel/sonuçları yeniden çizmenin anlamlı olup olmadığını)
// her iki mod için de doğru şekilde belirler.
function isActiveSelection(id) {
  if (currentMode === "origin-to-project") return originSelect.value === id;
  if (currentMode === "project-to-origin" || currentMode === "project-to-candidates") return projectSelect.value === id;
  return false;
}

/**
 * Hazır ilçe/mahalle/proje seçimleri için de aynı canlı keşfi (arka planda,
 * sonucu beklemeden) çalıştırır: statik veri anında sonuç verir, birkaç
 * saniye sonra bulunan ek gerçek hatlar sessizce eklenip sonuçlar tazelenir.
 * "Aday → Proje" modunda seçilen ilçe/adres için, "Proje → Aday Havuzu"
 * modunda ise seçilen projenin kendi konumu için çağrılır — aksi halde
 * yalnızca bir yönde canlı otobüs/metro keşfi çalışıp diğer yönde (özellikle
 * otobüs durağı olan projelerde) metro↔otobüs aktarmaları eksik kalıyordu.
 */
async function enrichOriginInBackground(origin) {
  if (origin.kind === "custom" || enrichedOriginIds.has(origin.id)) return;
  enrichedOriginIds.add(origin.id);
  try {
    const discovery = await discoverNearbyTransitBest(origin.coords.lat, origin.coords.lng);
    currentDiscoveryByOriginId[origin.id] = discovery;
    const addedCount = spliceDiscoveredLines(origin.stopId, discovery);
    if (addedCount > 0) {
      invalidateCacheForOrigin(origin.id);
      if (isActiveSelection(origin.id)) {
        renderNearbyLinesPanel(origin.id);
        runSearch();
      }
    } else if (isActiveSelection(origin.id)) {
      renderNearbyLinesPanel(origin.id);
    }
  } catch {
    // canlı sorgu başarısız oldu: sonsuz "taranıyor" durumunda kalmasın diye
    // boş sonuç olarak işaretle, statik veriyle sessizce devam et.
    currentDiscoveryByOriginId[origin.id] = { stops: [], lines: [], nearestStopName: null };
    if (isActiveSelection(origin.id)) {
      renderNearbyLinesPanel(origin.id);
    }
  }
}

// Her yeni sonuç render'ında panel varsayılan olarak daraltılmış (özet
// satır) başlar; kullanıcı isterse tıklayıp genişletir. Sonuç listesinin
// (En Uygun Projeler) daha az kaydırmayla görünmesi için bilerek küçük tutulur.
function renderNearbyLinesPanel(originId) {
  const discovery = currentDiscoveryByOriginId[originId];
  nearbyLinesList.classList.add("hidden");
  nearbyLinesChevron.textContent = "▾ göster";

  if (!discovery) {
    if (enrichedOriginIds.has(originId)) {
      nearbyLinesSummary.textContent = "Yakındaki gerçek hatlar taranıyor…";
      nearbyLinesList.innerHTML = "";
      nearbyLinesPanel.classList.remove("hidden");
    } else {
      nearbyLinesPanel.classList.add("hidden");
    }
    return;
  }

  if (!discovery.lines.length) {
    nearbyLinesPanel.classList.add("hidden");
    return;
  }

  const usableCount = discovery.lines.filter((l) => l.hubStopId).length;
  nearbyLinesSummary.textContent = `Bu Bölgeden Geçen Gerçek Hatlar (${discovery.lines.length}, ${usableCount} kullanılabilir)`;

  nearbyLinesList.innerHTML = discovery.lines
    .map((l) => {
      const label = formatLineLabel(l.ref, l.name);
      const used = l.hubStopId
        ? `<span class="nearby-line-used">rotada kullanılabilir</span>`
        : `<span class="nearby-line-unused">bağlantı noktası belirlenemedi</span>`;
      return `<div class="nearby-line-row"><span>${MODE_ICON[l.mode] || "🚌"} ${escapeHtml(label)}</span>${used}</div>`;
    })
    .join("");
  nearbyLinesPanel.classList.remove("hidden");
}

function clearResults() {
  resultsList.innerHTML = "";
  routesLayer.clearLayers();
  routeDetail.classList.add("hidden");
  emptyState.classList.remove("hidden");
  resultsHeading.textContent = "";
  nearbyLinesPanel.classList.add("hidden");
  resetDistrictMarkers();
}

const districtMarkersById = {};
function resetDistrictMarkers() {
  Object.values(districtMarkersById).forEach((m) => markersLayer.removeLayer(m));
  for (const k in districtMarkersById) delete districtMarkersById[k];
}

function runSearch() {
  if (currentMode === "origin-to-project") {
    if (!originSelect.value) return clearResults();
    renderOriginToProject(originSelect.value);
  } else if (currentMode === "project-to-candidates") {
    // candidates.js içinde tanımlanır — Excel'den yüklenen gerçek adayları
    // seçilen projeye göre sıralayan ayrı bir mod.
    if (!projectSelect.value) return clearResults();
    renderProjectToCandidates(projectSelect.value);
  } else {
    if (!projectSelect.value) return clearResults();
    renderProjectToOrigin(projectSelect.value);
  }
}

function renderOriginToProject(originId) {
  const rows = rankProjectsForOrigin(originId, currentThreshold);
  routesLayer.clearLayers();
  resetDistrictMarkers();
  emptyState.classList.toggle("hidden", rows.length > 0);

  const origin = originById(originId);
  resultsHeading.textContent = `${origin.name} → En Uygun Projeler (${rows.length})`;
  // Önce genel bir görünüme geç — aşağıdaki forEach içinde idx===0 için
  // çağrılan drawRoute() kendi fitBounds()'unu bunun ÜZERİNE uygulayıp asıl
  // (en üstteki) rotayı sıkı şekilde kadrajlayacak. Bu çağrı SONRADAN
  // yapılırsa drawRoute'un fitBounds'unu geçersiz kılıp rota çizgisini geniş
  // görünümde fark edilmez kadar küçük bırakır.
  map.setView([origin.coords.lat, origin.coords.lng], 11, { animate: true, duration: 0.8 });

  enrichOriginInBackground(origin);
  renderNearbyLinesPanel(originId);

  resultsList.innerHTML = "";
  rows.forEach((row, idx) => {
    const bucket = durationBucket(row.durationMin);
    resultsList.appendChild(
      buildResultCard({
        title: row.project.name,
        subtitle: `${row.project.sector} · ${row.project.address}`,
        durationMin: row.durationMin,
        transfers: row.transfers,
        bucket,
        terms: {
          salary: row.project.salary,
          meal: row.project.meal,
          transport: row.project.transport,
          shift: row.project.shift,
          gender: row.project.gender,
        },
        urgent: URGENT_PROJECT_IDS.has(row.project.id),
        referral: row.project.referral,
        onClick: () => {
          drawRoute(origin.coords, row, bucket);
          showRouteResult(row);
        },
        highlight: idx === 0,
      })
    );
    if (idx === 0) {
      drawRoute(origin.coords, row, bucket);
      showRouteResult(row);
    }
  });

  if (rows.length === 0) {
    routeDetail.classList.add("hidden");
  }
}

function renderProjectToOrigin(projectId) {
  const rows = rankDistrictsForProject(projectId, currentThreshold);
  routesLayer.clearLayers();
  resetDistrictMarkers();
  emptyState.classList.toggle("hidden", rows.length > 0);

  const project = projectById(projectId);
  resultsHeading.textContent = `${project.name} → En Uygun İlçeler (${rows.length})`;
  // bkz. renderOriginToProject'teki not — drawRoute'un fitBounds'undan ÖNCE gelmeli.
  map.setView([project.coords.lat, project.coords.lng], 11, { animate: true, duration: 0.8 });

  enrichOriginInBackground(project);
  renderNearbyLinesPanel(projectId);

  resultsList.innerHTML = "";
  rows.forEach((row, idx) => {
    const bucket = durationBucket(row.durationMin);
    const districtCoords = { lat: row.district.lat, lng: row.district.lng };

    const marker = L.marker([districtCoords.lat, districtCoords.lng], {
      icon: districtIcon(bucket.color),
    }).addTo(markersLayer);
    marker.bindTooltip(`${row.district.name} · ~${row.durationMin} dk`, { direction: "top" });
    districtMarkersById[row.district.id] = marker;

    resultsList.appendChild(
      buildResultCard({
        title: row.district.name,
        subtitle: `İlçe merkezi`,
        durationMin: row.durationMin,
        transfers: row.transfers,
        bucket,
        onClick: () => {
          drawRoute(districtCoords, { ...row, project: project }, bucket, project.coords);
          showRouteResult(row);
        },
        highlight: idx === 0,
      })
    );
    if (idx === 0) {
      drawRoute(districtCoords, { ...row, project: project }, bucket, project.coords);
      showRouteResult(row);
    }
  });

  if (rows.length === 0) {
    routeDetail.classList.add("hidden");
  }
}

function buildResultCard({ title, subtitle, durationMin, transfers, bucket, onClick, highlight, terms, urgent, referral }) {
  const card = document.createElement("button");
  card.className = `result-card ${highlight ? "result-card-active" : ""} ${urgent ? "result-card-urgent" : ""}`;
  const referralRow = referral ? `<div class="result-card-referral">📌 ${escapeHtml(referral)}</div>` : "";
  const servisNote = terms && terms.transport === "Servis"
    ? `<div class="result-card-servis-note">🚐 Bu projede firma servisi var — yukarıdaki süre/aktarma toplu taşıma senaryosuna göredir, gerçek servis güzergahı sisteme kayıtlı değil.</div>`
    : "";
  const genderSpan = terms && terms.gender ? `<span>👤 ${escapeHtml(terms.gender)}</span>` : "";
  const termsRow = terms
    ? `<div class="result-card-terms">
        <span>💰 ${escapeHtml(terms.salary)}</span>
        <span>🍽️ ${escapeHtml(terms.meal)}</span>
        <span>🚌 ${escapeHtml(terms.transport)}</span>
        <span>⏰ ${escapeHtml(terms.shift)}</span>
        ${genderSpan}
      </div>`
    : "";
  const urgentBadge = urgent ? `<span class="result-card-urgent-badge">ACİL</span>` : "";
  card.innerHTML = `
    ${urgentBadge}
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="font-semibold text-slate-800 truncate">${escapeHtml(title)}</div>
        <div class="text-xs text-slate-500 truncate">${escapeHtml(subtitle)}</div>
      </div>
      <div class="flex flex-col items-end shrink-0">
        <span class="duration-badge" style="background:${bucket.color}1a; color:${bucket.color}">~${durationMin} dk</span>
        <span class="text-[11px] text-slate-400 mt-1">${transfers} aktarma</span>
      </div>
    </div>
    ${referralRow}
    ${termsRow}
    ${servisNote}
  `;
  card.addEventListener("click", () => {
    document.querySelectorAll(".result-card").forEach((c) => c.classList.remove("result-card-active"));
    card.classList.add("result-card-active");
    onClick();
  });
  return card;
}

function sqDist(lat1, lng1, lat2, lng2) {
  const dLat = lat1 - lat2;
  const dLng = lng1 - lng2;
  return dLat * dLat + dLng * dLng;
}

function nearestPointIndex(geometry, point) {
  let best = 0;
  let bestDist = Infinity;
  geometry.forEach(([lat, lng], i) => {
    const d = sqDist(lat, lng, point.lat, point.lng);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** İki hat geometrisinin birbirine en çok yaklaştığı noktayı bulur (gerçek aktarma noktasının yaklaşık konumu). */
function nearestPairBetweenGeometries(geomA, geomB) {
  let best = null;
  let bestDist = Infinity;
  geomA.forEach(([latA, lngA]) => {
    geomB.forEach(([latB, lngB]) => {
      const d = sqDist(latA, lngA, latB, lngB);
      if (d < bestDist) {
        bestDist = d;
        best = { lat: latA, lng: lngA };
      }
    });
  });
  return best;
}

function interpolateCoords(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

// Gerçek hat geometrisinin bir ucu, o bacağın gerçek başlangıç/bitiş noktasından
// (aktarma durağı ya da projenin/adayın kendi konumu) bu kadar uzaksa, aradaki
// boşluk ayrı ince kesikli bir "son adım" çizgisiyle tamamlanır — aksi halde ya
// çizgi havada asılı kalıyor ya da (eski davranışta) hiçbir yolu takip etmeyen
// dümdüz bir çizgi gerçek rota gibi katı çizilip yanıltıyordu.
const REAL_GEOMETRY_CONNECT_LIMIT_KM = 0.15;

/**
 * Rotayı, mümkün olduğunca hatların OSM'den alınan gerçek geometrisini
 * (yol/ray şeklini) takip ederek çizer. Her bacak kendi rengiyle/gerçek
 * güzergahıyla ayrı bir segment olarak çizilir; gerçek geometrisi olmayan
 * (canlı keşfedilmiş ya da TAHMİNİ) hatlar için düz kesikli çizgiye döner.
 */
function drawRoute(originCoords, row, bucket, destCoordsOverride) {
  routesLayer.clearLayers();
  const destCoords = destCoordsOverride || { lat: row.project.lat, lng: row.project.lng };
  const steps = row.steps || [];
  if (steps.length === 0) return;

  const lineOfStep = (s) => (s.lineId ? linesById[s.lineId] : null);
  // Graf motorunun ürettiği adımlardaki otobüs lineId'leri linesById'de değil
  // (transit_network.json'ın kendi id'leri, ör. "iett_line_1") — bu yüzden
  // geometri için ayrıca transitGraph + localTransitGeometry'e de bakılır.
  const geometryOfStep = (s) => {
    const line = lineOfStep(s);
    if (line && line.geometry && line.geometry.length > 1) return line.geometry;
    if (s.lineId && transitGraph && transitGraph.linesByLocalId.has(s.lineId)) {
      const graphLine = transitGraph.linesByLocalId.get(s.lineId);
      if (graphLine.geometry && graphLine.geometry.length > 1) return graphLine.geometry;
      if (localTransitGeometry) {
        const geo = localTransitGeometry[s.lineId];
        if (geo && geo.length > 1) return geo;
      }
    }
    return null;
  };

  // Her bacağın başlangıç/bitiş "çapa" koordinatını belirle: ardışık iki
  // hattın geometrisi varsa, gerçek aktarma noktası bu iki hattın birbirine
  // en yakın olduğu nokta olarak hesaplanır.
  const anchors = [originCoords];
  for (let i = 0; i < steps.length - 1; i++) {
    const gA = geometryOfStep(steps[i]);
    const gB = geometryOfStep(steps[i + 1]);
    if (gA && gB) {
      anchors.push(nearestPairBetweenGeometries(gA, gB));
    } else {
      anchors.push(interpolateCoords(originCoords, destCoords, (i + 1) / steps.length));
    }
  }
  anchors.push(destCoords);

  const allPoints = [];
  steps.forEach((step, i) => {
    const startA = anchors[i];
    const endA = anchors[i + 1];
    const geometry = geometryOfStep(step);
    const modeColor = MODE_LINE_COLOR[step.mode] || bucket.color;
    const tooltipText = `${MODE_ICON[step.mode] || ""} ${escapeHtml(step.line)}`;

    const drawSegment = (latlngs, dashed) => {
      const poly = L.polyline(latlngs, {
        color: modeColor,
        weight: dashed ? 3 : 5,
        opacity: dashed ? 0.6 : 0.9,
        dashArray: dashed ? "2 8" : null,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(routesLayer);
      poly.bindTooltip(tooltipText, { sticky: true });
      allPoints.push(...latlngs);
    };

    if (geometry) {
      const i1 = nearestPointIndex(geometry, startA);
      const i2 = nearestPointIndex(geometry, endA);
      const lo = Math.min(i1, i2);
      const hi = Math.max(i1, i2);
      const seg = geometry.slice(lo, hi + 1).map(([lat, lng]) => [lat, lng]);

      if (seg.length > 1) {
        const segStart = { lat: seg[0][0], lng: seg[0][1] };
        const segEnd = { lat: seg[seg.length - 1][0], lng: seg[seg.length - 1][1] };
        const startIsNearSegStart = haversineKm(startA, segStart) <= haversineKm(startA, segEnd);
        const nearStart = startIsNearSegStart ? segStart : segEnd;
        const nearEnd = startIsNearSegStart ? segEnd : segStart;

        // Gerçek güzergah her zaman katı çizgiyle çizilir.
        drawSegment(seg, false);
        // Gerçek hat, bacağın asıl uçlarına (durak/proje konumu) tam ulaşmıyorsa
        // aradaki fark ince kesikli bir "son adım" çizgisiyle tamamlanır.
        if (haversineKm(startA, nearStart) > REAL_GEOMETRY_CONNECT_LIMIT_KM) {
          drawSegment([[startA.lat, startA.lng], [nearStart.lat, nearStart.lng]], true);
        }
        if (haversineKm(endA, nearEnd) > REAL_GEOMETRY_CONNECT_LIMIT_KM) {
          drawSegment([[nearEnd.lat, nearEnd.lng], [endA.lat, endA.lng]], true);
        }
      } else {
        // Gerçek geometri bu bacak için kullanılamadı (uçlar hattın tamamen
        // aynı noktasına denk düştü) — dürüstçe kesikli/tahmini göster.
        drawSegment([[startA.lat, startA.lng], [endA.lat, endA.lng]], true);
      }
    } else {
      drawSegment([[startA.lat, startA.lng], [endA.lat, endA.lng]], true);
    }
  });

  if (allPoints.length) {
    map.fitBounds(L.latLngBounds(allPoints), { padding: [70, 70], animate: true, duration: 0.8 });
  }
}

// showRouteResult'a en son verilen estimate — "En Hızlı"/"En Az Aktarmalı"
// varyant butonları yeniden arama yapmadan sadece bunun arasında geçiş yapar.
let currentRouteEstimate = null;

/** routeDetailTitle/Steps/Warning'i estimate'in kendisiyle (En Hızlı) ya da minTransfersAlternative'ıyla (En Az Aktarmalı) doldurur. */
function renderRouteVariant(estimate, useMinTransfers) {
  const variant = useMinTransfers ? estimate.minTransfersAlternative : estimate;
  const extra = useMinTransfers && variant.extraMin ? ` (+${variant.extraMin} dk)` : "";
  routeDetailTitle.innerHTML = `Rota Detayı · ${variant.transfers} aktarma · ~${variant.durationMin} dk${extra}`;
  routeDetailSteps.innerHTML = renderRouteSteps(variant.steps);
  routeDetailWarning.classList.toggle("hidden", variant.verified);
  routeVariantFastestBtn.classList.toggle("mode-btn-active", !useMinTransfers);
  routeVariantFewestBtn.classList.toggle("mode-btn-active", useMinTransfers);
}

routeVariantFastestBtn.addEventListener("click", () => {
  if (currentRouteEstimate) renderRouteVariant(currentRouteEstimate, false);
});
routeVariantFewestBtn.addEventListener("click", () => {
  if (currentRouteEstimate) renderRouteVariant(currentRouteEstimate, true);
});

function showRouteResult(estimate) {
  currentRouteEstimate = estimate;
  // "En Az Aktarmalı" butonu SADECE gerçekten farklı (daha az aktarmalı) bir
  // seçenek varsa gösterilir — yoksa iki sekme de aynı rotayı gösterirdi.
  routeDetailVariantToggle.classList.toggle("hidden", !estimate.minTransfersAlternative);
  renderRouteVariant(estimate, false);
  routeDetail.classList.remove("hidden");
  // Sonuç listesi uzun olduğunda rota detayı listenin ÜSTÜNDE render edildiği
  // için görünmüyordu — panel her gösterildiğinde görünür alana kaydırılır.
  routeDetail.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// 7) HAFTALIK ACİL PROJELER PENCERESİ
// ---------------------------------------------------------------------------

const urgentBtn = document.getElementById("urgentBtn");
const urgentModal = document.getElementById("urgentModal");
const urgentModalList = document.getElementById("urgentModalList");
const urgentModalClose = document.getElementById("urgentModalClose");
const urgentModalCancel = document.getElementById("urgentModalCancel");
const urgentModalSave = document.getElementById("urgentModalSave");

// Modal açıldığı andaki urgent durumunun anlık görüntüsü. Kaydet'e basılınca
// checkbox'lar bu görüntüyle kıyaslanır — canlı ISTANBUL_DATA.projects ile DEĞİL,
// çünkü modal açıkken arka planda gelen bir Sheet yenilemesi projects dizisini
// değiştirebilir; o an canlı veriyle kıyaslamak, kullanıcının hiç dokunmadığı
// projeleri de "değişti" sayıp yanlışlıkla geri yazmaya (veri bozulmasına) yol açıyordu.
let urgentModalBaseline = new Map();

function renderUrgentModalList() {
  const sorted = activeProjects().sort((a, b) => a.name.localeCompare(b.name, "tr"));
  urgentModalBaseline = new Map(sorted.map((p) => [p.id, Boolean(p.urgent)]));
  urgentModalList.innerHTML = sorted
    .map(
      (p) => `
      <label class="urgent-modal-row">
        <input type="checkbox" value="${p.id}" ${URGENT_PROJECT_IDS.has(p.id) ? "checked" : ""} />
        <span>${escapeHtml(p.name)} <span class="text-slate-400">— ${escapeHtml(p.address)}</span></span>
      </label>`
    )
    .join("");
}

function openUrgentModal() {
  renderUrgentModalList();
  urgentModal.classList.remove("hidden");
}
function closeUrgentModal() {
  urgentModal.classList.add("hidden");
}

urgentBtn.addEventListener("click", openUrgentModal);
urgentModalClose.addEventListener("click", closeUrgentModal);
urgentModalCancel.addEventListener("click", closeUrgentModal);
urgentModal.addEventListener("click", (e) => {
  if (e.target === urgentModal) closeUrgentModal();
});

urgentModalSave.addEventListener("click", async () => {
  const checked = new Set(
    Array.from(urgentModalList.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value)
  );
  const changed = activeProjects().filter((p) => (urgentModalBaseline.get(p.id) ?? Boolean(p.urgent)) !== checked.has(p.id));
  if (changed.length === 0) {
    closeUrgentModal();
    return;
  }
  // Çok sayıda proje aynı anda değişiyorsa (ör. yanlışlıkla toplu işaret
  // kaldırma) onay iste — bir yarış/kaza sonucu 30+ projenin durumunun
  // yanlışlıkla değişmesini daha önce yaşadık.
  if (changed.length > 5 && !confirm(`${changed.length} projenin acil durumu değişecek. Emin misin?`)) {
    return;
  }
  urgentModalSave.disabled = true;
  urgentModalSave.textContent = "Kaydediliyor…";
  try {
    const { updatedIds, notFound } = await postBatchUpdate(
      changed.map((p) => ({ id: p.id, patch: { urgent: checked.has(p.id) } }))
    );
    changed.forEach((p) => {
      if (updatedIds.has(p.id)) p.urgent = checked.has(p.id);
    });
    recomputeUrgentInactiveSets();
    refreshProjectMarkers();
    saveProjectsCache();
    if (notFound.length > 0) {
      alert(`${updatedIds.size}/${changed.length} kaydedildi. ${notFound.length} proje bulunamadı.`);
      renderUrgentModalList();
    } else {
      closeUrgentModal();
      runSearch();
    }
  } catch (err) {
    alert("Kaydedilemedi — internet bağlantısını kontrol edip tekrar dene.");
  } finally {
    urgentModalSave.disabled = false;
    urgentModalSave.textContent = "Kaydet";
  }
});

// ---------------------------------------------------------------------------
// 8) HAFTALIK PROJE AÇ/KAPA PENCERESİ
// ---------------------------------------------------------------------------

const inactiveBtn = document.getElementById("inactiveBtn");
const inactiveModal = document.getElementById("inactiveModal");
const inactiveModalList = document.getElementById("inactiveModalList");
const inactiveModalClose = document.getElementById("inactiveModalClose");
const inactiveModalCancel = document.getElementById("inactiveModalCancel");
const inactiveModalSave = document.getElementById("inactiveModalSave");

// Burada — acil pencerenin aksine — TÜM projeler (kapalı olanlar dahil)
// listelenir, aksi halde kapatılmış bir projeyi geri açmanın yolu olmazdı.
// Aynı anlık-görüntü mantığı burada da geçerli — bkz. urgentModalBaseline.
let inactiveModalBaseline = new Map();

function renderInactiveModalList() {
  const sorted = [...ISTANBUL_DATA.projects].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  inactiveModalBaseline = new Map(sorted.map((p) => [p.id, Boolean(p.active)]));
  inactiveModalList.innerHTML = sorted
    .map(
      (p) => `
      <label class="urgent-modal-row">
        <input type="checkbox" value="${p.id}" ${!INACTIVE_PROJECT_IDS.has(p.id) ? "checked" : ""} />
        <span>${escapeHtml(p.name)} <span class="text-slate-400">— ${escapeHtml(p.address)}</span></span>
      </label>`
    )
    .join("");
}

function openInactiveModal() {
  renderInactiveModalList();
  inactiveModal.classList.remove("hidden");
}
function closeInactiveModal() {
  inactiveModal.classList.add("hidden");
}

inactiveBtn.addEventListener("click", openInactiveModal);
inactiveModalClose.addEventListener("click", closeInactiveModal);
inactiveModalCancel.addEventListener("click", closeInactiveModal);
inactiveModal.addEventListener("click", (e) => {
  if (e.target === inactiveModal) closeInactiveModal();
});

inactiveModalSave.addEventListener("click", async () => {
  // Kutucuk işaretliyse AKTİF demektir; işaretsiz olanlar pasif listesine girer.
  const activeIds = new Set(
    Array.from(inactiveModalList.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value)
  );
  const changed = ISTANBUL_DATA.projects.filter((p) => (inactiveModalBaseline.get(p.id) ?? Boolean(p.active)) !== activeIds.has(p.id));
  if (changed.length === 0) {
    closeInactiveModal();
    return;
  }
  // Çok sayıda proje aynı anda değişiyorsa (ör. yanlışlıkla toplu işaret
  // kaldırma) onay iste — bir yarış/kaza sonucu 30+ projenin durumunun
  // yanlışlıkla değişmesini daha önce yaşadık.
  if (changed.length > 5 && !confirm(`${changed.length} projenin aktiflik durumu değişecek. Emin misin?`)) {
    return;
  }
  inactiveModalSave.disabled = true;
  inactiveModalSave.textContent = "Kaydediliyor…";
  try {
    const { updatedIds, notFound } = await postBatchUpdate(
      changed.map((p) => ({ id: p.id, patch: { active: activeIds.has(p.id) } }))
    );
    changed.forEach((p) => {
      if (updatedIds.has(p.id)) p.active = activeIds.has(p.id);
    });
    recomputeUrgentInactiveSets();
    refreshProjectMarkers();
    rebuildProjectSelect();
    saveProjectsCache();
    if (notFound.length > 0) {
      alert(`${updatedIds.size}/${changed.length} kaydedildi. ${notFound.length} proje bulunamadı.`);
      renderInactiveModalList();
    } else {
      closeInactiveModal();
      runSearch();
    }
  } catch (err) {
    alert("Kaydedilemedi — internet bağlantısını kontrol edip tekrar dene.");
  } finally {
    inactiveModalSave.disabled = false;
    inactiveModalSave.textContent = "Kaydet";
  }
});

// ---------------------------------------------------------------------------
// 9) SHEET'TEN CANLI PROJE LİSTESİ ÇEKME
// ---------------------------------------------------------------------------

// Proje listesini tamamen yeni bir kaynakla (Sheet'ten gelen veya yeni bir
// proje eklendikten sonraki hal) değiştirir: ISTANBUL_DATA.projects'i günceller,
// türetilmiş setleri/harita pinlerini/dropdown'ı yeniden kurar ve artık
// güncelliğini yitirmiş olabilecek rota tahminlerini (TransitCache) temizler.
function applyLiveProjects(projects) {
  ISTANBUL_DATA.projects.length = 0;
  projects.forEach((p) => ISTANBUL_DATA.projects.push(p));
  stopApproxCoordsCache = null;
  recomputeUrgentInactiveSets();
  rebuildAllProjectMarkers();
  rebuildProjectSelect();
  TransitCache.clearAll();
  if (currentMode === "origin-to-project" && originSelect.value) {
    runSearch();
  } else if (
    (currentMode === "project-to-origin" || currentMode === "project-to-candidates") &&
    projectSelect.value &&
    !activeProjects().some((p) => p.id === projectSelect.value)
  ) {
    clearResults();
  } else {
    runSearch();
  }
}

async function loadLiveProjects() {
  if (!SHEET_API_URL) return;
  try {
    const cached = JSON.parse(localStorage.getItem(SHEET_CACHE_KEY) || "null");
    if (Array.isArray(cached) && cached.length) {
      applyLiveProjects(cached);
    }
  } catch {
    // önbellek okunamadı, statik veriyle devam
  }
  try {
    const res = await fetch(SHEET_API_URL);
    const data = await res.json();
    if (data.ok && Array.isArray(data.projects) && data.projects.length) {
      applyLiveProjects(data.projects);
      saveProjectsCache();
    }
  } catch {
    // Sheet'e ulaşılamadı (internet yok, henüz kurulmadı vb.) — statik/önbellek veriyle sessizce devam
  }
}

// ---------------------------------------------------------------------------
// 10) PROJE EKLE PENCERESİ
// ---------------------------------------------------------------------------

const addProjectBtn = document.getElementById("addProjectBtn");
const addProjectModal = document.getElementById("addProjectModal");
const addProjectForm = document.getElementById("addProjectForm");
const addProjectClose = document.getElementById("addProjectClose");
const addProjectCancel = document.getElementById("addProjectCancel");
const addProjectSubmit = document.getElementById("addProjectSubmit");
const addProjectStatus = document.getElementById("addProjectStatus");

function openAddProjectModal() {
  addProjectForm.reset();
  addProjectStatus.textContent = "";
  addProjectModal.classList.remove("hidden");
}
function closeAddProjectModal() {
  addProjectModal.classList.add("hidden");
}

addProjectBtn.addEventListener("click", openAddProjectModal);
addProjectClose.addEventListener("click", closeAddProjectModal);
addProjectCancel.addEventListener("click", closeAddProjectModal);
addProjectModal.addEventListener("click", (e) => {
  if (e.target === addProjectModal) closeAddProjectModal();
});

addProjectForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(addProjectForm);
  const name = fd.get("name").trim();
  const addressText = fd.get("address").trim();
  if (!name || !addressText) return;

  addProjectSubmit.disabled = true;
  addProjectStatus.textContent = "Konum bulunuyor…";
  try {
    const geo = await geocodeAddress(addressText);
    if (!geo) {
      addProjectStatus.textContent = "Konum bulunamadı. Adresi biraz daha netleştirip tekrar dene (ör. \"Bilkent, Çankaya\").";
      return;
    }
    const stop = nearestTransitStop(geo.lat, geo.lng);
    addProjectStatus.textContent = "Kaydediliyor…";

    const project = {
      name,
      sector: fd.get("sector"),
      position: fd.get("position"),
      address: addressText,
      lat: geo.lat,
      lng: geo.lng,
      accessStopId: stop ? stop.id : "",
      shift: fd.get("shift").trim(),
      salary: fd.get("salary").trim(),
      meal: fd.get("meal").trim(),
      transport: fd.get("transport").trim(),
      referral: fd.get("referral").trim(),
      gender: fd.get("gender"),
      capacity: fd.get("capacity").trim(),
      urgent: false,
      active: true,
    };

    const result = await postToSheet({ action: "add", project });
    project.id = result.id;
    ISTANBUL_DATA.projects.push(project);
    stopApproxCoordsCache = null;
    recomputeUrgentInactiveSets();
    buildProjectMarker(project);
    rebuildProjectSelect();
    saveProjectsCache();
    closeAddProjectModal();
    if (currentMode === "origin-to-project" && originSelect.value) runSearch();
  } catch (err) {
    addProjectStatus.textContent = "Kaydedilemedi — internet bağlantısını kontrol edip tekrar dene.";
  } finally {
    addProjectSubmit.disabled = false;
  }
});

// İlk yükleme
clearResults();
loadLiveProjects();
