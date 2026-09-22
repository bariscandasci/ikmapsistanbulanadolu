/**
 * ADAY VERİTABANI — Excel yükleme, sütun eşleme, telefon bazlı tekilleştirme
 * ve seçilen bir projeye göre gerçek adayları sıralayan skorlama motoru.
 *
 * Bu dosya app.js'ten SONRA yüklenir (classic script, aynı global scope) ve
 * app.js'in gerçek graf tabanlı rota motorunu (getTransitEstimate) olduğu
 * gibi kullanır — mesafe/süre hesaplaması burada TEKRAR YAZILMAZ.
 *
 * DEPOLAMA: Şu an yalnızca localStorage (CandidateStore) kullanılıyor — proje
 * verisindeki gibi (Google Sheets) ekip genelinde paylaşımlı DEĞİL, sadece bu
 * tarayıcıda kalıcı. Paylaşımlı hale getirmek istenirse CandidateStore'un
 * _load/_save/upsertBatch metodları bir Apps Script Web App'ine (projelerdeki
 * postToSheet/postBatchUpdate deseniyle aynı) bağlanacak şekilde değiştirilir;
 * geri kalan tüm mantık (dedup, skorlama, UI) aynı kalır.
 */

// ---------------------------------------------------------------------------
// 1) VERİ MODELİ + DEPOLAMA (localStorage)
// ---------------------------------------------------------------------------

const CANDIDATE_STORE_KEY = "ist_ulasim_candidates_v1";

/** Telefonu 10 haneli GSM biçimine indirger (0/+90 önekleri atılır) — dedup anahtarı bu. */
function normalizePhone(raw) {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return digits;
}

/**
 * Aynı telefonla ikinci kez yüklenen bir adayı MEVCUT kayda birleştirir:
 * - Boş olmayan yeni alanlar eskiyi ezer (daha güncel bilgi kabul edilir).
 * - sektörDeneyimi/sertifikalar birleştirilir (küme/union), kaybolmaz.
 * - appliedAt (başvuru tarihi) en ESKİSİ tutulur — "ilk ne zaman başvurdu" anlamlı olan budur.
 * - uploadedAt her zaman en YENİSİ olur — "en son ne zaman görüldü" için.
 * - Adres metni değiştiyse önceden çözülmüş koordinat/ilçe eşleşmesi GEÇERSİZ kılınır
 *   (aksi halde eski konuma göre skorlanmaya devam ederdi).
 */
function mergeCandidateInto(existing, incoming) {
  const merged = { ...existing };
  if (incoming.fullName) merged.fullName = incoming.fullName;
  if (incoming.phoneRaw) merged.phoneRaw = incoming.phoneRaw;
  if (incoming.age != null) merged.age = incoming.age;
  if (incoming.gender) merged.gender = incoming.gender;
  if (incoming.sectorExperience && incoming.sectorExperience.length) {
    merged.sectorExperience = Array.from(new Set([...(existing.sectorExperience || []), ...incoming.sectorExperience]));
  }
  if (incoming.certificates && incoming.certificates.length) {
    merged.certificates = Array.from(new Set([...(existing.certificates || []), ...incoming.certificates]));
  }
  if (incoming.appliedAt && (!existing.appliedAt || incoming.appliedAt < existing.appliedAt)) {
    merged.appliedAt = incoming.appliedAt;
  }
  merged.uploadedAt = incoming.uploadedAt;
  if (incoming.source && !(existing.mergedSources || []).includes(incoming.source)) {
    merged.mergedSources = [...(existing.mergedSources || []), incoming.source];
  }
  if (incoming.addressText && incoming.addressText !== existing.addressText) {
    merged.addressText = incoming.addressText;
    merged.coords = null;
    merged.districtId = null;
    merged.neighborhoodId = null;
    merged.coordsSource = null;
  }
  return merged;
}

const CandidateStore = {
  _mem: null,
  _load() {
    if (this._mem) return this._mem;
    try {
      this._mem = JSON.parse(localStorage.getItem(CANDIDATE_STORE_KEY) || "[]");
    } catch {
      this._mem = [];
    }
    // Tek seferlik onarım: eski bir sürümde "Yaş" sütunu bazen doğum tarihi
    // sütunuyla eşleşip Excel'in seri tarih sayısı (ör. 27312) olduğu gibi
    // yaş olarak kaydedilmişti (bkz. deriveAge). Zaten diskte duran kayıtları
    // burada, sayfa her yüklendiğinde sessizce onarır.
    let repaired = false;
    this._mem.forEach((c) => {
      if (c.age != null && (c.age < 14 || c.age > 100)) {
        c.age = repairImplausibleAgeValue(c.age);
        repaired = true;
      }
    });
    if (repaired) this._save();
    return this._mem;
  },
  _save() {
    try {
      localStorage.setItem(CANDIDATE_STORE_KEY, JSON.stringify(this._mem || []));
    } catch {
      /* localStorage kullanılamıyorsa (ör. gizli sekme) sessizce yoksay */
    }
  },
  all() {
    return this._load();
  },
  /** resolveCandidateCoords tarafından yeni çözülen konumları diske yazmak için. */
  save() {
    this._save();
  },
  /** newOnes: buildCandidateFromRow() çıktısı dizisi. Dönüş: {added, merged}. */
  upsertBatch(newOnes) {
    const list = this._load();
    const byId = new Map(list.map((c) => [c.id, c]));
    let added = 0;
    let merged = 0;
    newOnes.forEach((c) => {
      if (!c.id) return;
      if (byId.has(c.id)) {
        byId.set(c.id, mergeCandidateInto(byId.get(c.id), c));
        merged += 1;
      } else {
        byId.set(c.id, c);
        added += 1;
      }
    });
    this._mem = Array.from(byId.values());
    this._save();
    return { added, merged };
  },
  clear() {
    this._mem = [];
    this._save();
  },
};

// ---------------------------------------------------------------------------
// 2) EXCEL PARSE + SÜTUN EŞLEME
// ---------------------------------------------------------------------------

const CANDIDATE_FIELDS = [
  { key: "fullName", label: "Ad Soyad", required: true },
  { key: "phone", label: "Telefon", required: true },
  { key: "addressText", label: "Adres / İlçe-Mahalle", required: true },
  { key: "age", label: "Yaş", required: false },
  { key: "gender", label: "Cinsiyet", required: false },
  { key: "sectorExperience", label: "Sektör Deneyimi", required: false },
  { key: "certificates", label: "Sertifika / Belge", required: false },
  { key: "source", label: "Kaynak (Eleman.net/Kariyer.net...)", required: false },
  { key: "appliedAt", label: "Başvuru Tarihi", required: false },
];

const CANDIDATE_FIELD_KEYWORDS = {
  fullName: ["ad soyad", "adı soyadı", "isim", "ad ", "name"],
  phone: ["telefon", "gsm", "cep", "phone", "tel"],
  addressText: ["adres", "ilçe", "ilce", "mahalle", "semt"],
  age: ["yaş", "yas", "age", "doğum", "dogum"],
  gender: ["cinsiyet", "gender"],
  sectorExperience: ["sektör", "sektor", "deneyim", "tecrübe", "tecrube"],
  certificates: ["sertifika", "belge"],
  source: ["kaynak", "site", "kanal", "platform"],
  appliedAt: ["başvuru", "basvuru", "tarih", "date"],
};

function guessColumnForField(fieldKey, headers) {
  const keywords = CANDIDATE_FIELD_KEYWORDS[fieldKey] || [];
  const normHeaders = headers.map((h) => h.toLocaleLowerCase("tr"));
  for (const kw of keywords) {
    const idx = normHeaders.findIndex((h) => h.includes(kw));
    if (idx !== -1) return idx;
  }
  return -1;
}

function cellAt(row, idx) {
  if (idx == null || idx < 0) return "";
  return String(row[idx] ?? "").trim();
}

/**
 * Excel'in seri tarih sayısını ya da serbest metin bir tarihi ISO string'e
 * çevirir; olmazsa null. GG.AA.YYYY / GG/AA/YYYY / GG-AA-YYYY (Türkçe/Avrupa
 * sırası — gün önce) formatı AÇIKÇA ayrıca destekleniyor, çünkü JS'in yerleşik
 * Date ayrıştırıcısı "15.03.1990" gibi noktalı tarihleri hiç tanımıyor
 * (Invalid Date), "15/03/1990" gibi eğik çizgili olanları ise ABD sırasıyla
 * (AA/GG/YYYY) okumaya çalışıp gün>12 olduğunda sessizce yanlış/Invalid
 * sonuç veriyor.
 */
