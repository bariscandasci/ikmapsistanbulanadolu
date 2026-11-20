/**
 * Ulaşım & Proje Eşleştirme Modülü — uygulama mantığı.
 * Classic script (module değil) — file:// üzerinden de çalışsın diye.
 * ANKARA_DATA global değişkeni data.js tarafından tanımlanır.
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
const SHEET_API_URL = "https://script.google.com/macros/s/AKfycbxprctzoQPNbHz1kA3g4qQciSZ9hqIGtN_BC_q0YzSEvOmUGYxW9PKWTTpA7z6SoPw/exec";
const SHEET_CACHE_KEY = "ik_ulasim_sheet_cache_v1";

// Sheet'e başarılı bir yazmadan hemen sonra yerel önbelleği de günceller.
// Bunu atlarsak, kullanıcı bir projeyi aç/kapat edip kaydettikten sonra
// sayfayı yenilediğinde, sayfa açılışında ÖNCE eski önbellek anında
// gösterildiği için (canlı Sheet verisi arka planda gelene kadar) değişiklik
// "sıfırlanmış" gibi görünüyordu.
function saveProjectsCache() {
  try {
    localStorage.setItem(SHEET_CACHE_KEY, JSON.stringify(ANKARA_DATA.projects));
  } catch {
    /* localStorage kullanılamıyorsa sessizce yoksay */
  }
}

// data.js'teki statik projelerde henüz urgent/active alanı yok — bunları
// eski (ANKARA_DATA.urgentProjectIds / referral==="Aktif değil") mantığından
// türeterek her projeye ekliyoruz; Sheet'ten canlı veri geldiğinde bu
// alanların üzerine (Sheet'teki gerçek değerlerle) yazılır.
(function seedStaticActiveUrgentFields() {
  const staticUrgentIds = new Set(ANKARA_DATA.urgentProjectIds || []);
  ANKARA_DATA.projects.forEach((p) => {
    if (p.urgent === undefined) p.urgent = staticUrgentIds.has(p.id);
    if (p.active === undefined) p.active = p.referral !== "Aktif değil";
  });
})();

// URGENT_PROJECT_IDS / INACTIVE_PROJECT_IDS artık projelerin kendi
// urgent/active alanlarından TÜRETİLİR (Sheet = tek doğruluk kaynağı).
// Modallardan kaydedince önce Sheet'e yazılır, sonra bu setler yenilenir.
let URGENT_PROJECT_IDS = new Set();
let INACTIVE_PROJECT_IDS = new Set();
/** Supabase'den gelen kayıtlarda active/urgent hiç yoksa proje açık kabul edilir. */
function normalizeProjectRecord(project) {
  const flag = (value, whenMissing) => {
    if (value === undefined || value === null || value === "") return whenMissing;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      return text === "true" || text === "1" || text === "evet";
    }
    return Boolean(value);
  };
  project.active = flag(project.active, project.referral !== "Aktif değil");
  project.urgent = flag(project.urgent, false);
  if (project.lat != null) project.lat = Number(project.lat);
  if (project.lng != null) project.lng = Number(project.lng);
  if (!project.ageRange && project.ageMin != null && project.ageMin !== "" && project.ageMax != null && project.ageMax !== "") {
    const min = Number(project.ageMin);
    const max = Number(project.ageMax);
    if (Number.isFinite(min) && Number.isFinite(max)) project.ageRange = { min, max };
  }
  return project;
}

function recomputeUrgentInactiveSets() {
  URGENT_PROJECT_IDS = new Set(ANKARA_DATA.projects.filter((p) => p.urgent).map((p) => p.id));
  INACTIVE_PROJECT_IDS = new Set(ANKARA_DATA.projects.filter((p) => !p.active).map((p) => p.id));
}
recomputeUrgentInactiveSets();

function activeProjects() {
  return ANKARA_DATA.projects.filter((p) => !INACTIVE_PROJECT_IDS.has(p.id));
}

// Apps Script'e yazma isteği gönderir. Content-Type kasıtlı olarak
// "text/plain" — Apps Script Web App'leri tarayıcının CORS ön-kontrol
// (preflight OPTIONS) isteğini desteklemiyor; "application/json" kullanmak
// tarayıcının otomatik preflight göndermesine ve isteğin başarısız olmasına
// yol açardı. Gövde yine de geçerli JSON metni olarak gönderilir.
async function postToSheet(body) {
  if (window.usingSupabaseTenant && window.TenantStore && typeof TenantStore.write === "function") {
    return TenantStore.write(body);
  }
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
  ANKARA_DATA.transitStops.forEach((s) => {
    if (s.lat != null && s.lng != null) add(s.id, s.lat, s.lng);
  });
  ANKARA_DATA.districts.forEach((d) => {
    add(d.accessStopId, d.lat, d.lng);
    (d.neighborhoods || []).forEach((n) => add(n.accessStopId, n.lat, n.lng));
  });
  ANKARA_DATA.projects.forEach((p) => add(p.accessStopId, p.lat, p.lng));
  stopApproxCoordsCache = map;
  return map;
}

/** Basit haversine ile en yakın gerçek durağı bulur — yeni eklenen bir proje için otomatik durak ataması. */
function nearestTransitStop(lat, lng) {
  const coords = stopApproxCoords();
  let best = null;
  let bestDist = Infinity;
  ANKARA_DATA.transitStops.forEach((s) => {
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

let stopsById = {};
let linesByStopId = {}; // stopId -> [lineId, ...]
let linesById = {};
let HUBS = new Set();

function rebuildTransitIndexes() {
  stopApproxCoordsCache = null;
  stopsById = Object.fromEntries((ANKARA_DATA.transitStops || []).map((s) => [s.id, s]));
  linesByStopId = {};
  (ANKARA_DATA.transitLines || []).forEach((line) => {
    (line.stopIds || []).forEach((stopId) => {
      (linesByStopId[stopId] = linesByStopId[stopId] || []).push(line.id);
    });
  });
  linesById = Object.fromEntries((ANKARA_DATA.transitLines || []).map((l) => [l.id, l]));
  HUBS = new Set(ANKARA_DATA.hubStopIds || []);
}
rebuildTransitIndexes();

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

/** [lat,lng] noktalarından oluşan bir çizginin toplam uzunluğu (km) — drawRoute'ta bacak etiketleri için. */
function polylineKm(latlngs) {
  let km = 0;
  for (let i = 1; i < latlngs.length; i++) {
    km += haversineKm({ lat: latlngs[i - 1][0], lng: latlngs[i - 1][1] }, { lat: latlngs[i][0], lng: latlngs[i][1] });
  }
  return km;
}

function roundTo5(n) {
  return Math.round(n / 5) * 5;
}

// ---------------------------------------------------------------------------
// 2) GERÇEK GRAF TABANLI ROTA MOTORU
// ---------------------------------------------------------------------------
//
// transit_network.json'daki 668 gerçek EGO hattı / 10.940 gerçek durak
// üzerinde kurulan bir graf + çok-kaynaklı Dijkstra ile çalışır. Bir hat
// (ör. birleşmiş M1-M2-M3) tek bir gerçek hat_id taşıdığı için, aynı hat
// üzerindeki iki durak arasında ARTIK asla sahte bir "aktarma" üretilmiyor
// — eskiden data.js'teki elle seçilmiş ~10 hat/3 hub'lık özet ağ ve isim
// eşleştirmesine dayanan resolveTransfer() böyle bir hata üretebiliyordu.
// Grafın kendisi loadLocalTransitNetwork() tamamlanınca (aşağıda, §3b)
// kurulur; bu bölüm sadece kurulum ve sorgu fonksiyonlarını tanımlar.

// Otobüs hızı 20→16 km/s: 20, gerçek şehir içi trafik/ışık/duraklama dikkate
// alınınca fazla iyimserdi — uzun otobüs zincirlerini metroya karşı yapay
// şekilde rekabetçi gösteriyordu (bkz. Etlik→Bilkent Center örneği: gerçek
// hattı tam kullanan metro rotası bulunabiliyordu ama toplamda tüm-otobüs
// alternatifiyle neredeyse berabere kalıyordu). Metro/Ankaray hızı, raylı
// sistemin trafikten bağımsız olmasını yansıtacak şekilde hafif yükseltildi.
//
// 2026-09-24: otobüs 16→20 km/s, sefer sıklığı 15→12 dk. Pursaklar→Nazende
// Google'da 93-102 dk iken uygulama 139 dk gösteriyordu (yürüme sadece ~9 dk);
// 16 km/s + durak başına 0.4 dk bekleme, durak duruşlarını fiilen iki kez
// sayıyordu. 20 km/s eskiden Gölbaşı örneğinde Google'la (84 dk) örtüşmüştü;
// metro hızı sonradan 33'e çıkarıldığı için "otobüs metroyla yapay başa baş"
// itirazı artık geçerli değil (Etlik→Bilkent Center hâlâ metro tabanlı, Etlik→
// Medical Park hâlâ 261→480 — doğrulandı). Pursaklar→Nazende 139→120 dk.
const MODE_SPEED_KMH = {
  otobus: 20, metro: 33, ankaray: 33, tren: 45, dolmus: 20,
  tramvay: 18, marmaray: 40, metrobus: 28, funikuler: 15, vapur: 15,
};
// Havalimanı ekspresi (442) ve D140 / Özal Bulvarı üzerindeki uzun etaplar
// şehir içi 20 km/s ile gidilmez — durak arası birkaç kilometre, ışıksız
// arter. 48 km/s, istenen 45-50 bandının ortası. Kısa (2.2 km altı) durak
// aralıkları aynı hatta bile 20 km/s kalır; Kızılay içi sıkışık etap
// hızlanmaz.
const ARTERIAL_BUS_SPEED_KMH = 48;
const ARTERIAL_EDGE_MIN_KM = 2.2;
const WALK_SPEED_KMH = 4.5;
// Yürüme, rota SEÇİLİRKEN 1.5x "ağır" sayılır (gösterilen süre yine gerçek
// yürüme süresidir). Yürüme düz çizgiyle 4.5 km/s hesaplandığı için gerçek
// sokak yürüyüşü aslında biraz daha uzun; ceza olmadan motor birkaç dakika
// kazandırmak için 20+ dk'lık yürüyüşleri seçebiliyordu. 513 ilçe→proje
// çiftinde denendi (2026-09-24): 1.5x → 20 dk üzeri yürüyüş 99→47 çift,
// ortalama süre neredeyse aynı; 2x ve üstü toplam süreyi kötüleştiriyor.
const WALK_PENALTY_FACTOR = 1.5;
// İki bant, ikisi de sadece seçimde. Gösterilen yürüyüş yine 4.5 km/s.
// Kapı bandı (150 m): 2127 Cd., Dubçek, DURU BEYTEPE, Ahmet Refik, Bilkent
// Nazende. Bu durak varken 200 m ötesi, özellikle Bahçe Konutları (247 m) ve
// 124. Sokak (472 m), seçimden düşer.
// Yakın bant (250 m): kapı durağı yoksa Ankara Oto'daki 231 m'lik besleme
// durağını metro sonrası 700 m yürüyüşe tercih ettirir.
const DOOR_ALIGHT_KM = 0.15;
const DOOR_ALIGHT_MIN_PER_KM = 140;
const CLOSE_ALIGHT_KM = 0.25;
const EARLY_ALIGHT_MIN_PER_KM = 45;
// Nazende'ye 178 / 178-3 / 607 üzerinden 111'e binmek 30–48 km'lik İncek
// halkasını seçtiriyordu. Bu aktarma zinciri seçimde cezalı. 607'nin tek
// başına kullanıldığı Gölbaşı–Bilkent koridoru (106-3 → 607) bu çifte girmez.
const INCEK_RING_HATS = new Set(["178", "178-3", "607"]);
const NAZENDE_SPUR_HATS = new Set(["111"]);
const INCEK_CHAIN_PENALTY_MIN = 36;
// Kuzey (lat >= 39.94) ve uzak batı (lng <= 32.70) çıkışları 106-3 ardından
// 607'ye binince İncek'e dolanıyor. Gölbaşı ve Çayyolu bu kutunun dışında;
// orada 106-3 + 607 gerçek koridor olarak kalır.
const NORTH_INCEK_FEED_MIN_LAT = 39.94;
const WEST_INCEK_FEED_MAX_LNG = 32.70;
const NORTH_INCEK_FEED_PENALTY_MIN = 48;
// Rota denetimi: 3+ hatlı yol, kuş uçuşunun 2.5 katını ve kuş uçuşu + 12 km'yi
// birlikte aşıyorsa dolanma sayılır. Ankara'nın batı ve güney yol ağı 2.1–2.4
// kat uzadığı için 1.9 kat eşiği Sincan ve Gölbaşı koridorlarını yanlış işaretliyordu.
const STOP_DWELL_MIN = 0.4;
// Her yeni binişte (ilk biniş ve aktarma) bekleme = o hattın sefer aralığı / 2.
// Aralık önce LINE_HEADWAY_MIN'den, yoksa mod ortalamasından gelir. Aynı hatta
// kalmak bedavadır; araç zaten yolundadır, ikinci kez beklenmez.
const MODE_HEADWAY_MIN = {
  otobus: 12, metro: 6, ankaray: 6, tren: 15, dolmus: 10,
  tramvay: 8, marmaray: 12, metrobus: 3, funikuler: 8, vapur: 20,
};
// Hat bazlı sefer aralığı (dakika). Bekleme her yeni binişte aralığın yarısıdır
// (ilk biniş ve aktarma). Tabloda olmayan hat, mod ortalamasına düşer.
// 442 gündüz yaklaşık 24 dk'da bir kalktığı için yarım aralık 12 dk kalır;
// Pursaklar→Esenboğa böylece ~30 dk bandında durur.
const LINE_HEADWAY_MIN = {
  "442": 24,
};
// Seçim cezası gösterilen süreye girmez. Ek aktarma, en az bu kadar gerçek
// dakika kazandırmıyorsa elenir — çevre yolu / bulvar / metro dururken
// 2-3 gereksiz aktarmalı dolaşma seçilmesin. Gösterilen bekleme bunun dışında,
// hattın kendi sefer aralığının yarısıdır.
const PRIMARY_TRANSFER_PENALTY_MIN = 8;
// Adaydan ilk biniş durağı 750 m, son araç inişi ile proje 800 m. İkinci
// mesafe inilen araç durağından ölçülür; otobüsten inip daha yakın bir
// durağa yürümek bu mesafeyi kısaltmaz.
const ACCESS_BOARD_MAX_KM = 0.75;
const ALIGHT_PROJECT_MAX_KM = 0.8;
// Gündüz aramasında gece hatları seçimden düşsün. Yürüyüş cezası bundan
// küçük kalır. İkisi de gösterilen süreye girmez.
const NIGHT_LINE_PENALTY_MIN = 240;
const LONG_WALK_PENALTY_MIN = 80;
const WALK_LONG_LIMIT_MIN = 15;
const METRO_SELECTION_FACTOR = 0.65;
const BUS_TO_METRO_TRANSFER_MIN = 2;
const BUS_TO_BUS_TRANSFER_MIN = 22;
// Güneybatı çevre yolu / bulvar bağlantıları (İncek, Ahlatlıbel, Konya yolu,
// Eskişehir yolu, Koru-Yargıtay). Şehir içi 20 km/s bu koridorda 8-10 km'lik
// işe gidişi 90 dk yapıyordu. 50 km/s, 45-50 bandının üstü; 3.8 km'den uzun
// kenarlar veri sıçramasıdır, hızlanmaz.
const BOULEVARD_BUS_SPEED_KMH = 50;
const BOULEVARD_DWELL_MIN = 0.15;
const BOULEVARD_EDGE_MAX_KM = 3.8;
const BOULEVARD_LINE_HATS = new Set([
  "106-3", "178", "178-3", "607", "135-2", "196", "584", "584-1",
  "109-1", "109-2", "602-6", "236", "130",
]);
function isAirportExpressLine(line) {
  return line.hatNo === "442" || /HAVAL[İI]MAN/i.test(line.name || "");
}
function isD140CorridorStop(stop) {
  return stop.lat >= 40.03 && stop.lat <= 40.15 && stop.lng >= 32.88 && stop.lng <= 33.02;
}
function isArterialAirportEdge(line, a, b, km) {
  if (line.mode !== "otobus" || km < ARTERIAL_EDGE_MIN_KM) return false;
  if (isAirportExpressLine(line)) return true;
  return isD140CorridorStop(a) && isD140CorridorStop(b);
}
function isBoulevardConnectorLine(line) {
  if (!line || line.mode !== "otobus") return false;
  return BOULEVARD_LINE_HATS.has(line.hatNo);
}
// 220-7 Mamak Devlet Hastanesi önünden (ego_31138) kalkıp Podium'a kadar
// gidiyor. Şehir içi 20 km/s ve durak başı 0.4 dk, 50 duraklık bu ÖHO'yu
// ~87 dk yapıyordu; arama bunun yerine Köstence'den B1'e binip Gazi
// Mahallesi'nde aynı hatta aktarma yapıyordu. 30 km/s ve kısa duraklama
// doğrudan binişi Google'daki ~55 dk bandına indirir. 3 km üstü kenar
// veri sıçramasıdır, hızlanmaz.
const OHO_CORRIDOR_SPEED_KMH = 30;
const OHO_CORRIDOR_DWELL_MIN = 0.15;
const OHO_CORRIDOR_EDGE_MAX_KM = 3;
const OHO_CORRIDOR_HATS = new Set(["220-7"]);
function isOhoCorridorLine(line) {
  if (!line || line.mode !== "otobus") return false;
  return OHO_CORRIDOR_HATS.has(line.hatNo);
}
function isNightServiceLine(line) {
  if (!line) return false;
  const hat = String(line.hatNo || "");
  if (/-7$/.test(hat)) return true;
  return /gece/i.test(line.name || "");
}
function edgeIsNightService(graph, edge) {
  if (!edge || !edge.lineId || !graph) return false;
  const line = graph.linesByLocalId.get(edge.lineId);
  if (line) return isNightServiceLine(line);
  return /-7$/.test(String(edge.hatNo || ""));
}
function modeTransferPenalty(fromMode, toMode) {
  if (!fromMode || !toMode) return 0;
  const fromBus = fromMode === "otobus" || fromMode === "dolmus";
  const toMetro = toMode === "metro" || toMode === "ankaray";
  const toBus = toMode === "otobus" || toMode === "dolmus";
  if (fromBus && toMetro) return BUS_TO_METRO_TRANSFER_MIN;
  if (fromBus && toBus) return BUS_TO_BUS_TRANSFER_MIN;
  return 0;
}
function inceKChainPenalty(prevHat, nextHat, origin) {
  if (!nextHat || !prevHat) return 0;
  const prevRing = INCEK_RING_HATS.has(prevHat);
  const nextRing = INCEK_RING_HATS.has(nextHat);
  const nextSpur = NAZENDE_SPUR_HATS.has(nextHat);
  if ((prevRing && nextRing) || (prevRing && nextSpur)) return INCEK_CHAIN_PENALTY_MIN;
  if (
    origin &&
    prevHat === "106-3" &&
    nextHat === "607" &&
    (origin.lat >= NORTH_INCEK_FEED_MIN_LAT || origin.lng <= WEST_INCEK_FEED_MAX_LNG)
  ) {
    return NORTH_INCEK_FEED_PENALTY_MIN;
  }
  return 0;
}
function lineHeadwayMin(line) {
  if (line && Object.prototype.hasOwnProperty.call(LINE_HEADWAY_MIN, line.hatNo)) {
    return LINE_HEADWAY_MIN[line.hatNo];
  }
  if (line && isAirportExpressLine(line)) return LINE_HEADWAY_MIN["442"];
  const modeHeadway = line && MODE_HEADWAY_MIN[line.mode];
  return modeHeadway !== undefined ? modeHeadway : MODE_HEADWAY_MIN.otobus;
}
function boardingWaitMin(headwayMin) {
  const headway = headwayMin != null ? headwayMin : MODE_HEADWAY_MIN.otobus;
  return headway / 2;
}
// 2026-09-24: ego.gov.tr'den 657 otobüs hattının TAMAMININ gerçek hafta içi
// kalkış saatleri çekilip hat-bazlı ortalama bekleme süresi denendi (bkz.
// scratchpad line_schedules.json/scrape_ego.py, projeye alınmadı). Veri
// doğruydu (ör. 236-2 hattı günde gerçekten 7 kez, 130 hattı 2 dk'da bir
// geçiyor) ama rota SEÇİMİNE sokulunca 13 Google karşılaştırmasında ortalama
// mutlak hata 14.3→21.5 dk'ya çıktı: motor zaten (Etimesgut/533 gibi) yakın
// duraklarının koordinatı UNRELIABLE_COORD_SOURCES yüzünden tahmini olduğu
// için doğru hattı hiç aday olarak göremiyordu; düz 6dk bekleme bu seçim
// hatasını gizliyordu, gerçek bekleme (236-2 için 45dk tavan) onu görünür
// hale getirip süreyi daha da kötüleştirdi. Kök neden hat sıklığı değil,
// aday durak filtresi — bkz. proje notları. Bu yüzden geri alındı; tekrar
// denenecekse önce o filtre düzeltilmeli.
const WALK_TRANSFER_MAX_KM = 0.35; // farklı hatların yakın duraklarını "aktarma" olarak bağlayan yürüme kenarları
// 1.2km/6 aday, Gölbaşı/Mogan Gölü gibi seyrek bölgelerde gerçek en iyi
// hattı kaçırıyordu: Google Maps'in önerdiği daha hızlı hatların bindiği
// durak (MOGAN PARKI) merkeze 1.44km'de — 1.2km sınırının hemen dışında
// kalıp hiç aday olarak değerlendirilmiyordu, oysa Google (sınırsız yürüme
// arama mesafesiyle) o durağa 24 dk'lık gerçek bir yürüyüş öneriyordu.
// 1.8km/10 adaya çıkarınca aynı örnekte süre 109 dk'dan 85 dk'ya düşüp
// Google'ın en iyi seçeneğiyle (84 dk) örtüştü — bkz. proje notları.
//
// 2.0km'ye tekrar genişletildi (2026-09-17): koordinatı tahmini duraklar
// artık aday olamadığından (bkz. UNRELIABLE_COORD_SOURCES), Pursaklar'ın
// kendi durağı 1.8km sınırının hemen dışında (1.85km) kalan tek GERÇEK
// durağa (SARAY DOĞAN DURAĞI) hiç ulaşamıyor, "Yerel hat (doğrulanamadı)"
// güvenlik ağına düşüyordu. Tüm ilçe/mahalle/proje noktaları tarandı —
// Pursaklar dışında en uzak nokta 1.34km'de, yani 2.0km başka bir yeri
// etkilemiyor (bkz. proje notları).
const NEAREST_STOP_SEARCH_KM = 2.0; // bir nokta çevresinde graf'a giriş/çıkış için aranan yarıçap
const NEAREST_STOP_MAX_CANDIDATES = 10;
const WALK_STEP_MIN_KM = 0.12; // bundan kısa yürümeler ayrı adım olarak gösterilmez (süreye yine de dahil)
const GRID_CELL_DEG = 0.006; // ~500-650m'lik ızgara hücresi (Ankara enleminde)

// transit_network.json'daki duraklardan ~%37'sinin (3273 enterpolasyon +
// 528 ekstrapolasyon / 10.940) koordinatı gerçek GPS değil — hattın bilinen
// iki GERÇEK durağı arasına DÜZ ÇİZGİ ile serpiştirilmiş bir tahmin (ör.
// "502 KAHRAMANKAZAN-SIHHİYE" hattında Gazi Üniversitesi ile 2008 Sk. arası
// 17km'lik boşluk düz çizgiyle dolduruluyor). Bu hayalet duraklardan biri
// tesadüfen Etlik'e, biri hastane girişine denk gelince motor "527-3 (ÖTA)
// KIZILCAHAMAM-ANKARA" gibi şehirlerarası/seyrek bir hattı adeta kapından
// geçen bir servis gibi önerdi (Google Maps'in gerçek 261+480 aktarmalı
// önerisinin çok altında, gerçekçi olmayan bir süreyle) — bkz. proje notları,
// 2026-09-16. Bu yüzden bu duraklar HEM adrese en yakın biniş/iniş adayı
// olarak HEM DE başka bir hatta "aktarma" köprüsü kurmak için asla
// kullanılmıyor (aşağıda buildTransitGraph ve stopsWithinRadius'a bkz.);
// buna karşın kendi hattı üzerinde ARA istasyon olarak hâlâ geçerliler —
// gerçek otobüs oradan fiilen geçiyor, sadece o duraktaki tam koordinat
// belirsiz, bu yüzden hat sürekliliğini bozmuyoruz.
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

let transitGraph = null; // buildTransitGraph() tamamlanınca dolar — SADECE resmi hatlar (dolmuş hariç)
let transitGraphWithDolmus = null; // dolmuş dahil tam graf — sadece "dolmuşla alternatif" kontrolü için

/**
 * "tren" modundaki hatların çoğu (25'ten 22'si) YHT/ekspres gibi şehirlerarası
 * servisler (Ankara-İstanbul, Ankara-Konya YHT'si vb.) — bunlar bilet/
 * rezervasyon gerektirir, seyrek sefer yapar ve şehir içi durak vermez; bir
 * adayın günlük işe gidiş-gelişi için gerçekçi değildir. Gerçek şehir
 * içi/banliyö hattı olan Başkentray (B1) ve Ankara-Polatlı Bölgesel Treni
 * (B21) kısa, gerçek bir hat numarası taşırken, şehirlerarası olanlar OSM
 * ilişki id'sini placeholder olarak taşıyor (hatNo: "LINE 12345") — bu farkla
 * ayırt ediyoruz.
 */
function isRoutableLine(line) {
  if (line.mode !== "tren") return true;
  return /^B\d+$/.test(line.hatNo || "");
}

/**
 * transit_network.json'dan (network: {stops, lines}) bir graf kurar:
 * - Biniş kenarları: her hattın ardışık durakları arası, iki yönde de,
 *   gerçek mesafe/mod hızına göre süreli.
 * - Yürüme/aktarma kenarları: ızgara komşuluğuyla (O(n²) tarama YOK)
 *   ≤350m'deki FARKLI duraklar arası.
 */
function buildTransitGraph(network, options) {
  const excludeModes = (options && options.excludeModes) || new Set();
  const stopsById = new Map();
  const grid = new Map();
  network.stops.forEach((s) => {
    if (excludeModes.has(s.mode)) return;
    if (typeof s.lat !== "number" || typeof s.lng !== "number") return;
    stopsById.set(s.id, s);
    const key = gridCellKey(s.lat, s.lng);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(s.id);
  });

  const adjacency = new Map();
  const addEdge = (fromId, toId, minutes, lineId, mode, arterial, headwayMin, hatNo) => {
    if (!adjacency.has(fromId)) adjacency.set(fromId, []);
    adjacency.get(fromId).push({
      to: toId,
      minutes,
      lineId,
      mode,
      arterial: arterial || false,
      headwayMin: headwayMin || 0,
      hatNo: hatNo || null,
    });
  };

  const linesByLocalId = new Map();
  network.lines.forEach((line) => {
    if (excludeModes.has(line.mode)) return;
    if (!isRoutableLine(line)) return;
    linesByLocalId.set(line.id, line);
    const ids = line.stopIds || [];
    for (let i = 0; i < ids.length - 1; i++) {
      const a = stopsById.get(ids[i]);
      const b = stopsById.get(ids[i + 1]);
      if (!a || !b) continue;
      const km = haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
      const arterial = isArterialAirportEdge(line, a, b, km);
      const boulevard = !arterial && isBoulevardConnectorLine(line) && km <= BOULEVARD_EDGE_MAX_KM;
      const oho = !arterial && !boulevard && isOhoCorridorLine(line) && km <= OHO_CORRIDOR_EDGE_MAX_KM;
      const speed = arterial ? ARTERIAL_BUS_SPEED_KMH : boulevard ? BOULEVARD_BUS_SPEED_KMH : oho ? OHO_CORRIDOR_SPEED_KMH : MODE_SPEED_KMH[line.mode] || MODE_SPEED_KMH.otobus;
      const dwell = boulevard ? BOULEVARD_DWELL_MIN : oho ? OHO_CORRIDOR_DWELL_MIN : STOP_DWELL_MIN;
      const minutes = (km / speed) * 60 + dwell;
      const headwayMin = lineHeadwayMin(line);
      addEdge(a.id, b.id, minutes, line.id, line.mode, arterial, headwayMin, line.hatNo);
      addEdge(b.id, a.id, minutes, line.id, line.mode, arterial, headwayMin, line.hatNo);
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
 * true geçilmeli (findRealRoute/getDijkstraFrom'a bkz.), aksi halde yanlış
 * konumlu bir hayalet durak "kapının önünde" gibi görünüp gerçekçi olmayan
 * bir hatta biniyormuş gibi hesaplanabiliyor.
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
 * Çok kaynaklı Dijkstra. ÖNEMLİ: durum sadece durak değil, "hangi hatta
 * bulunuluyor" bilgisini de taşır (stopId + lineId birlikte bir durum
 * oluşturur) — sadece durağa göre tek bir en-iyi-süre tutmak, gerçek bir
 * hatta binmişken ARA istasyonlardan birine başka (daha ucuz ama farklı)
 * bir hatla da ulaşılabiliyorsa, o ara istasyonun "daha ucuz" kaydını
 * kilitleyip asıl hattın devamını keşfetmeyi engelliyordu. Somut örnek:
 * Kızılay'dan Bilkent'e TEK hatla giden metro, yol üstündeki Necatibey/
 * Millî Kütüphane gibi istasyonlara yerel bir otobüsle biraz daha "ucuza"
 * ulaşılabildiği için hiç keşfedilmiyordu — oysa metroyla devam etmek
 * (o ara istasyonlara o an nasıl ulaşıldığından bağımsız olarak) toplamda
 * daha hızlıydı. Bu yüzden aynı durağa aynı hatla ulaşan her farklı "durum"
 * ayrı ayrı takip ediliyor; bir durağa gerçekten en hızlı ulaşım ise tüm
 * hat-durumları arasındaki minimum olarak (bestAtStop) ayrıca tutuluyor.
 */
/**
 * transferPenaltyMin > 0 verilirse, her aktarmaya (gerçek bekleme süresinin
 * ÜSTÜNE) bu kadar yapay bir ceza eklenir — Dijkstra'yı gerçek süreden ÖNCE
 * aktarma sayısını azaltmaya zorlamak için ("En Az Aktarmalı" seçeneği,
 * bkz. buildMinTransfersAlternative). Sıralama bu cezalı süreye (minutes)
 * göre yapılır ama GERÇEK süre (ceza hariç) ayrıca realMinutes'ta tutulur —
 * kullanıcıya cezalı/uydurma bir süre asla gösterilmez.
 */
function runDijkstra(graph, sources, transferPenaltyMin = 0, originCoords = null) {
  const NONE = " "; // henüz hiçbir hatta binilmemiş/sadece yürünüyor durumu
  const dist = new Map(); // "stopId|lineKey" -> sıralama için kullanılan (cezalı olabilir) dakika
  const realDist = new Map(); // "stopId|lineKey" -> GERÇEK dakika (ceza hariç)
  const prev = new Map(); // "stopId|lineKey" -> { fromKey, lineId, mode }
  const keyStopId = new Map(); // "stopId|lineKey" -> stopId
  const bestAtStop = new Map(); // stopId -> tüm hat-durumları arasında en iyi (cezalı olabilir) dakika
  const bestStateAtStop = new Map(); // stopId -> o en iyiye ulaşan durum anahtarı
  const bestRealMinutesAtStop = new Map(); // stopId -> o en iyiye karşılık gelen GERÇEK süre
  const walkAt = new Map(); // durum anahtarı -> o ana kadar gerçek yürüme dakikası
  const statesAtStop = new Map(); // stopId -> bu duraktaki durum anahtarları
  const heap = new MinHeap();
  function rememberState(stopId, key) {
    let set = statesAtStop.get(stopId);
    if (!set) {
      set = new Set();
      statesAtStop.set(stopId, set);
    }
    set.add(key);
  }

  function relaxBestAtStop(stopId, key, minutes, realMinutes) {
    const cur = bestAtStop.get(stopId);
    if (cur === undefined || minutes < cur - 1e-9) {
      bestAtStop.set(stopId, minutes);
      bestStateAtStop.set(stopId, key);
      bestRealMinutesAtStop.set(stopId, realMinutes);
    }
  }

  sources.forEach(({ stopId, startMinutes, realStart }) => {
    const realStartMinutes = realStart === undefined ? startMinutes : realStart;
    const key = stopId + "|" + NONE;
    if (!dist.has(key) || dist.get(key) > startMinutes) {
      dist.set(key, startMinutes);
      realDist.set(key, realStartMinutes);
      walkAt.set(key, realStartMinutes);
      keyStopId.set(key, stopId);
      rememberState(stopId, key);
      heap.push({ stopId, lineKey: NONE, minutes: startMinutes, rideHat: null, rideMode: null, walkMin: realStartMinutes });
      relaxBestAtStop(stopId, key, startMinutes, realStartMinutes);
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
      // bölgelerinde (Kızılay gibi onlarca hattın kesiştiği duraklar)
      // yürüme zincirleri üzerinden durum sayısı katlanarak patlıyordu
      // (bir seçim ~19 saniye sürüyordu). Yürümenin kendisi bedava (sadece
      // kendi süresi var); bekleme SADECE yeni bir hatta binerken eklenir
      // ve o hattın sefer aralığının yarısıdır (boardingWaitMin). Aynı hatta
      // kalmaya devam etmek hâlâ bedava.
      let waitCost = 0;
      let newLineKey;
      const boarding = e.lineId && curLine !== e.lineId;
      if (e.lineId) {
        if (boarding) waitCost = boardingWaitMin(e.headwayMin);
        newLineKey = e.lineId;
      } else {
        newLineKey = NONE;
      }
      // En az aktarmalı arama büyük bir düz ceza gönderir. Gündüz aramasında
      // o ceza yok: otobüsten metroya aktarma ucuz, otobüsten otobüse pahalı.
      // Gece hattı ve 15 dk üstü yürüyüş yalnız seçim maliyetine eklenir.
      let penalty = 0;
      if (boarding) {
        if (transferPenaltyMin >= 100) penalty += transferPenaltyMin;
        else {
          const modePenalty = modeTransferPenalty(cur.rideMode, e.mode);
          penalty += modePenalty || (cur.rideMode ? transferPenaltyMin : 0);
        }
        if (edgeIsNightService(graph, e)) penalty += NIGHT_LINE_PENALTY_MIN;
      }
      // Kısa yürüyüş aktarması hat durumunu sıfırlar; bir önceki binişin hat
      // numarasını ayrıca taşıyoruz ki 178-3 → yürüyüş → 607 gibi halka
      // bağları cezayı atlatamasın. Bu alan durum anahtarına girmez.
      let nextRideHat = cur.rideHat || null;
      let nextRideMode = cur.rideMode || null;
      let chainPenalty = 0;
      if (e.lineId && e.hatNo) {
        if (boarding) chainPenalty = inceKChainPenalty(nextRideHat, e.hatNo, originCoords);
        nextRideHat = e.hatNo;
        nextRideMode = e.mode;
      }
      const curWalk = cur.walkMin || 0;
      const addedWalk = e.lineId ? 0 : e.minutes;
      const nextWalk = curWalk + addedWalk;
      const longWalkPenalty = curWalk <= WALK_LONG_LIMIT_MIN && nextWalk > WALK_LONG_LIMIT_MIN ? LONG_WALK_PENALTY_MIN : 0;
      const selectionMinutes = e.mode === "metro" || e.mode === "ankaray" ? e.minutes * METRO_SELECTION_FACTOR : e.minutes;
      const newMinutes = cur.minutes + (e.lineId ? selectionMinutes : e.minutes * WALK_PENALTY_FACTOR) + waitCost + penalty + chainPenalty + longWalkPenalty;
      const newRealMinutes = curRealMinutes + e.minutes + waitCost;
      const newKey = e.to + "|" + newLineKey;
      const known = dist.get(newKey);
      if (known === undefined || newMinutes < known - 1e-9) {
        dist.set(newKey, newMinutes);
        realDist.set(newKey, newRealMinutes);
        walkAt.set(newKey, nextWalk);
        keyStopId.set(newKey, e.to);
        rememberState(e.to, newKey);
        prev.set(newKey, { fromKey: curKey, lineId: e.lineId, mode: e.mode });
        heap.push({ stopId: e.to, lineKey: newLineKey, minutes: newMinutes, rideHat: nextRideHat, rideMode: nextRideMode, walkMin: nextWalk });
        relaxBestAtStop(e.to, newKey, newMinutes, newRealMinutes);
      }
    });
  }
  return { prev, keyStopId, bestAtStop, bestStateAtStop, bestRealMinutesAtStop, dist, realDist, walkAt, statesAtStop };
}

// rankProjectsForOrigin/rankDistrictsForProject tek bir tarafı sabit tutup
// diğerini döngüyle değiştiriyor; hangi taraf sabitse Dijkstra'yı SADECE
// ondan bir kez çalıştırıp sonucu burada önbelleğe alıyoruz (aksi halde her
// proje/ilçe çifti için ayrı bir tam graf taraması gerekirdi).
// Graf başına ayrı önbellek (Map anahtarı graf nesnesinin kendisi) — hem
// resmi graf (transitGraph) hem dolmuş dahil graf (transitGraphWithDolmus)
// için aynı fonksiyonlar kullanılabilsin diye. Her graf içinde ayrıca
// transferPenaltyMin'e göre AYRI bir tek-girişlik yuva tutulur ("varyant") —
// aksi halde "En Hızlı" (ceza 0) ve "En Az Aktarmalı" (ceza>0) hesapları aynı
// grafı paylaştığı için sırayla her satırda birbirinin önbelleğini geçersiz
// kılıp (thrashing) her ikisini de her seferinde sıfırdan koştururdu.
const dijkstraCacheByGraph = new Map();

function getDijkstraFrom(coords, graph = transitGraph, transferPenaltyMin = 0, feedOrigin = null, accessRadiusKm = null) {
  const radius = accessRadiusKm || NEAREST_STOP_SEARCH_KM;
  const key = coords.lat.toFixed(4) + "," + coords.lng.toFixed(4);
  const variant = (transferPenaltyMin || 0) + (feedOrigin ? ":feed" : "") + ":r" + radius;
  let variants = dijkstraCacheByGraph.get(graph);
  if (!variants) {
    variants = new Map();
    dijkstraCacheByGraph.set(graph, variants);
  }
  const cached = variants.get(variant);
  if (cached && cached.key === key) return cached.result;
  const sources = stopsWithinRadius(graph, coords.lat, coords.lng, radius, true)
    .slice(0, NEAREST_STOP_MAX_CANDIDATES)
    .map(({ stop, km }) => ({ stopId: stop.id, startMinutes: walkMinutes(km) * WALK_PENALTY_FACTOR, realStart: walkMinutes(km) }));
  const result = runDijkstra(graph, sources, transferPenaltyMin, feedOrigin);
  variants.set(variant, { key, result });
  return result;
}

/**
 * originCoords/destCoords: {lat, lng}. graph verilmezse resmi graf kullanılır.
 * fixedSide: bir dizi çağrı boyunca hangi ucun SABİT kaldığını belirtir
 * ("origin" varsayılan). Dijkstra HER ZAMAN fixedSide tarafından koşturulur
 * (getDijkstraFrom tek girişlik önbelleğinden faydalansın diye) — origin
 * sabitken (ör. rankProjectsForOrigin: aynı aday için onlarca proje
 * taranıyor) bu zaten varsayılan davranıştı. fixedSide="dest" ise (ör.
 * rankDistrictsForProject: aynı proje için onlarca ilçe taranıyor) Dijkstra
 * dest'ten koşturulup yol sonradan origin->dest sırasına çevrilir — kenarın
 * hat/modu yöne bağlı olmadığı için (bkz. buildTransitGraph, her kenar iki
 * yönde de eklenir) bu çevirme sonucu ETKİLEMEZ, sadece SIRAYI düzeltir.
 * Bu olmadan, sabit taraf dest iken her satırda origin değiştiği için
 * Dijkstra önbelleği hiç isabet etmiyor ve her sorgu tam bir graf taraması
 * gerektiriyordu (9 ilçe için ~5 saniye — gözlemlenen "çok yavaş" şikayeti).
 * Dönüş: { totalMinutes, pathStopIds, edgeAtStop } ya da her iki nokta
 * arasında (1.2km içinde hiç durak yoksa) null.
 */
function findRealRoute(originCoords, destCoords, graph = transitGraph, fixedSide = "origin", transferPenaltyMin = 0) {
  if (!graph) return null;
  const fromCoords = fixedSide === "dest" ? destCoords : originCoords;
  const toCoords = fixedSide === "dest" ? originCoords : destCoords;
  // 750 m ve 800 m aşağıda tercih. Arama yarıçapını bu kadar kısarsak
  // Çayyolu gibi en yakın durağı 782 m olan yerler rotasız kalıp haritada
  // kuş uçuşu düz çizgiye düşüyor. Durak 2 km içindeyse gerçek hat çizilir.
  const accessRadius = NEAREST_STOP_SEARCH_KM;
  const candidateRadius = NEAREST_STOP_SEARCH_KM;
  const { prev, keyStopId, dist, realDist, walkAt, statesAtStop } = getDijkstraFrom(
    fromCoords,
    graph,
    transferPenaltyMin,
    fixedSide === "dest" ? null : originCoords,
    accessRadius
  );
  const toCandidates = stopsWithinRadius(graph, toCoords.lat, toCoords.lng, candidateRadius, true).slice(
    0,
    NEAREST_STOP_MAX_CANDIDATES
  );

  function forwardEdges(stateKey) {
    const chain = [];
    let key = stateKey;
    while (key) {
      chain.push(key);
      const step = prev.get(key);
      if (!step) break;
      key = step.fromKey;
    }
    const edges = [];
    for (let i = chain.length - 1; i > 0; i--) {
      const step = prev.get(chain[i - 1]);
      if (!step) continue;
      edges.push({
        fromStop: keyStopId.get(chain[i]),
        toStop: keyStopId.get(chain[i - 1]),
        lineId: step.lineId,
        mode: step.mode,
      });
    }
    if (fixedSide !== "dest") return edges;
    return edges.reverse().map((edge) => ({
      fromStop: edge.toStop,
      toStop: edge.fromStop,
      lineId: edge.lineId,
      mode: edge.mode,
    }));
  }

  function rideLegs(edges) {
    const rides = [];
    edges.forEach((edge) => {
      if (!edge.lineId) return;
      const last = rides[rides.length - 1];
      if (last && last.lineId === edge.lineId) last.toStop = edge.toStop;
      else rides.push({ lineId: edge.lineId, mode: edge.mode, fromStop: edge.fromStop, toStop: edge.toStop });
    });
    return rides;
  }

  const options = [];
  toCandidates.forEach(({ stop, km }) => {
    const keys = statesAtStop.get(stop.id);
    if (!keys) return;
    keys.forEach((stateKey) => {
      if (!dist.has(stateKey)) return;
      const rides = rideLegs(forwardEdges(stateKey));
      const boardStop = rides.length ? graph.stopsById.get(rides[0].fromStop) : null;
      const alightStop = rides.length ? graph.stopsById.get(rides[rides.length - 1].toStop) : null;
      const boardKm = boardStop ? haversineKm(originCoords, { lat: boardStop.lat, lng: boardStop.lng }) : 0;
      const alightKm = alightStop ? haversineKm({ lat: alightStop.lat, lng: alightStop.lng }, destCoords) : km;
      const singleBus = rides.length === 1 && (rides[0].mode === "otobus" || rides[0].mode === "dolmus");
      const walkMin = walkAt.get(stateKey) || 0;
      const egressMin = walkMinutes(km);
      let selection = dist.get(stateKey) + egressMin * WALK_PENALTY_FACTOR;
      if (walkMin <= WALK_LONG_LIMIT_MIN && walkMin + egressMin > WALK_LONG_LIMIT_MIN) selection += LONG_WALK_PENALTY_MIN;
      options.push({
        stateKey,
        stopId: stop.id,
        selection,
        shown: realDist.get(stateKey) + egressMin,
        boardKm,
        alightKm,
        rides: rides.length,
        singleBus,
        compliant: rides.length === 0
          ? haversineKm(originCoords, destCoords) <= ALIGHT_PROJECT_MAX_KM
          : boardKm <= ACCESS_BOARD_MAX_KM && alightKm <= ALIGHT_PROJECT_MAX_KM,
      });
    });
  });

  const hasDoorAlight = options.some((option) => option.alightKm <= DOOR_ALIGHT_KM);
  const hasCloseAlight = options.some((option) => option.alightKm <= CLOSE_ALIGHT_KM);
  options.forEach((option) => {
    if (hasDoorAlight && option.alightKm > DOOR_ALIGHT_KM) {
      option.selection += (option.alightKm - DOOR_ALIGHT_KM) * DOOR_ALIGHT_MIN_PER_KM;
    } else if (!hasDoorAlight && hasCloseAlight && option.alightKm > CLOSE_ALIGHT_KM) {
      option.selection += (option.alightKm - CLOSE_ALIGHT_KM) * EARLY_ALIGHT_MIN_PER_KM;
    }
  });

  const compliant = options.filter((option) => option.compliant);
  const pool = compliant.length ? compliant : options;
  let best = null;
  pool.forEach((option) => {
    if (!best || option.selection < best.total) {
      best = { total: option.selection, stopId: option.stopId, realTotal: option.shown, stateKey: option.stateKey };
    }
  });
  if (!best) return null;

  const pathStopIds = [];
  const edgeAtStop = new Map(); // varış durağı stopId -> o durağa gelirken kullanılan {lineId, mode}
  let curKey = best.stateKey;
  while (curKey) {
    const stopId = keyStopId.get(curKey);
    pathStopIds.unshift(stopId);
    const p = prev.get(curKey);
    if (p) edgeAtStop.set(stopId, { lineId: p.lineId, mode: p.mode });
    curKey = p ? p.fromKey : null;
  }

  if (fixedSide !== "dest") {
    return { totalMinutes: best.realTotal, selectionMin: best.total, pathStopIds, edgeAtStop };
  }

  // Dijkstra dest'ten koşturuldu; pathStopIds şu an dest->origin sırasında.
  // Çağıranın beklediği origin->dest sırasına çeviriyoruz.
  const reversedIds = [...pathStopIds].reverse();
  const reversedEdgeAtStop = new Map();
  for (let i = 0; i < pathStopIds.length - 1; i++) {
    reversedEdgeAtStop.set(pathStopIds[i], edgeAtStop.get(pathStopIds[i + 1]));
  }
  return { totalMinutes: best.realTotal, selectionMin: best.total, pathStopIds: reversedIds, edgeAtStop: reversedEdgeAtStop };
}

/** Bir durak dizisini (ve prev'deki hat bilgisini), ardışık aynı hattı tek adımda birleştirerek adımlara çevirir. */
function pathToSteps(pathStopIds, edgeAtStop, graph) {
  const rawEdges = [];
  for (let i = 1; i < pathStopIds.length; i++) {
    const info = edgeAtStop.get(pathStopIds[i]);
    if (!info) continue;
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
        fromStopId: s.fromStopId,
        toStopId: s.toStopId,
      };
    }
    return {
      mode: "hub",
      line: "Yürüyüş",
      from: fromName,
      to: toName,
      verified: true,
      lineId: null,
      fromStopId: s.fromStopId,
      toStopId: s.toStopId,
    };
  });
}

/**
 * originCoords/destCoords: {lat, lng}
 * fixedSide: bir dizi çağrı boyunca hangi ucun sabit kaldığını belirtir —
 * Dijkstra önbelleğinin isabet etmesi için findRealRoute'a olduğu gibi
 * iletilir (bkz. findRealRoute'un başındaki not).
 * Dönüş: { durationMin, transfers, routeSummary, steps, distanceKm, verified }
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

  const route = findRealRoute(origin.coords, dest.coords, transitGraph, fixedSide, PRIMARY_TRANSFER_PENALTY_MIN);
  if (!route) {
    // Güvenlik ağı: bir uç, gerçek ağın 1.2km çevresinde hiç durağa denk
    // gelmiyorsa (ör. Ankara dışı bir adres) düz tahmine düşülür.
    const durationMin = Math.max(roundTo5((distanceKm / 18) * 60 + 10), 12);
    return {
      durationMin, transfers: 0,
      routeSummary: `Yerel hat (doğrulanamadı) (${destLabel} civarı)`,
      steps: [{ mode: "otobus", line: "Yerel hat (doğrulanamadı)", from: originLabel, to: destLabel, verified: false, lineId: null, approx: true }],
      distanceKm, verified: false,
    };
  }

  const steps = pathToSteps(route.pathStopIds, route.edgeAtStop, transitGraph);

  const firstStop = transitGraph.stopsById.get(route.pathStopIds[0]);
  const lastStop = transitGraph.stopsById.get(route.pathStopIds[route.pathStopIds.length - 1]);
  const firstWalkKm = haversineKm(origin.coords, { lat: firstStop.lat, lng: firstStop.lng });
  const lastWalkKm = haversineKm({ lat: lastStop.lat, lng: lastStop.lng }, dest.coords);

  if (lastWalkKm > WALK_STEP_MIN_KM) {
    steps.push({ mode: "hub", line: "Yürüyüş", from: lastStop.name, to: destLabel, verified: true, lineId: null });
  }
  if (firstWalkKm > WALK_STEP_MIN_KM) {
    steps.unshift({ mode: "hub", line: "Yürüyüş", from: originLabel, to: firstStop.name, verified: true, lineId: null });
  }

  const rideSteps = steps.filter((s) => s.lineId);
  const transfers = Math.max(rideSteps.length - 1, 0);
  const durationMin = Math.max(roundTo5(route.totalMinutes), 5);
  const rawMinutes = route.totalMinutes;
  const routeSummary = `${rideSteps.length ? rideSteps.map((s) => s.line).join(" + ") : "Yürüyüş"} (${destLabel} civarı)`;
  const verified = steps.every((s) => s.verified);

  const dolmusAlternative = buildDolmusAlternative(origin, dest, originLabel, destLabel, route.totalMinutes, fixedSide);
  const minTransfersAlternative = buildMinTransfersAlternative(origin, dest, originLabel, destLabel, transfers, durationMin, fixedSide);

  return { durationMin, rawMinutes, selectionMin: route.selectionMin, transfers, routeSummary, steps, distanceKm, verified, dolmusAlternative, minTransfersAlternative };
}

// Ana rota SADECE resmi taşımayla (yukarıda) hesaplanır — dolmuş, resmi
// olmayan/gayriresmi bir hizmet olduğu için sıralama/eşleştirmeye hiç
// karışmıyor. Burada, dolmuş dahil TAM graf üzerinde AYRI bir Dijkstra
// çalıştırılıp, sadece gerçekten (a) en az bir dolmuş adımı içeren VE
// (b) resmi rotadan belirgin ölçüde (>=5 dk) daha hızlı bir yol varsa,
// bu "alternatif" olarak ayrıca döndürülür — kullanıcının kendi isteğiyle
// (rota kısmında dolmuşu ayrı bir yerde göstermek) birebir örtüşüyor.
const DOLMUS_ALT_MIN_SAVING_MIN = 5;

function buildDolmusAlternative(origin, dest, originLabel, destLabel, officialMinutes, fixedSide = "origin") {
  if (!transitGraphWithDolmus) return null;

  const altRoute = findRealRoute(origin.coords, dest.coords, transitGraphWithDolmus, fixedSide);
  if (!altRoute) return null;
  if (officialMinutes - altRoute.totalMinutes < DOLMUS_ALT_MIN_SAVING_MIN) return null;

  const altSteps = pathToSteps(altRoute.pathStopIds, altRoute.edgeAtStop, transitGraphWithDolmus);
  const usesDolmus = altSteps.some((s) => s.mode === "dolmus");
  if (!usesDolmus) return null;

  const firstStop = transitGraphWithDolmus.stopsById.get(altRoute.pathStopIds[0]);
  const lastStop = transitGraphWithDolmus.stopsById.get(altRoute.pathStopIds[altRoute.pathStopIds.length - 1]);
  const firstWalkKm = haversineKm(origin.coords, { lat: firstStop.lat, lng: firstStop.lng });
  const lastWalkKm = haversineKm({ lat: lastStop.lat, lng: lastStop.lng }, dest.coords);

  if (lastWalkKm > WALK_STEP_MIN_KM) {
    altSteps.push({ mode: "hub", line: "Yürüyüş", from: lastStop.name, to: destLabel, verified: true, lineId: null });
  }
  if (firstWalkKm > WALK_STEP_MIN_KM) {
    altSteps.unshift({ mode: "hub", line: "Yürüyüş", from: originLabel, to: firstStop.name, verified: true, lineId: null });
  }

  const altRideSteps = altSteps.filter((s) => s.lineId);
  const durationMin = Math.max(roundTo5(altRoute.totalMinutes), 5);
  const routeSummary = altRideSteps.length ? altRideSteps.map((s) => s.line).join(" + ") : "Yürüyüş";

  return {
    durationMin,
    transfers: Math.max(altRideSteps.length - 1, 0),
    routeSummary,
    steps: altSteps,
    savingMin: roundTo5(officialMinutes - altRoute.totalMinutes),
  };
}

// "En Az Aktarmalı" seçenek: aynı resmi grafta (dolmuş DAHİL değil — bu ayrı
// bir kavram), aktarma başına büyük bir yapay süre cezası (bkz. runDijkstra
// transferPenaltyMin) ekleyerek AYRI bir Dijkstra çalıştırır. Ceza, olası
// herhangi bir gerçek süre farkından kat kat büyük olduğu için algoritma
// süreden ÖNCE aktarma sayısını azaltmaya zorlanır — ama kullanıcıya
// gösterilen süre yine GERÇEK süredir (bkz. findRealRoute'un realTotal'i).
// Sadece PRİMER (En Hızlı) rotadan GERÇEKTEN daha az aktarmalıysa ayrı bir
// seçenek olarak sunulur; aksi halde ikisi zaten aynı rotadır.
const MIN_TRANSFERS_PENALTY_MIN = 2000;

function buildMinTransfersAlternative(origin, dest, originLabel, destLabel, primaryTransfers, primaryDurationMin, fixedSide = "origin") {
  if (!transitGraph || primaryTransfers === 0) return null; // zaten aktarmasız — daha azı yok

  const altRoute = findRealRoute(origin.coords, dest.coords, transitGraph, fixedSide, MIN_TRANSFERS_PENALTY_MIN);
  if (!altRoute) return null;

  const altSteps = pathToSteps(altRoute.pathStopIds, altRoute.edgeAtStop, transitGraph);

  const firstStop = transitGraph.stopsById.get(altRoute.pathStopIds[0]);
  const lastStop = transitGraph.stopsById.get(altRoute.pathStopIds[altRoute.pathStopIds.length - 1]);
  const firstWalkKm = haversineKm(origin.coords, { lat: firstStop.lat, lng: firstStop.lng });
  const lastWalkKm = haversineKm({ lat: lastStop.lat, lng: lastStop.lng }, dest.coords);

  if (lastWalkKm > WALK_STEP_MIN_KM) {
    altSteps.push({ mode: "hub", line: "Yürüyüş", from: lastStop.name, to: destLabel, verified: true, lineId: null });
  }
  if (firstWalkKm > WALK_STEP_MIN_KM) {
    altSteps.unshift({ mode: "hub", line: "Yürüyüş", from: originLabel, to: firstStop.name, verified: true, lineId: null });
  }

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
  KEY: "ik_ulasim_cache_v33", // v33: 750 m durağı olmayan yerde gerçek hat kalsın, kuş uçuşuna düşmesin.
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

const GEOCODE_CACHE_KEY = "ik_ulasim_geocode_cache_v1";
const DISCOVERY_CACHE_KEY = "ik_ulasim_discovery_cache_v3"; // v3: KNOWN_STOP_NAME_INDEX genişletildi (yeni gerçek duraklar), önbellek sıfırlandı

// Nominatim'in kullanım politikası saniyede en fazla ~1 isteğe izin veriyor.
// Eski hâlde bu SADECE bir yorum satırıydı — gerçek kod, yüzlerce adaylık bir
// Excel'in ilk kez puanlanması sırasında (rankCandidatesForProject/
// runBatchMatch) Promise.all ile TÜM geocode isteklerini aynı anda ateşliyordu.
// Bu hem politikayı ihliyor hem de Nominatim'in bir kısmını sessizce
// reddetmesine (ve o adayların "konum belirlenemedi" diye yanlışlıkla
// elenmesine) yol açabiliyordu. Şimdi tüm geocode istekleri TEK bir kuyruktan,
// aralarında en az GEOCODE_MIN_INTERVAL_MS ile geçiyor — kaynak kaç eşzamanlı
// scoreCandidateForProject çağrısı yapılırsa yapılsın.
const GEOCODE_MIN_INTERVAL_MS = 1100;
let geocodeQueueTail = Promise.resolve();
function queueGeocodeFetch(url) {
  const runNow = geocodeQueueTail.then(() => fetch(url, { headers: { Accept: "application/json" } }));
  geocodeQueueTail = runNow.catch(() => {}).then(() => new Promise((resolve) => setTimeout(resolve, GEOCODE_MIN_INTERVAL_MS)));
  return runNow;
}

/** Serbest metin bir adresi/semt adını Ankara sınırlarıyla sınırlı şekilde koordinata çevirir (OSM Nominatim). */
async function geocodeAddress(query) {
  const cache = readJsonCache(GEOCODE_CACHE_KEY);
  const cacheKey = query.trim().toLocaleLowerCase("tr");
  if (cache[cacheKey]) return cache[cacheKey];

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    query + ", Ankara, Türkiye"
  )}&viewbox=32.35,40.25,33.15,39.55&bounded=1&limit=1&countrycodes=tr`;
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
// kabul ediyoruz (261-6 ve 105-1'i doğrulamak için kullandığımız yöntemle
// aynı: gerçek OSM etiket metnini okumak).
// SADECE gerçek durak adıyla BİREBİR eşleşen (yaklaşık/komşu semt değil)
// girdiler bulunur. Örn. "İvedik" veya "Akköprü" gerçek ama AYRI M1
// durakları — Ulus'a eşitlemek "208 hattı Ulus'a gidiyor" gibi yanlış bir
// iddiaya yol açıyordu (gerçekte İvedik'te ayrı bir M1 aktarması gerekir).
// Yaklaşık/komşu eşleşmeler kaldırıldı; bilinmeyen duraklar artık dürüstçe
// "bağlantı noktası belirlenemedi" olarak işaretleniyor.
const KNOWN_STOP_NAME_INDEX = [
  ["kızılay", "stop_kizilay"], ["millî irade", "stop_kizilay"], ["15 temmuz", "stop_kizilay"],
  ["bakanlıklar", "stop_kizilay"], ["bakanlık", "stop_kizilay"],
  ["batıkent", "stop_batikent"],
  ["ankara gar", "stop_gar"],
  ["ulus", "stop_ulus"],
  ["aşti", "stop_asti"],
  ["beşevler", "stop_besevler"],
  ["dikimevi", "stop_dikimevi"],
  ["bahçelievler", "stop_bahcelievler"],
  ["yenimahalle", "stop_yenimahalle"],
  ["demetevler", "stop_demetevler"],
  ["ostim", "stop_ostim_m1"],
  ["çayyolu", "stop_cayyolu"],
  ["bilkent", "stop_bilkent"],
  ["eryaman", "stop_eryaman_m3"],
  ["sincan", "stop_sincan"],
  ["etimesgut", "stop_etimesgut"],
  ["elvankent", "stop_elvankent"],
  ["mamak", "stop_mamak_baskentray"],
  ["etlik", "stop_etlik"],
  ["gölbaşı", "stop_golbasi"],
  ["söğütözü", "stop_sogutozu"],
  ["beytepe", "stop_beytepe"],
  ["ümitköy", "stop_umitkoy"],
  ["saray", "stop_pursaklar_est"],
  ["macunköy", "stop_macunkoy"],
  ["ivedik", "stop_ivedik"],
  ["akköprü", "stop_akkopru"],
  ["sıhhiye", "stop_sihhiye"],
  ["dışkapı", "stop_disgapi"],
  ["necatibey", "stop_necatibey"],
  ["odtü", "stop_odtu"],
  ["millî kütüphane", "stop_milli_kutuphane"],
  ["milli kütüphane", "stop_milli_kutuphane"],
  ["tarım bakanlığı", "stop_tarim_bakanligi"],
  ["danıştay", "stop_tarim_bakanligi"],
  ["botanik", "stop_botanik"],
  ["törekent", "stop_torekent"],
  ["maltepe", "stop_maltepe"],
  ["kolej", "stop_kolej"],
  ["demirtepe", "stop_demirtepe"],
  ["anıtkabir", "stop_anadolu_anitkabir"],
  ["behiçbey", "stop_behicbey"],
  ["hipodrom", "stop_hipodrom"],
  ["cebeci", "stop_cebeci"],
  ["kayaş", "stop_kayas"],
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
// Yerel toplu taşıma ağı (transit_network.json — OSM/Overpass, EGO Genel
// Müdürlüğü, 28.08.2026): 350 hat (314 otobüs dahil) ve ~3.600 gerçek durak.
// Adres/semt arama artık ÖNCELİKLE bu önceden hazırlanmış, internet
// gerektirmeyen veri setini kullanıyor — canlı Overpass sorgusundan (tek
// nokta etrafında 700m, çoğu otobüs hattını kaçırabiliyordu) çok daha
// eksiksiz ve anında sonuç veriyor. discoverNearbyTransit() (Overpass) artık
// sadece bu yerel dosya hiç yüklenemezse yedek olarak kullanılıyor.
// ---------------------------------------------------------------------------
let localTransitNetwork = null;
let localTransitNetworkPromise = null;
let linesByLocalStopId = null;
let localStopsById = null;

// Dolmuş hatları EGO'nun kendi kaynağında yok (dolmuşlar EGO'ya değil özel/
// kooperatif işletmecilere ait, hiçbir resmi kayıt yayınlanmıyor). Bu yüzden
// ayrı bir dosyada, dolmusla.com'un herkese açık (robots.txt'i tamamen
// serbest) güzergah haritasından alınan gerçek koordinat dizileriyle
// tutuluyor — EGO verisiyle karışmasın, kaynağı ayrı belli olsun diye.
function loadDolmusLines() {
  return fetch("dolmus_lines.json?v=1")
    .then((res) => res.json())
    .catch(() => ({ stops: [], lines: [] }));
}

/**
 * Hat/durak ağını grafa kurar. Supabase bölgesi bunu bellekten verir;
 * yerel JSON yalnızca Supabase ayarı yoksa yedek olarak çağrılır.
 * Dolmuş hatları ana süreye karışmaz, ikinci grafta alternatif olarak durur.
 */
function installTransitNetwork(network, options) {
  const data = {
    stops: (network && network.stops) || [],
    lines: (network && network.lines) || [],
  };
  localTransitNetwork = data;
  localStopsById = Object.fromEntries(data.stops.map((s) => [s.id, s]));
  linesByLocalStopId = {};
  data.lines.forEach((line) => {
    (line.stopIds || []).forEach((sid) => {
      (linesByLocalStopId[sid] = linesByLocalStopId[sid] || []).push(line);
    });
  });
  const geometry = {};
  data.lines.forEach((line) => {
    if (line.geometry && line.id) geometry[line.id] = line.geometry;
  });
  if (Object.keys(geometry).length) {
    localTransitGeometry = geometry;
    localTransitGeometryPromise = Promise.resolve(geometry);
  }
  transitGraph = buildTransitGraph(data, { excludeModes: new Set(["dolmus"]) });
  transitGraphWithDolmus = buildTransitGraph(data, {});
  localTransitNetworkPromise = Promise.resolve(data);
  if (!(options && options.silent) && typeof runSearch === "function") runSearch();
  return data;
}

function loadLocalTransitNetwork() {
  if (localTransitNetworkPromise) return localTransitNetworkPromise;
  localTransitNetworkPromise = Promise.all([
    fetch("transit_network.json?v=5").then((res) => res.json()),
    loadDolmusLines(),
  ])
    .then(([egoData, dolmusData]) =>
      installTransitNetwork({
        stops: (egoData.stops || []).concat((dolmusData && dolmusData.stops) || []),
        lines: (egoData.lines || []).concat((dolmusData && dolmusData.lines) || []),
      })
    )
    .catch(() => null);
  return localTransitNetworkPromise;
}
if (!window.SUPABASE_CONFIG) loadLocalTransitNetwork();

// Hat geometrileri (gerçek güzergah şekilleri) ayrı, biraz daha büyük bir
// dosyada (transit_network_geometry.json, ~1.8MB, seyreltilmiş) tutuluyor ve
// stops/lines'tan SONRA, arka planda yükleniyor — sayfa açılışını yavaşlatmasın
// diye. Yüklendiğinde, o ana kadar çizilmiş olabilecek rotayı gerçek
// güzergah şekliyle yeniden çizmek için mevcut aramayı tekrarlar.
let localTransitGeometry = null;
let localTransitGeometryPromise = null;
function loadLocalTransitGeometry() {
  if (localTransitGeometryPromise) return localTransitGeometryPromise;
  localTransitGeometryPromise = fetch("transit_network_geometry.json?v=7")
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
if (!window.SUPABASE_CONFIG) {
  loadLocalTransitNetwork().then(() => loadLocalTransitGeometry());
}

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
        mode: t.route === "bus" ? "otobus" : t.route === "train" ? "tren" : t.route === "light_rail" ? "ankaray" : "metro",
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
 * bunlar artık rota hesaplamasını değil, yalnızca "bu bölgeden geçen gerçek
 * hatlar" bilgi panelini besliyor; rota artık transitGraph üzerinden
 * hesaplanıyor, bkz. §2). Zaten eklenmiş hatları tekrar eklemez.
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
  ANKARA_DATA.districts.forEach((d) => {
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
  const p = ANKARA_DATA.projects.find((x) => x.id === id);
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
function fastestRankScore(row) {
  if (row && typeof row.selectionMin === "number") return row.selectionMin;
  if (row && typeof row.rawMinutes === "number") return row.rawMinutes;
  return row ? row.durationMin : Infinity;
}

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
    return fastestRankScore(a) - fastestRankScore(b);
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

  const rows = ANKARA_DATA.districts.map((d) => {
    const origin = originById(d.id);
    // fixedSide="dest": proje bu döngü boyunca sabit, ilçe her satırda
    // değişiyor — Dijkstra'nın proje tarafından koşup önbelleğe isabet
    // etmesi için (aksi halde her ilçe için sıfırdan tam graf taraması
    // gerekirdi, bkz. findRealRoute'un başındaki not).
    const estimate = getTransitEstimate(d.id, origin, projectId, dest, "dest");
    return { district: d, dest, ...estimate };
  });

  rows.sort((a, b) => fastestRankScore(a) - fastestRankScore(b));
  return thresholdMin ? rows.filter((r) => r.durationMin <= thresholdMin) : rows;
}

function durationBucket(min) {
  if (min <= 30) return { key: "good", label: "≤30 dk", color: "#16a34a" };
  if (min <= 45) return { key: "ok", label: "31-45 dk", color: "#d97706" };
  if (min <= 60) return { key: "warn", label: "46-60 dk", color: "#ea580c" };
  return { key: "bad", label: "60+ dk", color: "#dc2626" };
}

const MODE_ICON = {
  metro: "🚇", ankaray: "🚊", tren: "🚆", otobus: "🚌", dolmus: "🚐", hub: "📍",
  tramvay: "🚋", marmaray: "🚆", metrobus: "🚌", funikuler: "🚞", vapur: "⛴️",
};
// 2026-09-25: harita çizim rengi TEK bir kurumsal Google Haritalar mavisine
// (#1a73e8) indirgendi — otobüs/metro/Ankaray/Başkentray FARK ETMEKSİZİN.
// Önceki sürüm modlara göre ayrı renk veriyordu (metro kırmızı, Ankaray
// yeşil, tren mor); kullanıcı bunun "karmaşık renk paleti" olduğunu, Google
// Haritalar'ın tek maviyle gidip modu SADECE ikon/etiketle (durak paneli,
// tooltip) ayırt ettiğini belirtti. Hangi bacağın hangi hat/mod olduğu hâlâ
// kaybolmuyor — sol paneldeki adım listesi ve haritadaki hover tooltip'i
// (bkz. drawSegment'teki tooltipText) bunu zaten MODE_ICON ile gösteriyor;
// sadece çizgi renginden ayırt etmek gerekmiyor artık.
// 2026-09-25 (ikinci geçiş): kullanıcı Google Haritalar'ın kendi ekran
// görüntülerine bakıp rengin #1a73e8 (genel Google marka mavisi) değil,
// TOPLU TAŞIMA rotalarında gerçekte kullanılan daha koyu laciverte
// (#1a56db) çekilmesini istedi.
const TRANSIT_LINE_COLOR = "#1a56db";
const WALK_LINE_COLOR = TRANSIT_LINE_COLOR;
// "fallback" bacaklar (gerçek güzergahı bilinmeyen/güvenilmez bulunan bir
// otobüs/metro parçası — ya hiç geometri yok ya da MAX_GEOMETRY_JUMP_KM/RATIO
// tarafından reddedildi) 2026-09-24'te nötr gri kullanıyordu (yürüyüşle
// karışmasın diye); 2026-09-25'te kullanıcı bunun harita zemininde "soluk"
// kaybolduğunu belirtip TEK mavi renk kuralına geri döndürülmesini istedi.
// Artık fallback da aynı mavi — ayrımı renk değil, BELİRGİN farklı bir
// kesikli desen (dashArray, bkz. drawSegment) sağlıyor: yürüyüş küçük sık
// noktalar ("2 8"), fallback daha uzun "taslak" çizgiler ("6 6").
const FALLBACK_LINE_COLOR = TRANSIT_LINE_COLOR;

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

const map = L.map("map", { zoomControl: true, attributionControl: false }).setView([39.935, 32.82], 10.4);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  subdomains: "abc",
}).addTo(map);

function refreshMapLayout() {
  const container = map.getContainer();
  if (!container || container.clientWidth < 2 || container.clientHeight < 2) return;
  map.invalidateSize({ animate: false });
}
window.refreshMapLayout = refreshMapLayout;
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
let routesLayer = L.featureGroup().addTo(map);

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
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const isUrgent = URGENT_PROJECT_IDS.has(p.id);
  const m = L.marker([lat, lng], { icon: isUrgent ? urgentProjectIcon : projectIcon });
  m.bindTooltip(`${isUrgent ? "🔴 ACİL — " : ""}${p.name} — ${p.address}`, { direction: "top" });
  projectMarkersById[p.id] = m;
  if (!INACTIVE_PROJECT_IDS.has(p.id)) {
    projectCluster.addLayer(m);
  }
  return m;
}
ANKARA_DATA.projects.forEach(buildProjectMarker);
map.addLayer(projectCluster);
const projectMarkersGroup = projectCluster;

// Proje listesi kökten değiştiğinde (Sheet'ten canlı veri geldiğinde ya da
// yeni bir proje eklendiğinde) tüm pinleri sıfırdan kurar.
function rebuildAllProjectMarkers() {
  projectCluster.clearLayers();
  Object.keys(projectMarkersById).forEach((id) => delete projectMarkersById[id]);
  ANKARA_DATA.projects.forEach(buildProjectMarker);
}

// Acil/aktiflik seçimi değiştiğinde (modal'dan kaydedince) harita pinlerini/
// tooltip'lerini ve kümedeki üyeliğini yeniden hesaplar — sayfayı
// yenilemeye gerek kalmaz. Kapalı projelerin pini haritada hiç görünmez.
function refreshProjectMarkers() {
  ANKARA_DATA.projects.forEach((p) => {
    const marker = projectMarkersById[p.id];
    if (!marker) return;
    const isActive = !INACTIVE_PROJECT_IDS.has(p.id);
    const isUrgent = URGENT_PROJECT_IDS.has(p.id);
    marker.setIcon(isUrgent ? urgentProjectIcon : projectIcon);
    marker.setTooltipContent(`${isUrgent ? "🔴 ACİL — " : ""}${p.name} — ${p.address}`);
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
const positionFilters = document.getElementById("positionFilters");
const resultsList = document.getElementById("resultsList");
const resultsHeading = document.getElementById("resultsHeading");
const emptyState = document.getElementById("emptyState");
const routeDetail = document.getElementById("routeDetail");
const routeDetailTitle = document.getElementById("routeDetailTitle");
const routeDetailSteps = document.getElementById("routeDetailSteps");
const routeDetailWarning = document.getElementById("routeDetailWarning");
const routeDolmusAlt = document.getElementById("routeDolmusAlt");
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

function rebuildOriginSelect() {
  const previouslySelected = originSelect.value;
  originSelect.innerHTML = '<option value="">Seçiniz…</option>';
  (ANKARA_DATA.districts || []).forEach((d) => {
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
  if (previouslySelected) originSelect.value = previouslySelected;
}
rebuildOriginSelect();

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
    if (currentMode === "origin-to-project") renderProjectCatalog();
    else clearResults();
    // "Proje -> Gerçek Adaylar" harita/sidebar yerine tam ekran ayrı bir
    // görünümde açılır (candidates.js) — 209+ aday cramped bir listeye
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

function rebuildPositionFilters() {
  if (!positionFilters) return;
  const positions = [];
  (ANKARA_DATA.projects || []).forEach((p) => {
    if (p.position && !positions.includes(p.position)) positions.push(p.position);
  });
  if (currentPositionFilter && !positions.includes(currentPositionFilter)) currentPositionFilter = null;
  positionFilters.innerHTML = "";
  const make = (value, label, active) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "threshold-btn position-btn" + (active ? " threshold-btn-active" : "");
    btn.dataset.position = value;
    btn.textContent = label;
    positionFilters.appendChild(btn);
  };
  make("all", "Tümü", !currentPositionFilter);
  positions.forEach((pos) => make(pos, pos, currentPositionFilter === pos));
}
rebuildPositionFilters();

if (positionFilters) positionFilters.addEventListener("click", (event) => {
  const btn = event.target.closest(".position-btn");
  if (!btn || !positionFilters.contains(btn)) return;
  currentPositionFilter = btn.dataset.position === "all" ? null : btn.dataset.position;
  positionFilters.querySelectorAll(".position-btn").forEach((b) => b.classList.toggle("threshold-btn-active", b === btn));
  rebuildProjectSelect();
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
      return `<div class="nearby-line-row"><span>${MODE_ICON[l.mode] || "🚌"} ${label}</span>${used}</div>`;
    })
    .join("");
  nearbyLinesPanel.classList.remove("hidden");
}

function clearResults() {
  resultsList.innerHTML = "";
  clearRouteLayers();
  routeDetail.classList.add("hidden");
  emptyState.classList.remove("hidden");
  resultsHeading.textContent = "";
  nearbyLinesPanel.classList.add("hidden");
  resetDistrictMarkers();
  setBackgroundMarkersVisible(true);
}

const districtMarkersById = {};
function resetDistrictMarkers() {
  Object.values(districtMarkersById).forEach((m) => markersLayer.removeLayer(m));
  for (const k in districtMarkersById) delete districtMarkersById[k];
}

function projectTerms(project) {
  let age = "";
  if (project.ageRange && project.ageRange.min != null && project.ageRange.max != null) {
    age = `${project.ageRange.min}–${project.ageRange.max}`;
  } else if (project.ageMin != null && project.ageMin !== "" && project.ageMax != null && project.ageMax !== "") {
    age = `${project.ageMin}–${project.ageMax}`;
  }
  return {
    salary: project.salary,
    meal: project.meal,
    transport: project.transport,
    shift: project.shift,
    gender: project.gender,
    position: project.position,
    capacity: project.capacity,
    age,
  };
}

function renderProjectCatalog() {
  routesLayer.clearLayers();
  resetDistrictMarkers();
  routeDetail.classList.add("hidden");
  nearbyLinesPanel.classList.add("hidden");
  const projects = applyPositionFilter(activeProjects())
    .slice()
    .sort((a, b) => {
      const aUrgent = URGENT_PROJECT_IDS.has(a.id) ? 1 : 0;
      const bUrgent = URGENT_PROJECT_IDS.has(b.id) ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      return a.name.localeCompare(b.name, "tr");
    });
  emptyState.classList.toggle("hidden", projects.length > 0);
  resultsHeading.textContent = projects.length ? `Açık Projeler (${projects.length})` : "";
  resultsList.innerHTML = "";
  projects.forEach((project) => {
    resultsList.appendChild(
      buildResultCard({
        title: project.name,
        subtitle: [project.sector, project.address].filter(Boolean).join(" · "),
        terms: projectTerms(project),
        urgent: URGENT_PROJECT_IDS.has(project.id),
        referral: project.referral,
        projectId: project.id,
        onClick: () => {
          const lat = Number(project.lat);
          const lng = Number(project.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          map.setView([lat, lng], 14);
          const marker = projectMarkersById[project.id];
          if (marker) marker.openTooltip();
        },
      })
    );
  });
}

function runSearch() {
  if (currentMode === "origin-to-project") {
    if (!originSelect.value) return renderProjectCatalog();
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
  clearRouteLayers();
  resetDistrictMarkers();
  emptyState.classList.toggle("hidden", rows.length > 0);

  const origin = originById(originId);
  resultsHeading.textContent = `${origin.name} → En Uygun Projeler (${rows.length})`;
  // Önce genel bir görünüme geç — aşağıdaki forEach içinde idx===0 için
  // çağrılan drawRoute() kendi fitBounds()'unu bunun ÜZERİNE uygulayıp asıl
  // (en üstteki) rotayı sıkı şekilde kadrajlayacak. Bu çağrı SONRADAN
  // yapılırsa (eskiden öyleydi), drawRoute'un fitBounds'unu geçersiz kılıp
  // çizilen rota çizgisini geniş/genel görünüm içinde fark edilmez kadar
  // küçük bırakıyordu.
  map.setView([origin.coords.lat, origin.coords.lng], 11, { animate: false });

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
        terms: projectTerms(row.project),
        urgent: URGENT_PROJECT_IDS.has(row.project.id),
        referral: row.project.referral,
        projectId: row.project.id,
        onClick: () => {
          drawRoute(origin.coords, row, bucket);
          showRouteResult(row);
        },
        highlight: idx === 0,
        liveRow: row,
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
  clearRouteLayers();
  resetDistrictMarkers();
  emptyState.classList.toggle("hidden", rows.length > 0);

  const project = projectById(projectId);
  resultsHeading.textContent = `${project.name} → En Uygun İlçeler (${rows.length})`;
  // bkz. renderOriginToProject'teki not — bu, drawRoute'un fitBounds'undan
  // ÖNCE gelmeli, aksi halde en üstteki (idx===0) rota haritada görünmez
  // kadar küçük kalıyor (kullanıcının bildirdiği "hatları göstermiyor" sorunu).
  map.setView([project.coords.lat, project.coords.lng], 11, { animate: false });

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
        liveRow: row,
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

let activeBoardMarker = null;

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function formatClock(date) {
  return date.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function formatWaitMin(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return "6";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function firstBoardContext(row) {
  const step = (row.steps || []).find((s) => s.lineId);
  if (!step || !transitGraph) return null;
  const line = transitGraph.linesByLocalId.get(step.lineId);
  const stop = step.fromStopId ? transitGraph.stopsById.get(step.fromStopId) : null;
  if (!line) return null;
  return {
    step,
    line,
    stop,
    hatNo: line.hatNo,
    stopId: step.fromStopId,
    fallbackWaitMin: boardingWaitMin(lineHeadwayMin(line)),
  };
}

function adjustedTripMinutes(row, board, result) {
  if (!result || result.source !== "live") return row.durationMin;
  const base = typeof row.rawMinutes === "number" ? row.rawMinutes : row.durationMin;
  return Math.max(roundTo5(base - board.fallbackWaitMin + result.estimatedWaitMin), 5);
}

function liveArrivalHtml(board, result, totalMin) {
  if (!board || !result) return "";
  const hat = escapeHtml(board.hatNo);
  if (result.source === "live") {
    const clock = formatClock(new Date(Date.now() + totalMin * 60000));
    const waitLabel = result.estimatedWaitMin <= 0 ? "Durakta" : `Durağa ${formatWaitMin(result.estimatedWaitMin)} dk`;
    return `<div class="live-arrival live-arrival-live">🟢 Canlı: Hat ${hat} • ${waitLabel} (Tahmini Varış: ${clock})</div>`;
  }
  return `<div class="live-arrival live-arrival-static">⚪ Statik Sefer: ~${formatWaitMin(result.estimatedWaitMin)} dk bekleme</div>`;
}

function applyLiveArrival(card, row, result) {
  const board = firstBoardContext(row);
  if (!board || !result) return;
  const totalMin = adjustedTripMinutes(row, board, result);
  const html = liveArrivalHtml(board, result, totalMin);
  const slot = card && card.querySelector("[data-role='live-arrival']");
  if (slot) slot.innerHTML = html;
  if (result.source === "live" && card) {
    const badge = card.querySelector("[data-role='duration']");
    if (badge) badge.textContent = `~${totalMin} dk`;
  }
  if (card && card.classList.contains("result-card-active")) {
    row.liveDurationMin = totalMin;
    routeDetailTitle.innerHTML = `Rota Detayı · ${row.transfers} aktarma · ~${totalMin} dk`;
    if (activeBoardMarker) activeBoardMarker.setPopupContent(html);
  }
}

function attachLiveArrival(card, row) {
  const board = firstBoardContext(row);
  const slot = card.querySelector("[data-role='live-arrival']");
  if (!board) {
    if (slot) slot.innerHTML = "";
    return;
  }
  const pending = liveArrivalHtml(board, { source: "static", estimatedWaitMin: board.fallbackWaitMin }, row.durationMin);
  if (slot) slot.innerHTML = pending;
  if (!window.LiveBus) return;
  LiveBus.getLiveBusArrival(board.stopId, board.line.id, {
    hatNo: board.hatNo,
    fallbackWaitMin: board.fallbackWaitMin,
  }).then((result) => {
    if (!card.isConnected) return;
    applyLiveArrival(card, row, result);
  });
}

function buildResultCard({ title, subtitle, durationMin, transfers, bucket, onClick, highlight, terms, urgent, referral, liveRow, projectId }) {
  const card = document.createElement("div");
  card.className = `result-card ${highlight ? "result-card-active" : ""} ${urgent ? "result-card-urgent" : ""}`;
  card.tabIndex = 0;
  const referralRow = referral ? `<div class="result-card-referral">📌 ${referral}</div>` : "";
  const servisNote = terms && terms.transport === "Servis"
    ? `<div class="result-card-servis-note">🚐 Bu projede firma servisi var — yukarıdaki süre/aktarma toplu taşıma senaryosuna göredir, gerçek servis güzergahı sisteme kayıtlı değil.</div>`
    : "";
  const genderSpan = terms && terms.gender ? `<span>👤 ${terms.gender}</span>` : "";
  const positionSpan = terms && terms.position ? `<span>🏷️ ${terms.position}</span>` : "";
  const capacitySpan = terms && terms.capacity ? `<span>👥 ${terms.capacity}</span>` : "";
  const ageSpan = terms && terms.age ? `<span>🎂 ${terms.age}</span>` : "";
  const termsRow = terms
    ? `<div class="result-card-terms">
        ${positionSpan}
        <span>💰 ${terms.salary}</span>
        <span>🍽️ ${terms.meal}</span>
        <span>🚌 ${terms.transport}</span>
        <span>⏰ ${terms.shift}</span>
        ${genderSpan}
        ${capacitySpan}
        ${ageSpan}
      </div>`
    : "";
  const urgentBadge = urgent ? `<span class="result-card-urgent-badge">ACİL</span>` : "";
  card.innerHTML = `
    ${urgentBadge}
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="font-semibold text-slate-800 truncate">${title}</div>
        <div class="text-xs text-slate-500 truncate">${subtitle}</div>
      </div>
      ${
        durationMin == null
          ? ""
          : `<div class="flex flex-col items-end shrink-0">
        <span class="duration-badge" data-role="duration" style="background:${bucket.color}1a; color:${bucket.color}">~${durationMin} dk</span>
        <span class="text-[11px] text-slate-400 mt-1">${transfers} aktarma</span>
      </div>`
      }
    </div>
    ${referralRow}
    ${termsRow}
    ${servisNote}
    <div data-role="live-arrival"></div>
  `;
  if (projectId) {
    const actions = document.createElement("div");
    actions.className = "result-card-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.dataset.projectAction = "edit";
    editBtn.className = "text-[11px] font-semibold px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50";
    editBtn.textContent = "Düzenle";
    editBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openEditProjectModal(projectId);
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.dataset.projectAction = "delete";
    deleteBtn.className = "text-[11px] font-semibold px-2 py-1 rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50";
    deleteBtn.textContent = "Sil";
    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteProjectById(projectId);
    });
    actions.append(editBtn, deleteBtn);
    card.appendChild(actions);
  }
  if (liveRow) attachLiveArrival(card, liveRow);
  const activate = () => {
    document.querySelectorAll(".result-card").forEach((c) => c.classList.remove("result-card-active"));
    card.classList.add("result-card-active");
    onClick();
  };
  card.addEventListener("click", (event) => {
    if (event.target.closest("[data-project-action]")) return;
    activate();
  });
  card.addEventListener("keydown", (event) => {
    if (event.target !== card) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
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

// "Bineceği/ineceği durağa kadarki güzergah" seçimi (nearestPointIndex ile iki
// çapaya en yakın geometri noktaları arasını dilimlemek) bazı hatlarda TÜM
// hattı, hatta anlamsız yüzlerce km'yi çiziyordu (2026-09-24 denetimi: 1554
// bacağın 176'sı, %11). İki ayrı kök neden bulundu: (1) bazı hatların
// transit_network_geometry.json'daki şekli GERÇEKTEN bozuk/kopuk — ör. "159-5
// (ÖTA) ŞEREFLİKOÇHİSAR-ANKARA" şehirlerarası hattının şekli iki ayrı, 120+
// km'lik sıçramayla birbirine dikilmiş, tek dilim 426 km çiziyordu; (2) bazı
// hatlar (ör. 175, 110 — Bilkent-Beytepe döngüsü) gerçekten uzun/döngülü ve
// aynı bölgeden iki kez geçiyor, bu yüzden "en yakın nokta" biniş/iniş için
// döngünün YANLIŞ (uzak) geçişini eşleştirip aradaki koca döngüyü diliyordu.
// Her iki durumda da ortak, güvenilir bir belirti var: dilimlenen alt-dizinin
// İÇİNDE, ardışık iki geometri noktası arasında GERÇEKÇİ OLMAYAN büyük bir
// sıçrama oluyor (gerçek bir yol/GPS izinde ardışık şekil noktaları birkaç
// yüz metre arayla gelir, asla 3+ km sıçramaz). Bilinen DOĞRU rotalarda
// (Etlik→Medical Park, 261-6/480 — Google ile doğrulanmış) dilim içi en
// büyük sıçrama 0.74/0.36 km; denetimdeki 176 "kötü" bacağın 171'i de zaten
// yüksek çizilen/kuş-uçuşu oranına sahipti, yanlış pozitif ~1 vakaydı. Bu
// yüzden dilim içinde bu eşiği aşan bir sıçrama bulunursa, o geometriye
// GÜVENİLMEZ — dürüst bir kesikli/tahmini bağlantıya (bkz. "fallback" kind)
// düşülür, TÜM hat ya da yanlış bir döngü asla katı çizgiyle gösterilmez.
const MAX_GEOMETRY_JUMP_KM = 3;
function maxJumpKm(latlngs) {
  let m = 0;
  for (let i = 1; i < latlngs.length; i++) {
    const j = haversineKm({ lat: latlngs[i - 1][0], lng: latlngs[i - 1][1] }, { lat: latlngs[i][0], lng: latlngs[i][1] });
    if (j > m) m = j;
  }
  return m;
}
// Sıçrama kontrolü, veri BOZUK olduğunda (159-5 gibi) veya hat gerçekten iki
// noktayı görünmez bir dikişle birbirine bağladığında yakalıyor; ama bazı
// UZUN/DÖNGÜLÜ hatlarda (ör. 586) tek bir büyük sıçrama olmadan da "en yakın
// nokta" biniş/iniş çapasını hattın TAMAMEN YANLIŞ (fiziksel olarak yakın ama
// dizi içinde çok uzak) bir geçişiyle eşleştirip koca döngüyü diliyor —
// gerçek biniş yalnızca 0.1-1.4km iken çizilen 22-33km gibi. Bu yüzden ikinci,
// tamamlayıcı bir güvenlik ağı daha var: dilim, iki çapa arası düz mesafenin
// (crowKm) MAX_GEOMETRY_RATIO katından fazlaysa yine güvenilmez sayılır.
// Katsayı, bilinen DOĞRU rotanın (Etlik→Medical Park 261-6, oranı 6.2) asla
// yanlışlıkla elenmeyeceği ama denetimdeki bozuk 586 örneğinin (oranı 24)
// yakalanacağı şekilde (8x) seçildi; küçük mutlak mesafelerde (ör. crowKm
// 0.1km) oranın aşırı katı olmaması için 2km'lik bir taban da var.
const MAX_GEOMETRY_RATIO = 8;

// MAX_GEOMETRY_JUMP_KM/MAX_GEOMETRY_RATIO tek tek büyük sıçramaları ya da
// aşırı toplam oranı yakalıyor; ama bazı hatların ham geometrisi, biniş-iniş
// arasında BİRİKİMLİ küçük adımlarla aynı bölgeyi birkaç kez dolaşıyor (tek
// bir sıçrama 3km'yi hiç geçmiyor, toplam oran 8x'in altında kalıyor) — bu
// ikisi de o yüzden yakalayamıyor. 2026-09-25'te genel eşleştirme
// algoritmasını (nearestPointIndex'i durak sırasına/gerçek km oranına göre
// yönlendirme) düzeltmek için ÜÇ farklı yöntem denendi; üçü de bu spesifik
// örneği (208-4, Antares AVM civarı — rota AVM'nin içinden geçiyormuş gibi
// çiziliyordu) bir miktar düzeltirken, bu oturumda Google Haritalar'la
// doğrulanmış referans rotayı (Etlik→Medical Park, 261-6) bozdu (segment
// uzunluğu 0-1.6km arasına çöktü, olması gerekenin çok altında). Genel
// algoritmayı değiştirmenin regresyon riski, tek bir bilinen-bozuk örneği
// düzeltmenin faydasından ağır bastığı için o yol terk edildi (ayrıntı proje
// notlarında). Bunun yerine EN DAR kapsamlı çözüm: sadece BURADA, elle,
// kullanıcı tarafından doğrulanmış (hat, biniş durağı, iniş durağı) üçlüleri
// listele — bu tam üçlüye denk gelindiğinde geometriye hiç güvenilmez,
// doğrudan dürüst gri/kesikli "fallback" stiline düşülür. Başka HİÇBİR
// rotayı etkilemez (genel algoritma, guard'lar aynı kalıyor).
const UNRELIABLE_LINE_SEGMENTS = new Set([
  // 207 İVEDİK METRO-KARDEŞLER: bu 27 duraklı döngü hattının 71 noktalık
  // ham şekli tek bir düzgün tur değil — aynı "İVEDİK METRO" bölgesini
  // (~32.811-32.818 boylam arası) doğu-batı-doğu diye üç kez zikzaklayarak
  // geçen birden fazla sefer varyantı art arda eklenmiş gibi duruyor. Biniş
  // (25. durak, "İVEDİK METRO" — ilk 0. duraktan FARKLI bir geçiş) ile iniş
  // (26./son durak, "AHMET REFİK CD.") aslında dizinin SONUNA yakın olmalı,
  // ama "en yakın nokta" eşleşmesi ikisini de dizinin BAŞINDAKİ (index 2 ve
  // 10) yanlış zikzak parçasına kilitliyor — MAX_GEOMETRY_JUMP_KM/RATIO'yu
  // geçecek kadar küçük adımlarla (2026-09-25, kullanıcı raporu: 207 bacağı
  // binaların üzerinden düz çiziliyor).
  "ego_line_207|ego_21139|ego_22303",
]);
function isUnreliableLineSegment(step) {
  return Boolean(
    step.lineId &&
      step.fromStopId &&
      step.toStopId &&
      UNRELIABLE_LINE_SEGMENTS.has(`${step.lineId}|${step.fromStopId}|${step.toStopId}`)
  );
}

// "En yakın geometri noktası" ile iki çapa arasını dilimlemek, döngülü
// hatlarda (110, 175, 176, 207…) biniş/inişi hattın YANLIŞ geçişine
// kilitleyip 2 km'lik bir seferi 12 km'lik bir tur gibi çiziyordu. Google
// Haritalar o hattı durak sırasıyla çizer. Burada her durak çifti için,
// iki durağa yakın geometri noktaları arasından kuş uçuşuna yakın (ne
// kestirme, ne koca tur) EN KISA güvenilir parçayı seçiyoruz; geometri yoksa
// (metro/Ankaray'ın tamamı, otobüs hatlarının ~yarısı) durağın kendisini
// kullanıyoruz. Böylece çizgi, hattın gerçek durak sırasını takip eder.
function geometryCandidatesNear(geometry, stop, maxKm) {
  const scored = [];
  for (let i = 0; i < geometry.length; i++) {
    const km = haversineKm({ lat: geometry[i][0], lng: geometry[i][1] }, { lat: stop.lat, lng: stop.lng });
    if (km <= maxKm) scored.push({ i, km });
  }
  scored.sort((x, y) => x.km - y.km);
  // Geometri durağın tam üzerinden geçiyorsa (yol ağına oturtulmuş hatlar)
  // 350 m'lik aday, bir sonraki kavşağın noktasını "varış" sanıp dilimi erken
  // kesiyor ve durak koordinatına düz bir sıçrama bırakıyordu. 40 m içinde
  // nokta varsa çıpa sadece onlardır.
  const tight = scored.filter((s) => s.km <= 0.04);
  if (tight.length) return tight.slice(0, 4).map((s) => s.i);
  const out = scored.slice(0, 12).map((s) => s.i);
  if (!out.length) out.push(nearestPointIndex(geometry, stop));
  return out;
}

function shortGeometryBetween(geometry, a, b) {
  const hav = haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  const c1 = geometryCandidatesNear(geometry, a, 0.35);
  const c2 = geometryCandidatesNear(geometry, b, 0.35);
  let best = null;
  let bestKm = Infinity;
  c1.forEach((i) => {
    c2.forEach((j) => {
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      if (hi - lo > 400) return;
      const seg = geometry.slice(lo, hi + 1);
      if (seg.length < 2) return;
      const km = polylineKm(seg);
      if (maxJumpKm(seg) > MAX_GEOMETRY_JUMP_KM) return;
      if (km + 0.02 < hav * 0.9) return;
      if (km > Math.max(hav * 2.2, hav + 0.8)) return;
      if (km < bestKm) {
        bestKm = km;
        best = seg;
      }
    });
  });
  return best;
}

function orderedRideStopIds(step) {
  if (!step.lineId || !step.fromStopId || !step.toStopId || !transitGraph) return null;
  const line = transitGraph.linesByLocalId.get(step.lineId);
  if (!line || !line.stopIds) return null;
  const ids = line.stopIds;
  const a = ids.indexOf(step.fromStopId);
  const b = ids.indexOf(step.toStopId);
  if (a < 0 || b < 0 || a === b) return null;
  const ordered = [];
  if (a < b) {
    for (let i = a; i <= b; i++) ordered.push(ids[i]);
  } else {
    for (let i = a; i >= b; i--) ordered.push(ids[i]);
  }
  return ordered;
}

function stopCoordReliable(stop, rail) {
  if (!stop || typeof stop.lat !== "number") return false;
  if (rail) return true;
  return stop.coordSource !== "enterpolasyon" && stop.coordSource !== "ekstrapolasyon";
}

// Şekil dosyası olmayan uzun hatlarda (502 Kahramankazan gibi) ara duraklar
// düz çizgiyle doldurulmuş olabiliyor. Çizimde sadece güvenilir duraklar
// kalsın; araları OSRM yol geometrisiyle doldurulur.
function roadAnchorStops(step, rail) {
  const ordered = orderedRideStopIds(step);
  if (!ordered) return null;
  const anchors = [];
  ordered.forEach((id, index) => {
    const stop = transitGraph.stopsById.get(id);
    if (!stop || typeof stop.lat !== "number") return;
    const keep = index === 0 || index === ordered.length - 1 || stopCoordReliable(stop, rail);
    if (!keep) return;
    const prev = anchors[anchors.length - 1];
    if (prev && prev.id === stop.id) return;
    anchors.push(stop);
  });
  return anchors.length > 1 ? anchors : null;
}

function rideShapeLatLngs(step) {
  const ordered = orderedRideStopIds(step);
  if (!ordered) return null;
  const geo = localTransitGeometry && localTransitGeometry[step.lineId];
  const pts = [];
  const push = (lat, lng) => {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last[0] - lat) < 1e-7 && Math.abs(last[1] - lng) < 1e-7) return;
    pts.push([lat, lng]);
  };
  for (let i = 0; i < ordered.length; i++) {
    const stop = transitGraph.stopsById.get(ordered[i]);
    if (!stop || typeof stop.lat !== "number") return null;
    if (i > 0 && geo) {
      const prev = transitGraph.stopsById.get(ordered[i - 1]);
      const piece = shortGeometryBetween(geo, prev, stop);
      if (piece && piece.length > 1) {
        const start = { lat: piece[0][0], lng: piece[0][1] };
        const end = { lat: piece[piece.length - 1][0], lng: piece[piece.length - 1][1] };
        const forward = haversineKm({ lat: prev.lat, lng: prev.lng }, start) <= haversineKm({ lat: prev.lat, lng: prev.lng }, end);
        (forward ? piece : piece.slice().reverse()).forEach(([lat, lng]) => push(lat, lng));
      }
    }
    push(stop.lat, stop.lng);
  }
  return pts.length > 1 ? pts : null;
}

// Yürüyüş bacakları eskiden iki nokta arası DÜZ çizgiyle ("kuş uçuşu")
// çiziliyordu — kullanıcı haklı olarak "yürüyen kişi binaların üstünden mi
// atlayacak" diye sordu. transit_network.json'da yaya kaldırım/patika verisi
// yok, bu yüzden OSM'nin ücretsiz, API anahtarı gerektirmeyen, CORS'u açık
// (Access-Control-Allow-Origin: *) genel yaya rotalama sunucusu
// (routing.openstreetmap.de/routed-foot, FOSSGIS tarafından işletiliyor)
// kullanılıyor. Önce (çizim gecikmesi olmasın diye) her zamanki gibi düz
// çizgi hemen çizilir; gerçek sokak rotası gelince AYNI polyline/etiket
// nesnesi setLatLngs/setIcon ile YERİNDE güncellenir (yeniden çizmeye gerek
// yok). Sonuç ~50 durak/proje çiftine kadar önbelleğe alınır (aynı iki nokta
// arası tekrar tekrar istenmesin diye); istek başarısız olursa (çevrimdışı,
// zaman aşımı, sunucu kısıtlaması) sessizce düz çizgide kalınır — bu bir
// güvenlik ağı, uygulamanın çalışması buna bağımlı değil.
function fetchOsrmGeometry(profileUrlSegment, cache, a, b) {
  const key = `${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const url = `https://routing.openstreetmap.de/${profileUrlSegment}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = await res.json();
      const coords = data && data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates;
      if (!coords || coords.length < 2) return null;
      // OSRM [lng,lat] döner, Leaflet [lat,lng] bekler.
      return coords.map(([lng, lat]) => [lat, lng]);
    } catch (e) {
      return null;
    }
  })();
  cache.set(key, promise);
  return promise;
}
const walkGeometryCache = new Map();
function fetchWalkGeometry(a, b) {
  return fetchOsrmGeometry("routed-foot/route/v1/foot", walkGeometryCache, a, b);
}
// Gerçek geometrisi olmayan/güvenilmez bulunan otobüs-metro bacakları eskiden
// iki durak arası düz "kuş uçuşu" çizgiyle (binaların üstünden) tahmin
// ediliyordu — kullanıcı raporu, 207 hattının fallback'e düşen bacağı için.
// Yürüyüşteki AYNI mantık burada da uygulanıyor, sadece araç profili
// (routed-car) ile: aracın gerçekte hangi sokaktan gideceğini bilmiyoruz,
// ama en azından caddeleri takip eden MAKUL bir tahmin, binaları kesen düz
// bir çizgiden çok daha dürüst. Gösterilen süre/etiket buna bağlı DEĞİL
// (zaten kuş uçuşu mesafeye göre hesaplanıyor), sadece çizginin şekli düzelir.
const drivingGeometryCache = new Map();
function fetchDrivingGeometry(a, b) {
  return fetchOsrmGeometry("routed-car/route/v1/driving", drivingGeometryCache, a, b);
}
// Bir bacaktaki güvenilir durakları tek istekte yola oturtur. Ara durak
// sayısı fazlaysa 20'lik parçalara bölünür; parça başarısız olursa düz
// durak zinciri ekranda kalır.
const drivingPathCache = new Map();
function fetchDrivingPath(points) {
  if (!points || points.length < 2) return Promise.resolve(null);
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";");
  if (drivingPathCache.has(key)) return drivingPathCache.get(key);
  const promise = (async () => {
    const size = 20;
    const merged = [];
    for (let i = 0; i < points.length - 1; i += size - 1) {
      const chunk = points.slice(i, Math.min(points.length, i + size));
      if (chunk.length < 2) break;
      const loc = chunk.map((p) => `${p.lng},${p.lat}`).join(";");
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const url = `https://routing.openstreetmap.de/routed-car/route/v1/driving/${loc}?overview=full&geometries=geojson`;
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return null;
        const data = await res.json();
        const coords = data && data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates;
        if (!coords || coords.length < 2) return null;
        const latlngs = coords.map(([lng, lat]) => [lat, lng]);
        if (merged.length) latlngs.shift();
        merged.push(...latlngs);
      } catch (e) {
        return null;
      }
    }
    return merged.length > 1 ? merged : null;
  })();
  drivingPathCache.set(key, promise);
  return promise;
}
function setShapeLatLngs(poly, latlngs) {
  poly.setLatLngs(latlngs);
  if (poly._routeHalo) poly._routeHalo.setLatLngs(latlngs);
}
// Kopuk durak sırasında 15–30 km'lik sıçramalar var. Hepsini tek OSRM
// isteğine koyunca rota durakları ziyaret etmek için şehri turluyor.
// Kısa ardışık duraklar birlikte yola oturtulur; uzun sıçrama kendi
// başına, sadece iki ucu arasında, yola bağlanır.
const ROAD_SNAP_GROUP_MAX_KM = 8;
async function snapAnchorsToRoads(anchors) {
  if (!anchors || anchors.length < 2) return null;
  const groups = [];
  let current = [anchors[0]];
  for (let i = 1; i < anchors.length; i++) {
    const hop = haversineKm(anchors[i - 1], anchors[i]);
    if (hop > ROAD_SNAP_GROUP_MAX_KM) {
      if (current.length >= 2) groups.push(current);
      groups.push([anchors[i - 1], anchors[i]]);
      current = [anchors[i]];
    } else {
      current.push(anchors[i]);
    }
  }
  if (current.length >= 2) groups.push(current);
  const merged = [];
  for (const group of groups) {
    const road = await fetchDrivingPath(group);
    const part = road || group.map((s) => [s.lat, s.lng]);
    if (merged.length && part.length) part.shift();
    merged.push(...part);
  }
  return merged.length > 1 ? merged : null;
}