function parseFlexibleDate(raw) {
  if (!raw) return null;
  const str = String(raw).trim();

  if (/^\d+$/.test(str)) {
    const asNum = Number(str);
    if (asNum > 20000 && asNum < 60000) {
      const epoch = Date.UTC(1899, 11, 30);
      return new Date(epoch + asNum * 86400000).toISOString();
    }
  }

  const dmy = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    if (!isNaN(d.getTime())) return d.toISOString();
    return null;
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Diskte zaten duran, mantıksız bir yaş değerini (bkz. CandidateStore._load) onarmayı dener. */
function repairImplausibleAgeValue(badAge) {
  if (badAge > 1000) {
    const epoch = Date.UTC(1899, 11, 30);
    const birth = new Date(epoch + badAge * 86400000);
    if (!isNaN(birth.getTime())) {
      const age = ageFromBirthDateIso(birth.toISOString());
      if (age != null && age >= 14 && age <= 100) return age;
    }
  }
  return null; // onarılamadı — yanlış bir sayı göstermektense boş bırak
}

function ageFromBirthDateIso(iso) {
  const birth = new Date(iso);
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear = now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

/**
 * "Yaş" olarak eşlenen sütun bazen doğrudan bir yaş sayısı değil, bir doğum
 * tarihi olabilir (ör. kaynak Excel'de "Yaş" diye etiketlenmiş ama içinde
 * "15.03.1990" ya da Excel'in kendi seri tarih sayısı — 27312 gibi — var).
 * Önce makul bir yaş (14-100) olup olmadığına bakılır; değilse tarih olarak
 * yorumlanıp yaşa çevrilir. İkisi de tutmazsa null (uydurma bir sayı
 * göstermektense boş bırakmak daha doğru).
 */
function deriveAge(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  // SADECE dizinin tamamı rakamsa doğrudan yaş olarak kabul edilir — aksi
  // halde parseInt("15.03.1990") gibi bir tarihin baştaki "15"ini sessizce
  // (yanlışlıkla) geçerli bir yaşmış gibi kabul ederdi.
  if (/^\d{1,3}$/.test(trimmed)) {
    const asInt = parseInt(trimmed, 10);
    if (asInt >= 14 && asInt <= 100) return asInt;
  }
  const iso = parseFlexibleDate(trimmed);
  if (iso) {
    const age = ageFromBirthDateIso(iso);
    if (age != null && age >= 14 && age <= 100) return age;
  }
  return null;
}

function buildCandidateFromRow(row, mapping, uploadedAt) {
  const fullName = cellAt(row, mapping.fullName);
  const phoneRaw = cellAt(row, mapping.phone);
  const phone = normalizePhone(phoneRaw);
  const addressText = cellAt(row, mapping.addressText);
  const age = deriveAge(cellAt(row, mapping.age));
  const genderNorm = cellAt(row, mapping.gender).toLocaleLowerCase("tr");
  const gender = genderNorm.startsWith("k") ? "Kadın" : genderNorm.startsWith("e") ? "Erkek" : null;
  const sectorExperience = cellAt(row, mapping.sectorExperience)
    .split(/[,/;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const certificates = cellAt(row, mapping.certificates)
    .split(/[,/;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const source = cellAt(row, mapping.source);
  const appliedAt = parseFlexibleDate(cellAt(row, mapping.appliedAt));

  return {
    id: phone ? `cand_${phone}` : null,
    fullName,
    phone,
    phoneRaw,
    addressText,
    districtId: null,
    neighborhoodId: null,
    coords: null,
    coordsSource: null,
    age,
    gender,
    sectorExperience,
    certificates,
    source,
    appliedAt,
    uploadedAt,
    // KVKK veri saklama süresi için ileride kullanılacak alan — şimdilik
    // hiçbir işlevi yok (otomatik silme/uyarı YAPILMIYOR), sadece şema hazır.
    retentionUntil: null,
    mergedSources: source ? [source] : [],
  };
}

// ---------------------------------------------------------------------------
// 3) ADAY KONUMU ÇÖZÜMLEME (ilçe/mahalle eşleşmesi -> gerekirse geocode)
// ---------------------------------------------------------------------------

/** Adres metnini bilinen ilçe/mahalle adlarıyla eşleştirir — ağ isteği yok, anında. */
function matchDistrictOrNeighborhood(text) {
  if (!text) return null;
  const norm = text.toLocaleLowerCase("tr");
  for (const d of ISTANBUL_DATA.districts) {
    for (const n of d.neighborhoods || []) {
      if (norm.includes(n.name.toLocaleLowerCase("tr"))) {
        return { districtId: d.id, neighborhoodId: n.id, coords: { lat: n.lat, lng: n.lng } };
      }
    }
  }
  for (const d of ISTANBUL_DATA.districts) {
    if (norm.includes(d.name.toLocaleLowerCase("tr"))) {
      return { districtId: d.id, neighborhoodId: null, coords: { lat: d.lat, lng: d.lng } };
    }
  }
  return null;
}

// resolveCandidateCoords bir adayı yeni çözünce true'ya çekilir; ilgili
// puanlama turu (rankCandidatesForProject/runBatchMatch) bitince bu
// bayrağa bakıp CandidateStore'u DİSKE YAZAR — böylece bir adayın konumu
// artık SADECE İLK KEZ (hangi projeye bakılırsa bakılsın, sayfa yeniden
// yüklense bile) çözülüyor; öncesinde candidate.coords sadece bellekte
// tutulduğu için her proje değişiminde/yenilemede aynı yüzlerce adaylık
// geocode maliyeti baştan ödeniyordu.
let candidateCoordsDirty = false;
function flushCandidateCoordsIfDirty() {
  if (!candidateCoordsDirty) return;
  CandidateStore.save();
  candidateCoordsDirty = false;
}

/**
 * Aday konumunu tembel (lazy) olarak çözer: önce bilinen ilçe/mahalle adı
 * eşleşmesi (anında), yoksa Nominatim geocode (ağ isteği, cache'li ve artık
 * saniyede ~1 isteğe sınırlı — bkz. app.js geocodeAddress). Sadece sıralama
 * sırasında, ihtiyaç oldukça çağrılır — yüzlerce adaylık bir Excel'i içe
 * aktarırken hepsini toptan geocode etmeye ÇALIŞMIYORUZ (kullanıcının hiç
 * bakmayacağı projeler için bile gereksiz ağ isteği atmamak için).
 */
async function resolveCandidateCoords(candidate) {
  if (candidate.coords) return candidate.coords;
  const match = matchDistrictOrNeighborhood(candidate.addressText);
  if (match) {
    candidate.districtId = match.districtId;
    candidate.neighborhoodId = match.neighborhoodId;
    candidate.coords = match.coords;
    candidate.coordsSource = "ilce-eslesme";
    candidateCoordsDirty = true;
    return candidate.coords;
  }
  try {
    const geo = await geocodeAddress(candidate.addressText);
    if (geo) {
      candidate.coords = { lat: geo.lat, lng: geo.lng };
      candidate.coordsSource = "geocode";
      candidateCoordsDirty = true;
      return candidate.coords;
    }
  } catch {
    /* geocode başarısız oldu, konum belirlenemedi olarak bırak */
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4) SKORLAMA MOTORU — sert filtreler + ağırlıklı puan
// ---------------------------------------------------------------------------

const CANDIDATE_SCORE_WEIGHTS = { proximity: 40, transfers: 15, experience: 25, ageFit: 20 };
const CANDIDATE_SCORE_LABELS = { proximity: "Yakınlık", transfers: "Aktarma", experience: "Deneyim", ageFit: "Yaş uygunluğu" };

// ---------------------------------------------------------------------------
// AI YARDIMCI KATMANI — üç özellik de (eşleşme gerekçesi, doğal dil filtre,
// sütun eşleştirme önerisi) tek genel amaçlı Apps Script ucunu (action:
// "aiComplete", bkz. Code.gs) kullanır. API anahtarı sadece Apps Script
// tarafında tutulur, istemciye hiç gelmez.
// ---------------------------------------------------------------------------

async function callAI(system, prompt, maxTokens) {
  const data = await postToSheet({ action: "aiComplete", system, prompt, maxTokens: maxTokens || 400 });
  return data.text || "";
}

/** Model çıktısında JSON'dan önce/sonra açıklama metni gelse bile ilk {...} bloğunu ayıklar. */
function extractJsonBlock(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI geçerli bir JSON döndürmedi");
  return JSON.parse(match[0]);
}

// Proje bazlı bir yaş aralığı tanımlanmamışsa (bkz. AÇIK KARAR: proje
// şemasında henüz ageRange alanı yok) bu genel varsayım kullanılır.
const CANDIDATE_DEFAULT_AGE_RANGE = { min: 22, max: 45 };

function scoreProximity(durationMin) {
  const FULL_AT = 20; // dk, bu ve altı tam puan
  const ZERO_AT = 90; // dk, bu ve üstü 0 puan
  if (durationMin <= FULL_AT) return CANDIDATE_SCORE_WEIGHTS.proximity;
  if (durationMin >= ZERO_AT) return 0;
  const ratio = 1 - (durationMin - FULL_AT) / (ZERO_AT - FULL_AT);
  return Math.round(CANDIDATE_SCORE_WEIGHTS.proximity * ratio);
}

function scoreTransfers(transfers) {
  return Math.max(0, CANDIDATE_SCORE_WEIGHTS.transfers - transfers * 5);
}

function scoreExperience(candidate, project) {
  const exp = candidate.sectorExperience || [];
  if (!exp.length) return 0;
  const norm = exp.map((s) => s.toLocaleLowerCase("tr"));
  if (norm.includes((project.sector || "").toLocaleLowerCase("tr"))) return CANDIDATE_SCORE_WEIGHTS.experience;
  return Math.round(CANDIDATE_SCORE_WEIGHTS.experience * 0.4); // ilgisiz ama bir deneyimi var — kısmi puan
}

function scoreAgeFit(candidate, project) {
  if (candidate.age == null) return Math.round(CANDIDATE_SCORE_WEIGHTS.ageFit * 0.5); // bilinmiyorsa nötr
  const range = project.ageRange || CANDIDATE_DEFAULT_AGE_RANGE;
  if (candidate.age >= range.min && candidate.age <= range.max) return CANDIDATE_SCORE_WEIGHTS.ageFit;
  const distance = candidate.age < range.min ? range.min - candidate.age : candidate.age - range.max;
  return Math.max(0, Math.round(CANDIDATE_SCORE_WEIGHTS.ageFit - distance * 2));
}

/** Elenme sebeplerini döner — boşsa aday sert filtrelerden geçmiştir. */
function candidateHardFilterReasons(candidate, project) {
  const reasons = [];
  if (project.gender && project.gender !== "Kadın/Erkek" && candidate.gender && candidate.gender !== project.gender) {
    reasons.push(`Cinsiyet şartı uyuşmuyor (proje: ${project.gender})`);
  }
  // requiredCertificate proje şemasında henüz yok (AÇIK KARAR) — varsa uygulanır, yoksa sessizce atlanır.
  if (project.requiredCertificate) {
    const has = (candidate.certificates || []).some((c) =>
      c.toLocaleLowerCase("tr").includes(project.requiredCertificate.toLocaleLowerCase("tr"))
    );
    if (!has) reasons.push(`Gerekli belge eksik: ${project.requiredCertificate}`);
  }
  return reasons;
}

async function scoreCandidateForProject(candidate, project) {
  const coords = await resolveCandidateCoords(candidate);
  if (!coords) {
    return { candidate, project, estimate: null, breakdown: null, total: 0, eliminated: true, reasons: ["Konum belirlenemedi (adres/ilçe eşleşmedi)"] };
  }

  const reasons = candidateHardFilterReasons(candidate, project);
  const origin = { coords, name: candidate.fullName || candidate.phoneRaw, stopId: null };
  const dest = { coords: { lat: project.lat, lng: project.lng }, name: project.name, stopId: project.accessStopId };
  const estimate = getTransitEstimate(candidate.id, origin, project.id, dest, "dest");

  const breakdown = {
    proximity: scoreProximity(estimate.durationMin),
    transfers: scoreTransfers(estimate.transfers),
    experience: scoreExperience(candidate, project),
    ageFit: scoreAgeFit(candidate, project),
  };
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);

  return { candidate, project, estimate, breakdown, total, eliminated: reasons.length > 0, reasons };
}

/** projectId sabit taraf olduğu için getTransitEstimate fixedSide="dest" ile çağrılır (Dijkstra önbelleği isabet eder, bkz. app.js). */
/** onProgress(done, total), her aday puanlaması bitince çağrılır (isteğe bağlı) — uzun sürebilen ilk geocode turunda ilerlemeyi göstermek için. */
async function rankCandidatesForProject(projectId, onProgress) {
  const project = ISTANBUL_DATA.projects.find((p) => p.id === projectId);
  if (!project) return [];
  const candidates = CandidateStore.all();
  let done = 0;
  const results = await Promise.all(
    candidates.map((c) =>
      scoreCandidateForProject(c, project).then((r) => {
        done += 1;
        if (onProgress) onProgress(done, candidates.length);
        return r;
      })
    )
  );
  flushCandidateCoordsIfDirty();
  results.sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    return (b.total || 0) - (a.total || 0);
  });
  return results;
}

// ---------------------------------------------------------------------------
// 5) UI — "Proje -> Gerçek Adaylar" TAM EKRAN görünümü
// ---------------------------------------------------------------------------
// 209+ adaylık gerçek listelerde cramped bir sidebar listesi yetersiz kaldığı
// için bu mod harita/sidebar'ı gizleyip tam ekran, iki panelli bir görünüm
// açar: solda aranabilir aday listesi, sağda seçili adayın tam detayı
// (puan dökümü + gerçek rota + tüm Excel alanları).

const CANDIDATE_STALE_DAYS = 30;

function daysSince(isoDateStr) {
  if (!isoDateStr) return null;
  const d = new Date(isoDateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/**
 * Bir adayın "yılı" — başvuru tarihi varsa ondan, yoksa sisteme yüklendiği
 * tarihten türetilir. Ayrı bir alan olarak SAKLANMIYOR (appliedAt/uploadedAt
 * zaten kalıcı) — her ihtiyaç duyulduğunda buradan hesaplanır, böylece iki
 * kaynak birbirinden asla sapmaz.
 */
function candidateYear(c) {
  const iso = c.appliedAt || c.uploadedAt;
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.getFullYear();
}

const mainLayout = document.getElementById("mainLayout");
const candidateFullscreenView = document.getElementById("candidateFullscreenView");
const candidateFsBackBtn = document.getElementById("candidateFsBackBtn");
const candidateFsProjectSelect = document.getElementById("candidateFsProjectSelect");
const candidateFsSearch = document.getElementById("candidateFsSearch");
const candidateFsYearFilter = document.getElementById("candidateFsYearFilter");
const candidateFsAiFilterBtn = document.getElementById("candidateFsAiFilterBtn");
const candidateFsAiFilterStatus = document.getElementById("candidateFsAiFilterStatus");
const candidateFsList = document.getElementById("candidateFsList");
const candidateFsDetail = document.getElementById("candidateFsDetail");
const candidateFsCount = document.getElementById("candidateFsCount");

let lastCandidateFsResults = [];
let lastCandidateFsProjectId = null;
let selectedCandidateId = null;
let activeAiFilter = null; // interpretCandidateQueryWithAI() çıktısı | null

/** app.js'teki rebuildProjectSelect() ile aynı grup/sırlama mantığı — ayrı select olduğu için tekrarlanıyor. */
function populateCandidateFsProjectSelect() {
  const previouslySelected = candidateFsProjectSelect.value;
  candidateFsProjectSelect.innerHTML = '<option value="">Seçiniz…</option>';
  const bySector = {};
  applyPositionFilter(activeProjects()).forEach((p) => (bySector[p.sector] = bySector[p.sector] || []).push(p));
  Object.keys(bySector)
    .sort()
    .forEach((sector) => {
      const optGroup = document.createElement("optgroup");
      optGroup.label = sector;
      bySector[sector]
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "tr"))
        .forEach((p) => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = `${p.name} — ${p.address}`;
          optGroup.appendChild(opt);
        });
      candidateFsProjectSelect.appendChild(optGroup);
    });
  if (previouslySelected) candidateFsProjectSelect.value = previouslySelected;
}

/** Tam ekran görünümü açar/kapatır — app.js'teki mod butonu handler'ından çağrılır. */
function toggleCandidateFullscreen(show) {
  candidateFullscreenView.classList.toggle("hidden", !show);
  mainLayout.classList.toggle("hidden", show);
  if (!show) return;

  populateCandidateFsProjectSelect();
  if (projectSelect.value) {
    candidateFsProjectSelect.value = projectSelect.value;
    renderCandidateFsResults(projectSelect.value);
  } else {
    candidateFsList.innerHTML = `<div class="text-xs text-slate-400 px-2 py-4">Üstten bir proje seçin.</div>`;
    candidateFsCount.textContent = "";
    candidateFsDetail.innerHTML = `<div class="text-sm text-slate-400">Detayları görmek için soldan bir aday seçin.</div>`;
  }
}

candidateFsBackBtn.addEventListener("click", () => {
  document.querySelector('.mode-btn[data-mode="origin-to-project"]').click();
});

candidateFsProjectSelect.addEventListener("change", () => {
  projectSelect.value = candidateFsProjectSelect.value; // ana (gizli) select ile senkron kalsın
  if (candidateFsProjectSelect.value) {
    renderCandidateFsResults(candidateFsProjectSelect.value);
  } else {
    candidateFsList.innerHTML = "";
    candidateFsCount.textContent = "";
    candidateFsDetail.innerHTML = `<div class="text-sm text-slate-400">Detayları görmek için soldan bir aday seçin.</div>`;
  }
});

/**
 * currentMode/runSearch bunu app.js'ten çağırır (bkz. app.js runSearch()).
 * Konum çözme (geocode) asenkron olabileceği için bu fonksiyon da asenkron —
 * "puanlanıyor" durumu anında gösterilir, sonuçlar gelince yerini alır.
 * İsmi "renderProjectToCandidates" — app.js'in runSearch() fonksiyonu bu
 * ismi çağırıyor, değiştirmeye gerek yok.
 */
async function renderProjectToCandidates(projectId) {
  toggleCandidateFullscreen(true);
  await renderCandidateFsResults(projectId);
}

async function renderCandidateFsResults(projectId) {
  lastCandidateFsProjectId = projectId;
  selectedCandidateId = null;
  activeAiFilter = null;
  candidateFsAiFilterStatus.innerHTML = "";
  const project = ISTANBUL_DATA.projects.find((p) => p.id === projectId);
  if (!project) {
    candidateFsList.innerHTML = "";
    candidateFsCount.textContent = "";
    return;
  }

  const allCandidates = CandidateStore.all();
  if (!allCandidates.length) {
    candidateFsList.innerHTML = `<div class="text-xs text-slate-400 px-2 py-4 leading-snug">Henüz hiç aday yüklenmedi — üstteki "📋 Aday Yükle" ile bir Excel dosyası içe aktarın.</div>`;
    candidateFsCount.textContent = "0 aday";
    candidateFsDetail.innerHTML = `<div class="text-sm text-slate-400">Detayları görmek için soldan bir aday seçin.</div>`;
    return;
  }

  candidateFsCount.textContent = "Puanlanıyor…";
  candidateFsList.innerHTML = `<div class="text-xs text-slate-400 px-2 py-4">Adaylar puanlanıyor…</div>`;
  candidateFsDetail.innerHTML = `<div class="text-sm text-slate-400">Detayları görmek için soldan bir aday seçin.</div>`;

  // İlk kez görülen bir adres için konum çözme (Nominatim, ~1 istek/sn ile
  // sınırlı — bkz. app.js queueGeocodeFetch) yüzlerce adayda birkaç dakika
  // sürebilir; kullanıcı bunun donma değil ilerleyen bir işlem olduğunu
  // görsün diye sayaç canlı güncelleniyor. Aynı adaylar bir daha hiç
  // geocode edilmeyecek (konumları artık diske kalıcı yazılıyor).
  const onProgress = (done, total) => {
    if (lastCandidateFsProjectId !== projectId) return;
    candidateFsCount.textContent = `Puanlanıyor… (${done}/${total})`;
  };
  const results = await rankCandidatesForProject(projectId, onProgress);
  // Puanlama sürerken kullanıcı başka bir projeye geçmiş olabilir — o zaman bu eski sonucu ekrana basma.
  if (lastCandidateFsProjectId !== projectId) return;

  lastCandidateFsResults = results;
  const eliminatedCount = results.filter((r) => r.eliminated).length;
  candidateFsCount.textContent = `${results.length} aday (${results.length - eliminatedCount} uygun)`;
  populateCandidateFsYearFilter();
  renderCandidateFsList();
}

/** Sonuçlardaki adaylardan (appliedAt/uploadedAt bazlı) mevcut yılları çıkarıp dropdown'u doldurur. */
function populateCandidateFsYearFilter() {
  const previouslySelected = candidateFsYearFilter.value;
  const years = Array.from(
    new Set(lastCandidateFsResults.map((r) => candidateYear(r.candidate)).filter((y) => y != null))
  ).sort((a, b) => b - a);
  candidateFsYearFilter.innerHTML =
    '<option value="">Tüm yıllar</option>' + years.map((y) => `<option value="${y}">${y}</option>`).join("");
  if (previouslySelected && years.some((y) => String(y) === previouslySelected)) {
    candidateFsYearFilter.value = previouslySelected;
  }
}

function renderCandidateFsList() {
  let filtered;
  if (activeAiFilter) {
    filtered = applyAiCandidateFilter(lastCandidateFsResults, activeAiFilter);
  } else {
    const query = candidateFsSearch.value.trim().toLocaleLowerCase("tr");
    const queryDigits = query.replace(/\D/g, "");
    filtered = query
      ? lastCandidateFsResults.filter((r) => {
          const name = (r.candidate.fullName || "").toLocaleLowerCase("tr");
          const phone = r.candidate.phone || "";
          return name.includes(query) || (queryDigits && phone.includes(queryDigits));
        })
      : lastCandidateFsResults;
  }

  const yearFilter = candidateFsYearFilter.value;
  if (yearFilter) {
    filtered = filtered.filter((r) => String(candidateYear(r.candidate)) === yearFilter);
  }

  candidateFsList.innerHTML = "";
  if (!filtered.length) {
    candidateFsList.innerHTML = `<div class="text-xs text-slate-400 px-2 py-4">Sonuç yok.</div>`;
    return;
  }
  filtered.forEach((r) => candidateFsList.appendChild(buildCandidateFsRow(r)));
}

candidateFsSearch.addEventListener("input", renderCandidateFsList);
candidateFsYearFilter.addEventListener("change", renderCandidateFsList);

// ---------------------------------------------------------------------------
// AI DOĞAL DİL FİLTRE — İK, arama kutusuna "Kadıköy'e yakın, temizlik
// deneyimli, 30 yaş altı kadın adaylar" gibi serbest metin yazıp "✨ AI
// Filtre"ye basınca; AI bunu küçük bir yapılandırılmış filtreye çevirir,
// filtre mevcut (zaten hesaplanmış) sonuçlar üzerinde İSTEMCİ TARAFINDA
// uygulanır — skorlama motoruna dokunulmaz.
// ---------------------------------------------------------------------------

async function interpretCandidateQueryWithAI(text) {
  const system =
    "Sen İK arama sorgularını yapılandırılmış filtreye çeviren bir asistansın. SADECE geçerli JSON döndür, başka hiçbir metin yazma. " +
    'Şema: {"gender": "Kadın"|"Erkek"|null, "sectorKeyword": string|null, "minAge": number|null, "maxAge": number|null, ' +
    '"maxDurationMin": number|null, "maxTransfers": number|null, "onlyEligible": boolean}. ' +
    'Sorguda geçmeyen alanlar için null kullan (onlyEligible belirtilmemişse false). "yakın" gibi göreli ifadeler için makul bir dakika değeri tahmin et (ör. ~30dk).';
  const raw = await callAI(system, `Sorgu: "${text}"`, 200);
  const parsed = extractJsonBlock(raw);
  return {
    gender: parsed.gender || null,
    sectorKeyword: parsed.sectorKeyword || null,
    minAge: parsed.minAge != null ? Number(parsed.minAge) : null,
    maxAge: parsed.maxAge != null ? Number(parsed.maxAge) : null,
    maxDurationMin: parsed.maxDurationMin != null ? Number(parsed.maxDurationMin) : null,
    maxTransfers: parsed.maxTransfers != null ? Number(parsed.maxTransfers) : null,
    onlyEligible: !!parsed.onlyEligible,
  };
}

function applyAiCandidateFilter(results, f) {
  return results.filter((r) => {
    const c = r.candidate;
    if (f.onlyEligible && r.eliminated) return false;
    // Alan Excel'de boş bırakılmışsa (bilinmiyor), adayı bu kriterden ELEME —
    // eksik veri adayın aleyhine kullanılmaz, sadece GERÇEKTEN uyuşmazlık
    // varsa filtrelenir. (Önceki sürüm boş alanları da "uymuyor" sayıyordu,
    // bu da çoğu adayın haksız yere elenmesine — filtrenin gereğinden fazla
    // dar olmasına — yol açıyordu.)
    if (f.gender && c.gender && c.gender !== f.gender) return false;
    if (f.sectorKeyword && (c.sectorExperience || []).length) {
      const hay = c.sectorExperience.join(" ").toLocaleLowerCase("tr");
      if (!hay.includes(f.sectorKeyword.toLocaleLowerCase("tr"))) return false;
    }
    if (f.minAge != null && c.age != null && c.age < f.minAge) return false;
    if (f.maxAge != null && c.age != null && c.age > f.maxAge) return false;
    if (f.maxDurationMin != null && r.estimate && r.estimate.durationMin > f.maxDurationMin) return false;
    if (f.maxTransfers != null && r.estimate && r.estimate.transfers > f.maxTransfers) return false;
    return true;
  });
}

function renderAiFilterStatus(originalText) {
  if (!activeAiFilter) {
    candidateFsAiFilterStatus.innerHTML = "";
    return;
  }
  candidateFsAiFilterStatus.innerHTML = `
    <span class="inline-flex items-center gap-1.5 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2.5 py-1">
      🔎 "${escapeHtml(originalText)}"
      <button type="button" id="candidateFsAiFilterClear" class="font-bold hover:text-indigo-900 leading-none">&times;</button>
    </span>`;
  document.getElementById("candidateFsAiFilterClear").addEventListener("click", () => {
    activeAiFilter = null;
    candidateFsAiFilterStatus.innerHTML = "";
    renderCandidateFsList();
  });
}

candidateFsAiFilterBtn.addEventListener("click", async () => {
  const text = candidateFsSearch.value.trim();
  if (!text) return;
  candidateFsAiFilterBtn.disabled = true;
  candidateFsAiFilterBtn.textContent = "✨ …";
  try {
    activeAiFilter = await interpretCandidateQueryWithAI(text);
    candidateFsSearch.value = "";
    renderAiFilterStatus(text);
    renderCandidateFsList();
  } catch (err) {
    candidateFsAiFilterStatus.innerHTML = `<span class="text-xs text-red-600">AI filtre anlaşılamadı: ${err.message}</span>`;
  } finally {
    candidateFsAiFilterBtn.disabled = false;
    candidateFsAiFilterBtn.textContent = "✨ AI Filtre";
  }
});

function buildCandidateFsRow(r) {
  const row = document.createElement("button");
  row.type = "button";
  const isSelected = r.candidate.id === selectedCandidateId;
  row.className = `candidate-card ${isSelected ? "candidate-card-selected" : ""} ${r.eliminated ? "candidate-card-eliminated" : ""}`;
  const year = candidateYear(r.candidate);
  row.innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(r.candidate.fullName || "İsimsiz aday")}</div>
        <div class="text-xs text-slate-500">${escapeHtml(r.candidate.phoneRaw || "-")}${year ? ` · ${escapeHtml(String(year))}` : ""}</div>
      </div>
      ${
        r.eliminated
          ? `<span class="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 whitespace-nowrap">ELENDİ</span>`
          : `<span class="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 whitespace-nowrap">${r.total} p</span>`
      }
    </div>`;
  row.addEventListener("click", () => {
    selectedCandidateId = r.candidate.id;
    renderCandidateFsList();
    renderCandidateDetail(r);
  });
  return row;
}

/**
 * Bir aday sonucundan ({candidate, estimate, breakdown, total, eliminated,
 * reasons} — scoreCandidateForProject çıktısı) detay panelinin HTML'ini
 * üretir. Hem "Proje -> Gerçek Adaylar" tam ekranındaki sağ panelde hem de
 * Toplu Eşleştirme sonuçlarındaki aday satırına tıklanınca açılan modalda
 * kullanılır — yorumlar dahil aynı görünüm, TEKRAR YAZILMAZ.
 */
function buildCandidateDetailHtml(r) {
  const c = r.candidate;
  const freshnessBasis = c.appliedAt || c.uploadedAt;
  const staleDays = daysSince(freshnessBasis);
  const isStale = staleDays !== null && staleDays > CANDIDATE_STALE_DAYS;

  const headerHtml = `
    <div class="flex items-start justify-between gap-3 mb-4">
      <div>
        <div class="text-lg font-bold text-slate-800">${escapeHtml(c.fullName || "İsimsiz aday")}</div>
        ${isStale ? `<div class="text-xs text-amber-600 font-semibold mt-0.5">⚠️ ${staleDays} gündür güncellenmedi — İK, adayla tekrar teyit etmeli</div>` : ""}
      </div>
      ${
        r.eliminated
          ? `<span class="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full bg-slate-200 text-slate-500">ELENDİ</span>`
          : `<span class="shrink-0 text-xl font-bold px-3 py-1.5 rounded-full bg-indigo-100 text-indigo-700">${r.total} puan</span>`
      }
    </div>`;

  const eliminationHtml = r.eliminated
    ? `<div class="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">${r.reasons.join(", ")}</div>`
    : "";

  const scoreBarsHtml = r.breakdown
    ? `<div class="mb-5 space-y-2.5">
        ${Object.entries(r.breakdown)
          .map(([k, v]) => {
            const max = CANDIDATE_SCORE_WEIGHTS[k];
            const pct = Math.round((v / max) * 100);
            return `
            <div>
              <div class="flex justify-between text-xs text-slate-500 mb-1"><span>${CANDIDATE_SCORE_LABELS[k]}</span><span>${v}/${max}</span></div>
              <div class="candidate-score-bar-track"><div class="candidate-score-bar-fill" style="width:${pct}%"></div></div>
            </div>`;
          })
          .join("")}
      </div>`
    : "";

  const aiExplainHtml = !r.eliminated && r.breakdown
    ? `<div class="mb-5">
        <button type="button" class="ai-explain-btn text-xs font-semibold text-indigo-600 hover:text-indigo-800">✨ AI ile gerekçelendir</button>
        <div class="ai-explain-result hidden mt-2 text-sm text-slate-600 leading-snug bg-indigo-50 border border-indigo-100 rounded-lg p-3"></div>
      </div>`
    : "";

  const routeHtml =
    !r.eliminated && r.estimate
      ? `<div class="mb-5">
          <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Projeye Rota · ${r.estimate.durationMin} dk · ${r.estimate.transfers} aktarma${r.estimate.verified ? "" : " · TAHMİNİ"}</div>
          <div class="border border-slate-200 rounded-lg p-3">${renderRouteSteps(r.estimate.steps)}</div>
        </div>`
      : "";

  const infoRows = [
    ["Telefon", c.phoneRaw || "-"],
    ["Adres / İlçe", c.addressText || "-"],
    ["Yaş", c.age != null ? c.age : "-"],
    ["Cinsiyet", c.gender || "-"],
    ["Sektör Deneyimi", (c.sectorExperience || []).join(", ") || "-"],
    ["Sertifika / Belge", (c.certificates || []).join(", ") || "-"],
    ["Kaynak", (c.mergedSources || []).join(", ") || c.source || "-"],
    ["Yıl", candidateYear(c) || "-"],
    ["Başvuru Tarihi", c.appliedAt ? new Date(c.appliedAt).toLocaleDateString("tr-TR") : "-"],
    ["Sisteme Yüklenme", c.uploadedAt ? new Date(c.uploadedAt).toLocaleDateString("tr-TR") : "-"],
  ];
  // Excel'den gelen serbest metin alanları (telefon/adres/deneyim/sertifika/
  // kaynak) — label'lar sabit metin, değerler escapeHtml'den geçirilir.
  const infoHtml = `<div class="border-t border-slate-100 pt-3">
    ${infoRows
      .map(
        ([label, value]) =>
          `<div class="flex justify-between gap-3 py-1.5 border-b border-slate-100 text-sm">
            <span class="text-slate-500">${label}</span><span class="font-medium text-slate-800 text-right">${escapeHtml(value)}</span>
          </div>`
      )
      .join("")}
  </div>`;

  const commentsHtml = `
    <div class="mt-5 pt-4 border-t border-slate-200">
      <div class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Yorumlar</div>
      <div id="candidateCommentsSection"></div>
    </div>`;

  return `<div class="max-w-xl">${headerHtml}${eliminationHtml}${scoreBarsHtml}${aiExplainHtml}${routeHtml}${infoHtml}${commentsHtml}</div>`;
}

/** Aday-proje eşleşmesini İK'nın anlayacağı, kısa Türkçe bir gerekçeye çevirir. */
async function explainMatchWithAI(r) {
  const c = r.candidate;
  const p = r.project;
  const system =
    "Sen bir İK asistanısın. Sana verilen aday-proje eşleşme verisini İK çalışanına 2-3 kısa cümleyle, sade ve resmi bir Türkçe ile açıkla. " +
    "Sayıları olduğu gibi tekrar etme, ne anlama geldiklerini yorumla. Sadece verilen bilgileri kullan, hiçbir şey uydurma.";
  const prompt = [
    `Aday: ${c.fullName || "İsimsiz"}, ${c.age != null ? c.age + " yaşında" : "yaşı bilinmiyor"}, ${c.gender || "cinsiyet belirtilmemiş"}.`,
    `Sektör deneyimi: ${(c.sectorExperience || []).join(", ") || "belirtilmemiş"}.`,
    `Proje: ${p.name} (${p.sector}), ${p.address}. Vardiya: ${p.shift || "-"}. Cinsiyet şartı: ${p.gender || "yok"}.`,
    r.estimate ? `Ulaşım: ${r.estimate.durationMin} dk, ${r.estimate.transfers} aktarma${r.estimate.verified ? "" : " (tahmini)"}.` : "Ulaşım hesaplanamadı.",
    `Puan dökümü (100 üzerinden): Yakınlık ${r.breakdown.proximity}/40, Aktarma ${r.breakdown.transfers}/15, Deneyim ${r.breakdown.experience}/25, Yaş uygunluğu ${r.breakdown.ageFit}/20. Toplam: ${r.total}.`,
    "Bu adayın bu proje için neden uygun olduğunu (veya sınırlı uygun olduğunu) İK çalışanına kısaca açıkla.",
  ].join("\n");
  return callAI(system, prompt, 220);
}

/** buildCandidateDetailHtml'in ürettiği "✨ AI ile gerekçelendir" butonunu container içinde bulup bağlar. */
function wireAiExplainButton(container, r) {
  const btn = container.querySelector(".ai-explain-btn");
  if (!btn) return;
  const box = container.querySelector(".ai-explain-result");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "✨ Oluşturuluyor…";
    box.classList.remove("hidden");
    box.textContent = "";
    try {
      box.textContent = await explainMatchWithAI(r);
    } catch (err) {
      box.textContent = "AI gerekçesi alınamadı: " + err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "✨ AI ile gerekçelendir";
    }
  });
}

function renderCandidateDetail(r) {
  candidateFsDetail.innerHTML = buildCandidateDetailHtml(r);
  wireAiExplainButton(candidateFsDetail, r);
  renderCommentsSection(r.candidate.id, r.candidate.fullName);
}

const batchCandidateModal = document.getElementById("batchCandidateModal");
const batchCandidateModalBody = document.getElementById("batchCandidateModalBody");
const batchCandidateModalClose = document.getElementById("batchCandidateModalClose");

function openBatchCandidateModal(r) {
  batchCandidateModalBody.innerHTML = buildCandidateDetailHtml(r);
  wireAiExplainButton(batchCandidateModalBody, r);
  batchCandidateModal.classList.remove("hidden");
  selectedCandidateId = r.candidate.id; // renderCommentsSection'ın "hâlâ güncel mi" kontrolü için
  renderCommentsSection(r.candidate.id, r.candidate.fullName);
}
function closeBatchCandidateModal() {
  batchCandidateModal.classList.add("hidden");
  batchCandidateModalBody.innerHTML = "";
}
batchCandidateModalClose.addEventListener("click", closeBatchCandidateModal);
batchCandidateModal.addEventListener("click", (e) => {
  if (e.target === batchCandidateModal) closeBatchCandidateModal();
});

// ---------------------------------------------------------------------------
// 6) UI — Excel yükleme + sütun eşleme modalı
// ---------------------------------------------------------------------------

const uploadCandidatesBtn = document.getElementById("uploadCandidatesBtn");
const uploadCandidatesModal = document.getElementById("uploadCandidatesModal");
const uploadCandidatesClose = document.getElementById("uploadCandidatesClose");
const uploadCandidatesCancel = document.getElementById("uploadCandidatesCancel");
const candidateFileInput = document.getElementById("candidateFileInput");
const candidateMappingArea = document.getElementById("candidateMappingArea");
const candidateMappingRows = document.getElementById("candidateMappingRows");
const candidateUploadStatus = document.getElementById("candidateUploadStatus");
const candidateImportBtn = document.getElementById("candidateImportBtn");
const candidateAiMapBtn = document.getElementById("candidateAiMapBtn");
const candidatePoolCount = document.getElementById("candidatePoolCount");
const candidateClearAllBtn = document.getElementById("candidateClearAllBtn");

let pendingImport = null; // { headers: string[], rows: string[][] } | null

function refreshCandidatePoolCount() {
  candidatePoolCount.textContent = CandidateStore.all().length;
}

function openUploadCandidatesModal() {
  refreshCandidatePoolCount();
  uploadCandidatesModal.classList.remove("hidden");
}
function closeUploadCandidatesModal() {
  uploadCandidatesModal.classList.add("hidden");
  resetImportState();
}
function resetImportState() {
  pendingImport = null;
  candidateFileInput.value = "";
  candidateMappingArea.classList.add("hidden");
  candidateMappingRows.innerHTML = "";
  candidateUploadStatus.textContent = "";
  candidateImportBtn.disabled = true;
}

uploadCandidatesBtn.addEventListener("click", openUploadCandidatesModal);
uploadCandidatesClose.addEventListener("click", closeUploadCandidatesModal);
uploadCandidatesCancel.addEventListener("click", closeUploadCandidatesModal);
uploadCandidatesModal.addEventListener("click", (e) => {
  if (e.target === uploadCandidatesModal) closeUploadCandidatesModal();
});

candidateClearAllBtn.addEventListener("click", () => {
  if (!CandidateStore.all().length) return;
  if (!confirm(`${CandidateStore.all().length} adayın tamamı silinsin mi? Bu işlem geri alınamaz.`)) return;
  CandidateStore.clear();
  refreshCandidatePoolCount();
  if (currentMode === "project-to-candidates" && projectSelect.value) runSearch();
});

candidateFileInput.addEventListener("change", async () => {
  const file = candidateFileInput.files[0];
  if (!file) return;
  candidateUploadStatus.textContent = "Dosya okunuyor…";
  candidateMappingArea.classList.add("hidden");
  candidateImportBtn.disabled = true;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows.length) {
      candidateUploadStatus.textContent = "Dosya boş görünüyor.";
      return;
    }
    const headers = rows[0].map((h) => String(h || "").trim());
    const dataRows = rows.slice(1).filter((r) => r.some((cell) => String(cell || "").trim() !== ""));
    if (!dataRows.length) {
      candidateUploadStatus.textContent = "Başlık dışında veri satırı bulunamadı.";
      return;
    }
    pendingImport = { headers, rows: dataRows };
    renderCandidateMappingUI(headers);
    candidateUploadStatus.textContent = `${dataRows.length} satır bulundu. Sütunları kontrol edip "İçe Aktar"a basın.`;
    candidateImportBtn.disabled = false;
  } catch (err) {
    candidateUploadStatus.textContent = "Dosya okunamadı — geçerli bir .xlsx/.xls dosyası olduğundan emin olun.";
  }
});

function renderCandidateMappingUI(headers) {
  candidateMappingRows.innerHTML = CANDIDATE_FIELDS.map((f) => {
    const guessedIdx = guessColumnForField(f.key, headers);
    const options = [`<option value="-1">— Kullanma —</option>`].concat(
      headers.map((h, i) => `<option value="${i}" ${i === guessedIdx ? "selected" : ""}>${escapeHtml(h || "(sütun " + (i + 1) + ")")}</option>`)
    );
    return `
      <div class="flex items-center gap-2">
        <label class="w-40 shrink-0 text-xs text-slate-600">${f.label}${f.required ? " *" : ""}</label>
        <select data-field="${f.key}" class="candidate-map-select flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white">
          ${options.join("")}
        </select>
      </div>`;
  }).join("");
  candidateMappingArea.classList.remove("hidden");
}

/**
 * Excel başlıklarını CANDIDATE_FIELDS'e karşı AI'a eşleştirtir — özellikle
 * guessColumnForField'ın sabit anahtar kelime listesinin (bkz.
 * CANDIDATE_FIELD_KEYWORDS) yakalayamadığı yazım hatalı/alışılmadık
 * başlıklarda (farklı İK kaynaklarından gelen düzensiz Excel'ler) devreye
 * girer. Öneri sadece <select>'lerin seçili değerini değiştirir, kullanıcı
 * onaylamadan (İçe Aktar'a basmadan) hiçbir şey kaydedilmez.
 */
async function suggestMappingWithAI(headers) {
  const system =
    "Sen bir Excel sütun eşleştirme asistanısın. Verilen alan listesini, verilen sütun başlıklarıyla eşleştir. " +
    "SADECE geçerli JSON döndür, başka hiçbir metin yazma. Şema: her fieldKey için değeri en uygun sütun indexi " +
    "(0 tabanlı) olan, uygun sütun yoksa -1 olan bir obje.";
  const fieldsDesc = CANDIDATE_FIELDS.map((f) => `${f.key}: ${f.label}`).join("\n");
  const headersDesc = headers.map((h, i) => `${i}: ${h || "(boş başlık)"}`).join("\n");
  const prompt = `Alanlar:\n${fieldsDesc}\n\nExcel sütunları:\n${headersDesc}\n\nHer alan için en uygun sütun indexini ver.`;
  const raw = await callAI(system, prompt, 300);
  return extractJsonBlock(raw);
}

candidateAiMapBtn.addEventListener("click", async () => {
  if (!pendingImport) return;
  candidateAiMapBtn.disabled = true;
  candidateAiMapBtn.textContent = "✨ …";
  try {
    const mapping = await suggestMappingWithAI(pendingImport.headers);
    candidateMappingRows.querySelectorAll(".candidate-map-select").forEach((sel) => {
      const idx = Number(mapping[sel.dataset.field]);
      if (Number.isInteger(idx) && idx >= -1 && idx < pendingImport.headers.length) {
        sel.value = String(idx);
      }
    });
    candidateUploadStatus.textContent = 'AI önerisi uygulandı — kontrol edip "İçe Aktar"a basın.';
  } catch (err) {
    candidateUploadStatus.textContent = "AI eşleştirme başarısız: " + err.message;
  } finally {
    candidateAiMapBtn.disabled = false;
    candidateAiMapBtn.textContent = "✨ AI ile Eşleştir";
  }
});

candidateImportBtn.addEventListener("click", () => {
  if (!pendingImport) return;
  const selects = candidateMappingRows.querySelectorAll(".candidate-map-select");
  const mapping = {};
  selects.forEach((sel) => {
    mapping[sel.dataset.field] = Number(sel.value);
  });

  if (mapping.fullName === -1 || mapping.phone === -1 || mapping.addressText === -1) {
    candidateUploadStatus.textContent = "Ad Soyad, Telefon ve Adres/İlçe sütunları zorunludur.";
    return;
  }

  const now = new Date().toISOString();
  const parsed = pendingImport.rows.map((row) => buildCandidateFromRow(row, mapping, now)).filter((c) => c.phone);
  const skipped = pendingImport.rows.length - parsed.length;

  const { added, merged } = CandidateStore.upsertBatch(parsed);
  refreshCandidatePoolCount();
  resetImportState();
  candidateUploadStatus.textContent =
    `${added} yeni aday eklendi, ${merged} aday mevcut kayıtla tekilleştirildi (birleştirildi).` +
    (skipped > 0 ? ` ${skipped} satır telefon numarası olmadığı için atlandı.` : "") +
    ` Toplam ${CandidateStore.all().length} aday.`;

  if (currentMode === "project-to-candidates" && projectSelect.value) runSearch();
});

// ---------------------------------------------------------------------------
// 7) ADAY YORUMLARI — ekip içi paylaşımlı notlar (Google Apps Script + Sheet)
// ---------------------------------------------------------------------------
// Yorumlar telefon bazlı candidate.id'ye göre saklanır — bu sayede aday
// listesinin kendisi paylaşımlı olmasa bile (bkz. dosya başındaki NOT), aynı
// telefonla farklı bilgisayarlarda içe aktarılan bir aday üzerindeki yorumlar
// herkese görünür (aynı ID'ye düşerler).
//
// İstanbul'da yorumlar da projelerle AYNI Apps Script'i (SHEET_API_URL, bkz.
// Code.gs) kullanır — "Comments" sekmesi aynı Sheet'te. Kontrat:
//   - POST {action:"addComment", comment:{candidateId, candidateName, author, text, createdAt}}
//     -> {ok:true} döner, "Comments" sayfasına (yoksa oluşturularak) satır ekler.
//   - GET -> {ok, projects, comments}; comments TÜM adayların yorumlarını içerir,
//     bu yüzden istemci tarafında candidateId'ye göre süzülür.
// SHEET_API_URL boşsa (Sheet henüz kurulmadıysa) yorum listesi boş döner ve
// yorum eklenemez.
const CANDIDATE_COMMENTS_API_URL = SHEET_API_URL;
const COMMENT_AUTHOR_KEY = "ist_ulasim_comment_author_v1";

function getSavedCommentAuthor() {
  try {
    return localStorage.getItem(COMMENT_AUTHOR_KEY) || "";
  } catch {
    return "";
  }
}
function saveCommentAuthor(name) {
  try {
    localStorage.setItem(COMMENT_AUTHOR_KEY, name);
  } catch {
    /* localStorage yoksa sessizce geç */
  }
}

async function fetchCommentsForCandidate(candidateId) {
  if (!CANDIDATE_COMMENTS_API_URL) return [];
  const res = await fetch(CANDIDATE_COMMENTS_API_URL);
  if (!res.ok) throw new Error("Yorumlar alınamadı");
  const data = await res.json();
  const all = Array.isArray(data) ? data : data.comments || [];
  return all.filter((c) => c.candidateId === candidateId);
}

async function postCandidateComment(comment) {
  if (!CANDIDATE_COMMENTS_API_URL) throw new Error("Sheet henüz kurulmadı (SHEET_API_URL boş) — yorumlar kaydedilemez");
  const res = await fetch(CANDIDATE_COMMENTS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "addComment", comment }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Yorum eklenemedi");
  return data;
}

function formatCommentDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderCommentsList(container, comments) {
  if (!comments.length) {
    container.innerHTML = `<div class="text-xs text-slate-400 py-2">Henüz yorum yok — ilk yorumu sen ekle.</div>`;
    return;
  }
  container.innerHTML = comments
    .map(
      (c) => `
      <div class="border-b border-slate-100 py-2">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-xs font-semibold text-slate-700">${escapeHtml(c.author || "İsimsiz")}</span>
          <span class="text-[10px] text-slate-400 whitespace-nowrap">${formatCommentDate(c.createdAt)}</span>
        </div>
        <div class="text-sm text-slate-600 mt-0.5">${escapeHtml(c.text)}</div>
      </div>`
    )
    .join("");
}

/** candidateFsDetail içindeki #candidateCommentsSection'ı doldurur — async, seçili aday bu arada değişmiş olabilir diye kontrol eder. */
function renderCommentsSection(candidateId, candidateName) {
  const host = document.getElementById("candidateCommentsSection");
  if (!host) return;

  if (!CANDIDATE_COMMENTS_API_URL) {
    host.innerHTML = `<div class="text-xs text-slate-400 leading-snug">Yorumlar için paylaşımlı sunucu henüz ayarlanmadı — ekip genelinde kullanılabilecek bu özellik kurulunca burada aktif olacak.</div>`;
    return;
  }

  host.innerHTML = `<div class="text-xs text-slate-400 py-2">Yorumlar yükleniyor…</div>`;
  const savedAuthor = getSavedCommentAuthor();
  const formHtml = `
    <div class="mt-3 pt-3 border-t border-slate-100">
      <input id="commentAuthorInput" type="text" placeholder="Adınız" value="${escapeHtml(savedAuthor)}" class="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm mb-1.5" />
      <textarea id="commentTextInput" rows="2" placeholder="Bu aday hakkında bir not ekle…" class="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm resize-none"></textarea>
      <div class="flex items-center justify-between mt-1.5">
        <span id="commentStatus" class="text-[11px] text-slate-400"></span>
        <button id="commentSubmitBtn" type="button" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white">Yorum Ekle</button>
      </div>
    </div>`;

  fetchCommentsForCandidate(candidateId)
    .then((comments) => {
      if (selectedCandidateId !== candidateId) return; // kullanıcı bu arada başka bir aday seçmiş
      const listEl = document.createElement("div");
      renderCommentsList(listEl, comments);
      host.innerHTML = "";
      host.appendChild(listEl);
      host.insertAdjacentHTML("beforeend", formHtml);
      wireCommentForm(candidateId, candidateName, listEl, comments);
    })
    .catch(() => {
      if (selectedCandidateId !== candidateId) return;
      host.innerHTML = `<div class="text-xs text-red-500 py-2">Yorumlar yüklenemedi — bağlantıyı kontrol edip tekrar seç.</div>${formHtml}`;
      wireCommentForm(candidateId, candidateName, null, []);
    });
}

function wireCommentForm(candidateId, candidateName, listEl, existingComments) {
  const authorInput = document.getElementById("commentAuthorInput");
  const textInput = document.getElementById("commentTextInput");
  const statusEl = document.getElementById("commentStatus");
  const submitBtn = document.getElementById("commentSubmitBtn");
  if (!submitBtn) return;

  submitBtn.addEventListener("click", async () => {
    const author = authorInput.value.trim();
    const text = textInput.value.trim();
    if (!author || !text) {
      statusEl.textContent = "Ad ve yorum metni gerekli.";
      return;
    }
    saveCommentAuthor(author);
    submitBtn.disabled = true;
    statusEl.textContent = "Kaydediliyor…";
    const comment = { candidateId, candidateName, author, text, createdAt: new Date().toISOString() };
    try {
      await postCandidateComment(comment);
      textInput.value = "";
      statusEl.textContent = "Eklendi.";
      existingComments = [comment, ...existingComments];
      if (listEl) renderCommentsList(listEl, existingComments);
    } catch {
      statusEl.textContent = "Kaydedilemedi — bağlantıyı kontrol edip tekrar dene.";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// 8) AI'YA SOR — mevcut aday sıralamasına dayalı doğal dil sohbet
// ---------------------------------------------------------------------------
// Aynı Apps Script'e (CANDIDATE_COMMENTS_API_URL) yeni bir action daha
// ekleniyor: "askAI". AI'a SADECE o an ekranda sıralanmış gerçek aday verisi
// (buildAiContext) bağlam olarak veriliyor — kendi başına tahmin yürütmesin,
// sadece elimizdeki gerçek listeyi yorumlasın diye.
const candidateAiBtn = document.getElementById("candidateAiBtn");
const candidateAiModal = document.getElementById("candidateAiModal");
const candidateAiClose = document.getElementById("candidateAiClose");
const candidateAiProjectName = document.getElementById("candidateAiProjectName");
const candidateAiLog = document.getElementById("candidateAiLog");
const candidateAiInput = document.getElementById("candidateAiInput");
const candidateAiSend = document.getElementById("candidateAiSend");

candidateAiBtn.addEventListener("click", () => {
  if (!lastCandidateFsResults.length) {
    alert("Önce bir proje seçip adayların sıralanmasını bekle.");
    return;
  }
  const project = ISTANBUL_DATA.projects.find((p) => p.id === lastCandidateFsProjectId);
  candidateAiProjectName.textContent = project ? project.name : "";
  candidateAiModal.classList.remove("hidden");
  candidateAiInput.focus();
});
candidateAiClose.addEventListener("click", () => candidateAiModal.classList.add("hidden"));
candidateAiModal.addEventListener("click", (e) => {
  if (e.target === candidateAiModal) candidateAiModal.classList.add("hidden");
});

/** AI'a gidecek bağlamı, ekrandaki sıralamadan (zaten hesaplanmış) çıkarır — ek bir puanlama YAPILMAZ. */
function buildAiContext() {
  return lastCandidateFsResults.map((r) => ({
    isim: r.candidate.fullName,
    telefon: r.candidate.phoneRaw,
    adres: r.candidate.addressText,
    yas: r.candidate.age,
    cinsiyet: r.candidate.gender,
    deneyim: r.candidate.sectorExperience,
    puan: r.eliminated ? null : r.total,
    elendiMi: r.eliminated,
    elenmeSebebi: r.eliminated ? r.reasons.join(", ") : null,
    projeyeSureDk: r.estimate ? r.estimate.durationMin : null,
    aktarmaSayisi: r.estimate ? r.estimate.transfers : null,
  }));
}

function appendAiMessage(role, text) {
  const bubble = document.createElement("div");
  bubble.className =
    role === "user"
      ? "self-end max-w-[85%] bg-indigo-600 text-white text-sm rounded-lg px-3 py-2"
      : "self-start max-w-[85%] bg-slate-100 text-slate-800 text-sm rounded-lg px-3 py-2 whitespace-pre-line";
  bubble.textContent = text;
  candidateAiLog.appendChild(bubble);
  candidateAiLog.scrollTop = candidateAiLog.scrollHeight;
  return bubble;
}

async function sendAiQuestion() {
  const question = candidateAiInput.value.trim();
  if (!question) return;
  appendAiMessage("user", question);
  candidateAiInput.value = "";
  candidateAiSend.disabled = true;
  const thinkingBubble = appendAiMessage("ai", "Düşünüyor…");

  try {
    const project = ISTANBUL_DATA.projects.find((p) => p.id === lastCandidateFsProjectId);
    const answer = await callAI(
      "Sen bir İK asistanısın. SADECE verilen aday verilerine dayanarak Türkçe, kısa ve net cevap ver. Veride olmayan bir bilgiyi uydurma; bilmiyorsan bilmediğini söyle.",
      `Proje: ${project ? project.name : ""}\n\nAday verileri (JSON):\n${JSON.stringify(buildAiContext())}\n\nSoru: ${question}`
    );
    thinkingBubble.textContent = answer || "Cevap alınamadı.";
  } catch (err) {
    thinkingBubble.textContent = `Hata: ${err && err.message ? err.message : "bağlantı hatası — tekrar dene."}`;
  } finally {
    candidateAiSend.disabled = false;
    candidateAiLog.scrollTop = candidateAiLog.scrollHeight;
  }
}

candidateAiSend.addEventListener("click", sendAiQuestion);
candidateAiInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendAiQuestion();
});

// ---------------------------------------------------------------------------
// 9) TOPLU EŞLEŞTİRME — kapasiteli, aç gözlü (greedy) çoklu-proje eşleştirme
// ---------------------------------------------------------------------------
// Tek tek "Proje -> Gerçek Adaylar" bakışı, aynı iyi adayları HER projeye
// ayrı ayrı öneriyor — aynı kişi birden fazla projeye "en iyi seçenek" gibi
// görünüp İK'nın farkında olmadan aynı adayı iki yere birden yönlendirmesine
// yol açabiliyordu; ayrıca hiçbir yerde "bu projeye kaç kişi lazım" bilgisi
// tutulmuyordu. Bu bölüm, seçilen birkaç açık proje için TÜM adayları bir
// arada değerlendirip, en yüksek puanlı eşleşmeden başlayarak (aç gözlü)
// her adayı EN FAZLA BİR projeye, kontenjan doldukça sıradaki adaya geçerek
// atar. Tam optimal değildir (o, Macar algoritması/atama problemi çözümü
// gerektirir) ama gerçek problemi — aynı adayın birden fazla yere
// önerilmesini ve kontenjansız atamayı — hemen, anlaşılır şekilde çözer.

const batchMatchBtn = document.getElementById("batchMatchBtn");
const batchMatchView = document.getElementById("batchMatchView");
const batchMatchBackBtn = document.getElementById("batchMatchBackBtn");
const batchMatchRunBtn = document.getElementById("batchMatchRunBtn");
const batchMatchStatus = document.getElementById("batchMatchStatus");
const batchMatchProjectList = document.getElementById("batchMatchProjectList");
const batchMatchResults = document.getElementById("batchMatchResults");

// Sonuç listesi her eşleştirmede baştan çiziliyor (innerHTML) — bu yüzden
// tek tek satırlara değil, konteynerin kendisine (event delegation) bir kez
// bağlanıyor.
batchMatchResults.addEventListener("click", (e) => {
  const row = e.target.closest(".batch-candidate-row");
  if (!row) return;
  const r = lastBatchResultsByCandidateId.get(row.dataset.candidateId);
  if (r) openBatchCandidateModal(r);
});

/** capacity alanı boş/tanımsız/geçersizse sınırsız kabul edilir. */
function projectCapacity(project) {
  const c = project.capacity;
  if (c == null || c === "") return Infinity;
  const n = Number(c);
  return Number.isFinite(n) && n >= 0 ? n : Infinity;
}

function openBatchMatchView() {
  batchMatchView.classList.remove("hidden");
  mainLayout.classList.add("hidden");
  batchMatchResults.innerHTML = `<div class="text-sm text-slate-400">Soldan proje(ler) seçip "Eşleştir"e bas.</div>`;
  batchMatchStatus.textContent = "";
  renderBatchMatchProjectList();
}

function closeBatchMatchView() {
  batchMatchView.classList.add("hidden");
  mainLayout.classList.remove("hidden");
}

batchMatchBtn.addEventListener("click", openBatchMatchView);
batchMatchBackBtn.addEventListener("click", closeBatchMatchView);

function renderBatchMatchProjectList() {
  const bySector = {};
  applyPositionFilter(activeProjects()).forEach((p) => (bySector[p.sector] = bySector[p.sector] || []).push(p));
  const sectors = Object.keys(bySector).sort();

  batchMatchProjectList.innerHTML = sectors
    .map((sector) => {
      const rows = bySector[sector]
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "tr"))
        .map(
          (p) => `
          <div class="flex items-center gap-2 py-1.5">
            <input type="checkbox" class="batch-project-checkbox" data-project-id="${p.id}" />
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium text-slate-700 truncate">${escapeHtml(p.name)}</div>
              <div class="text-[10px] text-slate-400 truncate">${escapeHtml(p.address)}</div>
            </div>
            <input type="number" min="0" placeholder="Sınırsız" data-project-id="${p.id}"
              class="batch-project-capacity w-16 border border-slate-200 rounded-md px-1.5 py-1 text-xs"
              value="${p.capacity != null ? p.capacity : ""}" />
          </div>`
        )
        .join("");
      return `
        <div>
          <div class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-1 pt-1">${sector}</div>
          ${rows}
        </div>`;
    })
    .join("");
}

batchMatchRunBtn.addEventListener("click", async () => {
  const checkboxes = Array.from(batchMatchProjectList.querySelectorAll(".batch-project-checkbox:checked"));
  const projectIds = checkboxes.map((cb) => cb.dataset.projectId);
  if (!projectIds.length) {
    batchMatchStatus.textContent = "Önce en az bir proje seç.";
    return;
  }

  batchMatchRunBtn.disabled = true;
  batchMatchStatus.textContent = "Kontenjanlar kaydediliyor…";

  // Kontenjan değişikliklerini kaydet (sadece seçili projeler için, sadece
  // gerçekten değişenler) — aynı urgent/inactive modallarındaki gibi tek
  // istekte toplu güncelleme.
  const patches = [];
  projectIds.forEach((id) => {
    const input = batchMatchProjectList.querySelector(`.batch-project-capacity[data-project-id="${id}"]`);
    const project = ISTANBUL_DATA.projects.find((p) => p.id === id);
    const rawValue = input.value.trim();
    const newCapacity = rawValue === "" ? "" : Number(rawValue);
    const currentCapacity = project.capacity != null ? project.capacity : "";
    if (String(newCapacity) !== String(currentCapacity)) {
      patches.push({ id, patch: { capacity: newCapacity } });
    }
  });

  if (patches.length) {
    try {
      const { updatedIds } = await postBatchUpdate(patches);
      patches.forEach(({ id, patch }) => {
        if (updatedIds.has(id)) {
          const project = ISTANBUL_DATA.projects.find((p) => p.id === id);
          if (project) project.capacity = patch.capacity === "" ? null : patch.capacity;
        }
      });
      saveProjectsCache();
    } catch {
      batchMatchStatus.textContent = "Kontenjanlar kaydedilemedi — internet bağlantısını kontrol et.";
      batchMatchRunBtn.disabled = false;
      return;
    }
  }

  batchMatchStatus.textContent = "Eşleştiriliyor…";
  batchMatchResults.innerHTML = `<div class="text-sm text-slate-400">Adaylar puanlanıyor…</div>`;

  try {
    const { assignmentsByProject, unassigned, projects } = await runBatchMatch(projectIds, (done, total) => {
      batchMatchStatus.textContent = `Eşleştiriliyor… (${done}/${total})`;
    });
    renderBatchMatchResults(assignmentsByProject, unassigned, projects);
    batchMatchStatus.textContent = "";
  } catch {
    batchMatchStatus.textContent = "Eşleştirme başarısız oldu.";
  } finally {
    batchMatchRunBtn.disabled = false;
  }
});

/**
 * Seçilen projeler için TÜM adayları puanlayıp, en yüksek puandan başlayarak
 * aç gözlü şekilde atar: bir aday zaten bir projeye atandıysa veya bir
 * projenin kontenjanı dolduysa o eşleşme atlanır. Tam optimal değildir (bkz.
 * dosya başındaki not) ama O(n·m log(n·m)) karmaşıklığıyla yüzlerce aday ×
 * birkaç proje için anında çalışır.
 */
async function runBatchMatch(projectIds, onProgress) {
  const projects = projectIds.map((id) => ISTANBUL_DATA.projects.find((p) => p.id === id)).filter(Boolean);
  const candidates = CandidateStore.all();

  const allTriples = [];
  let done = 0;
  const total = candidates.length * projects.length;
  for (const project of projects) {
    const results = await Promise.all(
      candidates.map((c) =>
        scoreCandidateForProject(c, project).then((r) => {
          done += 1;
          if (onProgress) onProgress(done, total);
          return r;
        })
      )
    );
    results.forEach((result) => {
      if (!result.eliminated) allTriples.push({ project, result });
    });
  }
  flushCandidateCoordsIfDirty();
  allTriples.sort((a, b) => b.result.total - a.result.total);

  const capacityLeft = new Map(projects.map((p) => [p.id, projectCapacity(p)]));
  const assignedCandidateIds = new Set();
  const assignmentsByProject = new Map(projects.map((p) => [p.id, []]));
  const consideredCandidateIds = new Set();

  allTriples.forEach(({ project, result }) => {
    consideredCandidateIds.add(result.candidate.id);
    if (assignedCandidateIds.has(result.candidate.id)) return;
    if (capacityLeft.get(project.id) <= 0) return;
    assignmentsByProject.get(project.id).push(result);
    assignedCandidateIds.add(result.candidate.id);
    capacityLeft.set(project.id, capacityLeft.get(project.id) - 1);
  });

  // "Yerleştirilemeyen" = en az bir seçili projeye uygundu ama kontenjan
  // yüzünden yer bulamadı (tamamen elenenler burada gösterilmez, onlar zaten
  // hiçbir projeye uygun değildi — ayrı bir sorun).
  const unassigned = candidates.filter(
    (c) => consideredCandidateIds.has(c.id) && !assignedCandidateIds.has(c.id)
  );

  return { assignmentsByProject, unassigned, projects };
}

// Son render edilen Toplu Eşleştirme sonuçlarındaki candidate.id -> r eşlemesi
// — satıra tıklanınca hangi aday/skor/rota detayının modalda açılacağını
// bulmak için (event delegation, bkz. batchMatchResults click listener'ı).
let lastBatchResultsByCandidateId = new Map();

function renderBatchMatchResults(assignmentsByProject, unassigned, projects) {
  const totalAssigned = Array.from(assignmentsByProject.values()).reduce((sum, list) => sum + list.length, 0);

  lastBatchResultsByCandidateId = new Map();
  assignmentsByProject.forEach((list) => {
    list.forEach((r) => lastBatchResultsByCandidateId.set(r.candidate.id, r));
  });

  const projectSectionsHtml = projects
    .map((p) => {
      const list = assignmentsByProject.get(p.id) || [];
      const capacity = projectCapacity(p);
      const capacityLabel = capacity === Infinity ? "sınırsız" : capacity;
      const rowsHtml = list.length
        ? list
            .map(
              (r) => `
              <div class="batch-candidate-row flex items-center justify-between gap-2 py-1.5 border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50 rounded-md px-1 -mx-1" data-candidate-id="${r.candidate.id}">
                <div class="min-w-0">
                  <div class="text-sm font-medium text-slate-800 truncate">${escapeHtml(r.candidate.fullName || "İsimsiz aday")}</div>
                  <div class="text-xs text-slate-400">${escapeHtml(r.candidate.phoneRaw || "-")}</div>
                </div>
                <span class="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">${r.total} p</span>
              </div>`
            )
            .join("")
        : `<div class="text-xs text-slate-400 py-2">Bu projeye uygun aday bulunamadı.</div>`;

      return `
        <div class="bg-white border border-slate-200 rounded-lg p-4 mb-4">
          <div class="flex items-baseline justify-between gap-2 mb-2">
            <div class="text-sm font-bold text-slate-800">${escapeHtml(p.name)}</div>
            <div class="text-xs text-slate-400 whitespace-nowrap">${list.length} / ${capacityLabel}</div>
          </div>
          ${rowsHtml}
        </div>`;
    })
    .join("");

  const unassignedHtml = unassigned.length
    ? `
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div class="text-sm font-bold text-amber-800 mb-2">Yerleştirilemeyen Adaylar (${unassigned.length})</div>
        <p class="text-xs text-amber-700 mb-2 leading-snug">Bu adaylar seçili projelerden en az birine uygundu ama kontenjan dolduğu için başka bir adaya yer açıldı.</p>
        <div class="flex flex-wrap gap-1.5">
          ${unassigned.map((c) => `<span class="text-xs bg-white border border-amber-200 rounded-full px-2 py-1 text-amber-700">${escapeHtml(c.fullName || "İsimsiz aday")}</span>`).join("")}
        </div>
      </div>`
    : "";

  batchMatchResults.innerHTML = `
    <div class="max-w-3xl">
      <div class="text-xs text-slate-500 mb-4">${totalAssigned} aday, ${projects.length} projeye dağıtıldı.</div>
      ${projectSectionsHtml}
      ${unassignedHtml}
    </div>`;
}