/**
 * Rotayı, mümkün olduğunca hatların OSM'den alınan gerçek geometrisini
 * (yol/ray şeklini) takip ederek çizer. Her bacak kendi rengiyle/gerçek
 * güzergahıyla ayrı bir segment olarak çizilir; gerçek geometrisi olmayan
 * (canlı keşfedilmiş ya da TAHMİNİ) hatlar için düz kesikli çizgiye döner.
 */
// Bir drawRoute() çağrısı sürerken (yürüyüş rotası sorgusu ~saniyeler
// alabilir) kullanıcı başka bir projeye tıklayıp YENİ bir drawRoute()
// başlatırsa, eski çağrının gecikmiş fetchWalkGeometry sonucu artık ekranda
// olmayan/başka bir rotaya ait bir polyline'ı güncellemeye çalışmasın diye
// her çağrı kendi "jeton"unu taşır; sonuç geldiğinde jeton hâlâ güncel
// değilse sessizce yok sayılır.
let routeDrawToken = 0;

// Rota çizgisi ve rota pinleri routesLayer'dadır. Proje pinleri
// projectMarkersGroup içinde kalır; clearRouteLayers onlara dokunmaz.
function setBackgroundMarkersVisible(visible) {
  if (visible) {
    if (!map.hasLayer(projectCluster)) map.addLayer(projectCluster);
    if (!map.hasLayer(markersLayer)) map.addLayer(markersLayer);
  } else {
    if (map.hasLayer(projectCluster)) map.removeLayer(projectCluster);
    if (map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
  }
}

function clearRouteLayers() {
  routesLayer.clearLayers();
}

const osrmRouteCache = new Map();
function fetchProjectOsrmLatLngs(a, b) {
  if (!a || !b || typeof a.lat !== "number" || typeof b.lat !== "number") return Promise.resolve(null);
  const key = `${a.lng.toFixed(5)},${a.lat.toFixed(5)};${b.lng.toFixed(5)},${b.lat.toFixed(5)}`;
  if (osrmRouteCache.has(key)) return osrmRouteCache.get(key);
  const promise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = await res.json();
      const coords = data && data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates;
      if (!coords || coords.length < 2) return null;
      return coords.map((coord) => [coord[1], coord[0]]);
    } catch (e) {
      return null;
    }
  })();
  osrmRouteCache.set(key, promise);
  return promise;
}

function drawOsrmRoute(a, b, options) {
  const opts = options || {};
  const weight = opts.weight == null ? 5 : opts.weight;
  const opacity = opts.opacity == null ? 1 : opts.opacity;
  const color = opts.color || "#1a56db";
  const placeholder = [[a.lat, a.lng], [b.lat, b.lng]];
  const halo = L.polyline(placeholder, {
    color: "#ffffff",
    weight: 8,
    opacity: 0.95,
    lineJoin: "round",
    lineCap: "round",
    interactive: false,
  }).addTo(routesLayer);
  const line = L.polyline(placeholder, {
    color,
    weight,
    opacity,
    lineJoin: "round",
    lineCap: "round",
  }).addTo(routesLayer);
  if (opts.tooltip) line.bindTooltip(opts.tooltip, { sticky: true });
  fetchProjectOsrmLatLngs(a, b).then((latlngs) => {
    if (!latlngs) return;
    if (opts.token != null && opts.token !== routeDrawToken) return;
    if (!routesLayer.hasLayer(line)) return;
    halo.setLatLngs(latlngs);
    line.setLatLngs(latlngs);
    if (opts.onUpdate) opts.onUpdate();
  });
  return line;
}

function drawRoute(originCoords, row, bucket, destCoordsOverride) {
  clearRouteLayers();
  routeDrawToken += 1;
  const myToken = routeDrawToken;
  const destCoords = destCoordsOverride || { lat: row.project.lat, lng: row.project.lng };
  const steps = row.steps || [];
  if (steps.length === 0) return;

  function stopCoord(id) {
    if (!id || !transitGraph) return null;
    const stop = transitGraph.stopsById.get(id);
    if (!stop || typeof stop.lat !== "number") return null;
    return { lat: stop.lat, lng: stop.lng };
  }

  const legs = steps.map((step) => ({
    step,
    from: stopCoord(step.fromStopId),
    to: stopCoord(step.toStopId),
  }));
  let cursor = originCoords;
  legs.forEach((leg, index) => {
    if (!leg.from) leg.from = cursor;
    if (!leg.to) {
      const next = legs[index + 1];
      leg.to = (next && next.from) || (index === legs.length - 1 ? destCoords : cursor);
    }
    cursor = leg.to;
  });

  function fitRouteBounds() {
    if (myToken !== routeDrawToken) return;
    if (!routesLayer.getLayers().length) return;
    const bounds = routesLayer.getBounds();
    if (!bounds.isValid()) return;
    bounds.extend([originCoords.lat, originCoords.lng]);
    bounds.extend([destCoords.lat, destCoords.lng]);
    map.fitBounds(bounds, { padding: [50, 50], animate: false });
  }

  legs.forEach((leg) => {
    const step = leg.step;
    const isWalk = (step.mode === "hub" || !step.lineId) && !step.approx;
    const tooltip = `${MODE_ICON[step.mode] || ""} ${step.line}`;
    if (isWalk) {
      L.polyline([[leg.from.lat, leg.from.lng], [leg.to.lat, leg.to.lng]], {
        color: "#4285F4",
        weight: 4,
        opacity: 1,
        dashArray: "5, 10",
        lineJoin: "round",
        lineCap: "round",
      }).bindTooltip(tooltip, { sticky: true }).addTo(routesLayer);
      return;
    }
    const board = stopCoord(step.fromStopId) || leg.from;
    const alight = stopCoord(step.toStopId) || leg.to;
    drawOsrmRoute(board, alight, {
      weight: 6,
      opacity: 0.8,
      color: "#1a56db",
      tooltip,
      token: myToken,
      onUpdate: fitRouteBounds,
    });
  });

  L.circleMarker([originCoords.lat, originCoords.lng], {
    radius: 6,
    color: "#1a56db",
    weight: 3,
    fillColor: "#ffffff",
    fillOpacity: 1,
  }).bindTooltip("Aday", { direction: "top" }).addTo(routesLayer);

  const rideLegs = legs.filter((leg) => leg.step.lineId);
  rideLegs.forEach((leg, index) => {
    if (index === 0) return;
    const at = leg.from;
    L.circleMarker([at.lat, at.lng], {
      radius: 5,
      color: "#1a56db",
      weight: 3,
      fillColor: "#ffffff",
      fillOpacity: 1,
    }).bindTooltip("Aktarma", { direction: "top" }).addTo(routesLayer);
  });

  const destIcon = L.divIcon({ className: "", html: `<div class="pin pin-dest-flag"></div>`, iconSize: [26, 26], iconAnchor: [13, 26] });
  const destLabel = row.project ? row.project.name : row.district ? row.district.name : "Proje";
  L.marker([destCoords.lat, destCoords.lng], { icon: destIcon }).bindTooltip(destLabel, { direction: "top" }).addTo(routesLayer);

  activeBoardMarker = null;
  const board = firstBoardContext(row);
  if (board && board.stop && typeof board.stop.lat === "number") {
    const staticResult = { source: "static", estimatedWaitMin: board.fallbackWaitMin };
    const marker = L.circleMarker([board.stop.lat, board.stop.lng], {
      radius: 8,
      color: "#047857",
      weight: 3,
      fillColor: "#ffffff",
      fillOpacity: 1,
    }).addTo(routesLayer);
    marker.bindTooltip(`${board.stop.name} · biniş`, { direction: "top" });
    marker.bindPopup(liveArrivalHtml(board, staticResult, row.durationMin), { maxWidth: 280 });
    activeBoardMarker = marker;
    if (window.LiveBus) {
      LiveBus.getLiveBusArrival(board.stopId, board.line.id, {
        hatNo: board.hatNo,
        fallbackWaitMin: board.fallbackWaitMin,
      }).then((result) => {
        if (myToken !== routeDrawToken || activeBoardMarker !== marker) return;
        const activeCard = document.querySelector(".result-card-active");
        if (activeCard) applyLiveArrival(activeCard, row, result);
        else marker.setPopupContent(liveArrivalHtml(board, result, adjustedTripMinutes(row, board, result)));
      });
    }
  }

  fitRouteBounds();
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

  const alt = estimate.dolmusAlternative;
  routeDolmusAlt.classList.toggle("hidden", !alt);
  if (alt) {
    routeDolmusAlt.innerHTML = `
      <div class="text-[11px] font-semibold text-amber-700 uppercase tracking-wide mb-1.5">
        🚐 Dolmuşla alternatif · ~${alt.durationMin} dk (${alt.savingMin} dk daha hızlı)
      </div>
      <div class="text-[10px] text-slate-400 mb-1.5">
        Gayriresmi/kooperatif işletmeciler tarafından çalıştırılır, EGO'ya kayıtlı değildir — sefer sıklığı/güzergah İK tarafından adaya kesin bilgi gibi aktarılmamalıdır.
      </div>
      ${renderRouteSteps(alt.steps)}`;
  } else {
    routeDolmusAlt.innerHTML = "";
  }

  routeDetail.classList.remove("hidden");
  // Sonuç listesi uzun olduğunda (ör. onlarca proje) kullanıcı ortadan/alttan
  // bir karta tıklayınca rota detayı listenin ÜSTÜNDE render edildiği için
  // görünmüyordu — kullanıcı manuel yukarı kaydırmak zorunda kalıyordu.
  // Panel her gösterildiğinde otomatik olarak görünür alana kaydırılır.
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
// checkbox'lar bu görüntüyle kıyaslanır — canlı ANKARA_DATA.projects ile DEĞİL,
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
        <span>${p.name} <span class="text-slate-400">— ${p.address}</span></span>
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
  const sorted = [...ANKARA_DATA.projects].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  inactiveModalBaseline = new Map(sorted.map((p) => [p.id, Boolean(p.active)]));
  inactiveModalList.innerHTML = sorted
    .map(
      (p) => `
      <label class="urgent-modal-row">
        <input type="checkbox" value="${p.id}" ${!INACTIVE_PROJECT_IDS.has(p.id) ? "checked" : ""} />
        <span>${p.name} <span class="text-slate-400">— ${p.address}</span></span>
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
  const changed = ANKARA_DATA.projects.filter((p) => (inactiveModalBaseline.get(p.id) ?? Boolean(p.active)) !== activeIds.has(p.id));
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
// proje eklendikten sonraki hal) değiştirir: ANKARA_DATA.projects'i günceller,
// türetilmiş setleri/harita pinlerini/dropdown'ı yeniden kurar ve artık
// güncelliğini yitirmiş olabilecek rota tahminlerini (TransitCache) temizler.
function applyLiveProjects(projects) {
  ANKARA_DATA.projects.length = 0;
  projects.forEach((p) => ANKARA_DATA.projects.push(p));
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

const editProjectModal = document.getElementById("editProjectModal");
const editProjectForm = document.getElementById("editProjectForm");
const editProjectStatus = document.getElementById("editProjectStatus");
const editProjectSubmit = document.getElementById("editProjectSubmit");
let editingProjectId = null;

function closeEditProjectModal() {
  editProjectModal.classList.add("hidden");
  editingProjectId = null;
}

function openEditProjectModal(projectId) {
  const project = ANKARA_DATA.projects.find((row) => row.id === projectId);
  if (!project || !editProjectForm) return;
  editingProjectId = projectId;
  editProjectForm.elements.name.value = project.name || "";
  editProjectForm.elements.address.value = project.address || "";
  editProjectForm.elements.salary.value = project.salary || "";
  editProjectStatus.textContent = "";
  editProjectModal.classList.remove("hidden");
  editProjectForm.elements.name.focus();
}

function refreshProjectViews() {
  stopApproxCoordsCache = null;
  recomputeUrgentInactiveSets();
  rebuildAllProjectMarkers();
  rebuildProjectSelect();
  if (typeof populateCandidateFsProjectSelect === "function") populateCandidateFsProjectSelect();
  saveProjectsCache();
  if (typeof TransitCache !== "undefined" && TransitCache.clearAll) TransitCache.clearAll();
  runSearch();
}

async function deleteProjectById(projectId) {
  const project = ANKARA_DATA.projects.find((row) => row.id === projectId);
  if (!project) return;
  if (!window.confirm(`"${project.name}" silinsin mi?`)) return;
  try {
    const result = await postToSheet({ action: "delete", id: project.id, title: project.name });
    if (!result || result.ok === false) {
      window.alert("Proje silinemedi. Kayıt bu bölgenin veritabanında yok.");
      return;
    }
    ANKARA_DATA.projects = ANKARA_DATA.projects.filter((row) => row.id !== project.id);
    if (projectSelect.value === project.id) projectSelect.value = "";
    refreshProjectViews();
  } catch (err) {
    console.error(err);
    window.alert("Proje silinemedi — bağlantıyı kontrol edip tekrar dene.");
  }
}

document.getElementById("editProjectClose").addEventListener("click", closeEditProjectModal);
document.getElementById("editProjectCancel").addEventListener("click", closeEditProjectModal);
editProjectModal.addEventListener("click", (event) => {
  if (event.target === editProjectModal) closeEditProjectModal();
});

editProjectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const project = ANKARA_DATA.projects.find((row) => row.id === editingProjectId);
  if (!project) return;
  const name = editProjectForm.elements.name.value.trim();
  const address = editProjectForm.elements.address.value.trim();
  const salary = editProjectForm.elements.salary.value.trim();
  if (!name || !address) return;
  const patch = { name, address, salary };
  editProjectSubmit.disabled = true;
  editProjectStatus.textContent = address === (project.address || "") ? "Kaydediliyor…" : "Adres konumu bulunuyor…";
  try {
    if (address !== (project.address || "")) {
      const geo = await geocodeAddress(address);
      if (!geo) {
        editProjectStatus.textContent = "Konum bulunamadı. Adresi biraz daha netleştirip tekrar dene.";
        return;
      }
      const stop = nearestTransitStop(geo.lat, geo.lng);
      patch.lat = geo.lat;
      patch.lng = geo.lng;
      patch.accessStopId = stop ? stop.id : "";
    }
    const { updatedIds } = await postBatchUpdate([{ id: project.id, patch }]);
    if (!updatedIds.has(project.id)) {
      editProjectStatus.textContent = "Kayıt veritabanında bulunamadı.";
      return;
    }
    Object.assign(project, patch);
    refreshProjectViews();
    closeEditProjectModal();
  } catch (err) {
    console.error(err);
    editProjectStatus.textContent = "Kaydedilemedi — bağlantıyı kontrol edip tekrar dene.";
  } finally {
    editProjectSubmit.disabled = false;
  }
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
    ANKARA_DATA.projects.push(project);
    stopApproxCoordsCache = null;
    recomputeUrgentInactiveSets();
    buildProjectMarker(project);
    rebuildProjectSelect();
    saveProjectsCache();
    closeAddProjectModal();
    if (currentMode === "origin-to-project") runSearch();
  } catch (err) {
    addProjectStatus.textContent = "Kaydedilemedi — internet bağlantısını kontrol edip tekrar dene.";
  } finally {
    addProjectSubmit.disabled = false;
  }
});

/**
 * Seçilen şirketin bölgesini haritaya ve rota motoruna uygular.
 * Hatlar ve noktalar çağıran tarafta company_id + region_id ile çekilmiş olmalı.
 */
function applySupabaseRegion(bundle) {
  window.usingSupabaseTenant = true;
  const region = bundle.region || {};
  ANKARA_DATA.projects = (bundle.projects || []).map(normalizeProjectRecord);
  ANKARA_DATA.districts = bundle.districts || [];
  ANKARA_DATA.transitStops = bundle.transitStops || [];
  ANKARA_DATA.transitLines = bundle.transitLines || [];
  ANKARA_DATA.hubStopIds = bundle.hubStopIds || [];
  ANKARA_DATA.urgentProjectIds = ANKARA_DATA.projects.filter((p) => p.urgent).map((p) => p.id);
  stopApproxCoordsCache = null;
  recomputeUrgentInactiveSets();
  rebuildTransitIndexes();
  rebuildAllProjectMarkers();
  rebuildOriginSelect();
  rebuildPositionFilters();
  rebuildProjectSelect();
  TransitCache.clearAll();
  routesLayer.clearLayers();
  const subtitle = document.getElementById("moduleSubtitle");
  if (subtitle) subtitle.textContent = `İK saha personeli işe alım — ${region.name || "bölge"}`;
  if (region.center_lat != null && region.center_lng != null) {
    map.setView([Number(region.center_lat), Number(region.center_lng)], 11);
  }
  installTransitNetwork(bundle.network || { stops: [], lines: [] }, { silent: true });
  if (window.CandidateStore && typeof CandidateStore.bindRegion === "function") {
    CandidateStore.bindRegion(region.slug);
    if (bundle.candidates && bundle.candidates.length && CandidateStore.all().length === 0) {
      CandidateStore.upsertBatch(bundle.candidates);
    }
  }
  if (currentMode === "origin-to-project" && !originSelect.value) renderProjectCatalog();
  else runSearch();
  refreshMapLayout();
}

// İlk yükleme. Supabase ayarı varsa tenant.js bölgeyi çeker;
// yoksa eski Sheet/yerel ağ yedeği devreye girer.
renderProjectCatalog();
if (!window.SUPABASE_CONFIG) loadLiveProjects();
