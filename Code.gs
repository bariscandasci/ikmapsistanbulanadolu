/**
 * İstanbul Ulaşım & Proje Eşleştirme Modülü — paylaşımlı proje veritabanı + aday yorumları + AI.
 * Ankara'daki (ikmaps) Code.gs'in İSTANBUL İÇİN AYRI bir kopyası — kendi
 * Google Sheet'ine yazar, Ankara'nınkine dokunmaz.
 *
 * Kurulum: bu dosyayı, İstanbul için oluşturulan (Ankara'dan bağımsız) yeni
 * bir Google Sheet'te Uzantılar > Apps Script menüsünden açılan editöre
 * YAPIŞTIR, "seedIfEmpty" fonksiyonunu bir kez çalıştır (21 projeyi yazar),
 * sonra Dağıt > Yeni dağıtım > Web uygulaması (Yürütme: Ben, Erişim: Herkes)
 * ile yayınla. Çıkan /exec URL'ini app.js içindeki SHEET_API_URL'e yapıştır
 * (aday yorumları ve AI de aynı URL'i kullanır). Ankara'daki Apps Script
 * URL'i buraya yapıştırılmamalı.
 * AI özellikleri için ayrıca Script Özellikleri'ne GEMINI_API_KEY ekle
 * (bkz. callGemini_). Sonraki kod güncellemelerinde "Dağıtımları yönet" ile
 * mevcut dağıtımın YENİ SÜRÜMÜNÜ yayınla (URL değişmez).
 */

const SHEET_NAME = "Projeler";
const FIELDS = [
  "id", "name", "sector", "address", "lat", "lng", "accessStopId",
  "shift", "salary", "meal", "transport", "referral", "gender",
  "urgent", "active", "capacity", "position",
];

/**
 * "capacity" (kontenjan) ve "position" (Pozisyon Filtresi — Şeflik/Temizlik
 * Görevlisi/Servis) sonradan eklenen alanlar — canlı Sheet'in başlık
 * satırında henüz yoksa (ör. bu kod ilk kez deploy edildiğinde) burada
 * otomatik olarak sütun başlıkları eklenir. Böylece kullanıcı Sheet'i elle
 * düzenlemek zorunda kalmaz. Mevcut satırlardaki hücreler boş kalır — bu
 * satırlar "Tümü" dışındaki bir Pozisyon Filtresi'nde görünmez, İK Sheet'ten
 * elle doldurabilir.
 */
function ensureLaterAddedColumns_() {
  const sheet = getSheet_();
  let lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  ["capacity", "position"].forEach((col) => {
    if (!header.includes(col)) {
      lastCol += 1;
      sheet.getRange(1, lastCol).setValue(col);
      header.push(col);
    }
  });
}

// Aday yorumları — "Comments" sekmesi. Bu sekmenin kendi id sütunu yok; bir
// satır candidateId+candidateName+author+text+createdAt ile tanımlanır.
const COMMENTS_SHEET_NAME = "Comments";
const COMMENT_FIELDS = ["candidateId", "candidateName", "author", "text", "createdAt"];

/** "Projeler" sekmesi yoksa (ör. ilk kurulum) başlık satırıyla birlikte oluşturur. */
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(FIELDS);
  }
  return sheet;
}

/** "Comments" sekmesi yoksa (ör. ilk kurulum) başlık satırıyla birlikte oluşturur. */
function getCommentsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(COMMENTS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(COMMENTS_SHEET_NAME);
    sheet.appendRow(COMMENT_FIELDS);
  }
  return sheet;
}

// Aday havuzu — "Adaylar" sekmesi. id telefon bazlıdır (cand_5xxxxxxxxx).
// Dizi alanlar (sektör, sertifika, kaynaklar) hücrede JSON metni olarak durur.
const CANDIDATES_SHEET_NAME = "Adaylar";
const CANDIDATE_FIELDS = [
  "id", "fullName", "phone", "phoneRaw", "addressText",
  "districtId", "neighborhoodId", "lat", "lng", "coordsSource",
  "age", "gender", "sectorExperience", "certificates",
  "source", "appliedAt", "uploadedAt", "mergedSources",
];

function getCandidatesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CANDIDATES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CANDIDATES_SHEET_NAME);
    sheet.appendRow(CANDIDATE_FIELDS);
  }
  return sheet;
}

function cellText_(value) {
  if (value == null || value === "") return "";
  if (Object.prototype.toString.call(value) === "[object Date]") return value.toISOString();
  return String(value);
}

function parseJsonList_(raw) {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) return raw.map(String);
  const text = cellText_(raw).trim();
  if (!text) return [];
  if (text.charAt(0) === "[") {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (err) {
      return [];
    }
  }
  return text.split(/[,/;]/).map(function (part) { return part.trim(); }).filter(Boolean);
}

function candidateToRow_(candidate) {
  const coords = candidate.coords || {};
  return CANDIDATE_FIELDS.map(function (field) {
    if (field === "lat") return coords.lat == null || coords.lat === "" ? "" : Number(coords.lat);
    if (field === "lng") return coords.lng == null || coords.lng === "" ? "" : Number(coords.lng);
    if (field === "age") return candidate.age == null || candidate.age === "" ? "" : Number(candidate.age);
    if (field === "sectorExperience" || field === "certificates" || field === "mergedSources") {
      return JSON.stringify(candidate[field] || []);
    }
    const value = candidate[field];
    return value == null ? "" : String(value);
  });
}

function rowToCandidate_(header, row) {
  const raw = {};
  header.forEach(function (key, i) { raw[key] = row[i]; });
  const lat = raw.lat === "" || raw.lat == null ? null : Number(raw.lat);
  const lng = raw.lng === "" || raw.lng == null ? null : Number(raw.lng);
  const age = raw.age === "" || raw.age == null ? null : Number(raw.age);
  return {
    id: cellText_(raw.id),
    fullName: cellText_(raw.fullName),
    phone: cellText_(raw.phone),
    phoneRaw: cellText_(raw.phoneRaw),
    addressText: cellText_(raw.addressText),
    districtId: cellText_(raw.districtId) || null,
    neighborhoodId: cellText_(raw.neighborhoodId) || null,
    coords: lat != null && lng != null && !isNaN(lat) && !isNaN(lng) ? { lat: lat, lng: lng } : null,
    coordsSource: cellText_(raw.coordsSource) || null,
    age: age != null && !isNaN(age) ? age : null,
    gender: cellText_(raw.gender) || null,
    sectorExperience: parseJsonList_(raw.sectorExperience),
    certificates: parseJsonList_(raw.certificates),
    source: cellText_(raw.source),
    appliedAt: cellText_(raw.appliedAt) || null,
    uploadedAt: cellText_(raw.uploadedAt) || null,
    retentionUntil: null,
    mergedSources: parseJsonList_(raw.mergedSources),
  };
}

function readAllCandidates_() {
  const sheet = getCandidatesSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const header = values[0].map(function (h) { return String(h).trim(); });
  const idCol = header.indexOf("id");
  return values.slice(1)
    .filter(function (row) { return idCol !== -1 && row[idCol]; })
    .map(function (row) { return rowToCandidate_(header, row); });
}

function upsertCandidates_(candidates) {
  const sheet = getCandidatesSheet_();
  const lastRow = sheet.getLastRow();
  const idToRow = {};
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function (r, i) {
      if (r[0]) idToRow[String(r[0])] = i + 2;
    });
  }
  const append = [];
  let updated = 0;
  (candidates || []).forEach(function (candidate) {
    if (!candidate || !candidate.id) return;
    const row = candidateToRow_(candidate);
    const existing = idToRow[String(candidate.id)];
    if (existing > 0) {
      sheet.getRange(existing, 1, 1, CANDIDATE_FIELDS.length).setValues([row]);
      updated++;
    } else {
      append.push(row);
      idToRow[String(candidate.id)] = -1;
    }
  });
  if (append.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, append.length, CANDIDATE_FIELDS.length).setValues(append);
  }
  return { updated: updated, added: append.length };
}

function clearCandidates_() {
  const sheet = getCandidatesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
  return { cleared: Math.max(lastRow - 1, 0) };
}

function readAllComments_() {
  const sheet = getCommentsSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const header = values[0].map((h) => String(h).trim());
  return values.slice(1)
    .filter((row) => row[header.indexOf("candidateId")])
    .map((row) => {
      const obj = {};
      header.forEach((key, i) => {
        obj[key] = row[i] == null ? "" : String(row[i]);
      });
      return obj;
    });
}

function readAllRows_() {
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  const header = values[0].map((h) => String(h).trim());
  return values.slice(1)
    .filter((row) => row[header.indexOf("id")]) // boş satırları atla
    .map((row) => {
      const obj = {};
      header.forEach((key, i) => {
        let v = row[i];
        if (key === "urgent" || key === "active") {
          v = v === true || v === "TRUE" || v === "true";
        } else if (key === "lat" || key === "lng") {
          v = Number(v);
        } else if (key === "capacity") {
          // Boş hücre = sınırsız kontenjan (null); dolu hücre sayıya çevrilir.
          v = v === "" || v == null ? null : Number(v);
        } else {
          v = v == null ? "" : String(v);
        }
        obj[key] = v;
      });
      return obj;
    });
}

function findRowIndexById_(id) {
  const sheet = getSheet_();
  const ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2; // 1-index + header satırı
  }
  return -1;
}

/**
 * Tek seferlik kurulum yardımcısı: "Projeler" sekmesi tamamen boşsa (henüz
 * hiç satır eklenmemişse) data.js'teki 21 gerçek projeyi Sheet'e yazar.
 * Apps Script editöründe Çalıştır menüsünden manuel tetiklenir. Sheet'te
 * zaten veri varsa hiçbir şey yapmadan çıkar — güvenle tekrar çalıştırılabilir.
 * Sütun sırası FIELDS ile aynıdır; sondaki iki değer capacity ve position.
 */
function seedIfEmpty() {
  const sheet = getSheet_();
  if (sheet.getLastRow() > 1) return; // zaten veri var, dokunma
  const rows = [
    ["proj_bezmialem_hastanesi", "Bezmialem Hastanesi Vatan Temizlik Hizmeti", "Temizlik", "Topkapı, Fatih", 41.0188294, 28.9350771, "stop_emniyet_fatih", "07.30-17.30", "28.000₺", "Yemekhane", "Servis", "Projeye yönlendirilecek — Operasyon: Kemal Çalış / İK: Mustfa Kerem As", "Kadın/Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_calik_holding", "Çalık Holding Temizlik Hizmeti", "Temizlik", "Esentepe, Zincirlikuyu", 41.0711609, 29.015096, "stop_gayrettepe", "08.00-17.30", "29.000₺", "550₺", "3.628₺", "Projeye yönlendirilecek — Operasyon: Feridun Aksu / İK: Haşim Berkay Aslıhak", "Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_havas_istanbul_havalimani", "Havaş İstanbul Havalimanı Temizlik Hizmeti", "Temizlik", "Tayakadın, Arnavutköy", 41.2761476, 28.7287349, "stop_istanbul_havalimani", "08.00-17.00/16.00-24.00", "34.000₺", "Yemekhane", "Servis", "Telefon görüşmesi — Operasyon: Feridun Aksu / İK: Ahmet Berat İmamoğlu", "Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_haribo", "Haribo", "Temizlik", "Ömerli, Arnavutköy", 41.1244293, 28.6334334, "stop_kayasehir", "08:00-17:00/16:00-24:00", "34.000₺", "Yemekhane", "Servis", "Telefon görüşmesi — Operasyon: Rıdvan Altuntaş / İK: Ali Remzi Adar", "Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_kuzey_marmara_santiye", "Kuzey Marmara Şantiye Temizlik Hizmeti", "Temizlik", "Sazlıdere, Başakşehir", 41.1059147, 28.718574, "stop_toplu_konutlar", "08:00-17:00", "30.000₺", "Yemekhane", "Servis", "Telefon görüşmesi — Operasyon: Kemal Çalış / İK: Ahmet Berat İmamoğlu", "Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_kadir_has_universitesi", "Kadir Has Üniversitesi Cibali Ana Kampüs Temizlik Hizmeti", "Temizlik", "Cibali, Fatih", 41.0249511, 28.9589739, "stop_cibali", "07:00-16:00/07:00-17:00", "30.000₺", "330₺", "Multinet", "Projeye yönlendirilecek — Operasyon: Kemal Çalış / İK: Haşim Berkay Aslıhak", "Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_enka_okullari", "Enka Okulları İstinye Temizlik Hizmeti", "Temizlik", "İstinye, Sarıyer", 41.1139318, 29.0359938, "stop_ataturk_oto_sanayi", "07:30-16:00/10:30-19:00", "34.000₺", "Yemekhane", "3.628₺", "Projeye yönlendirilecek — Operasyon: Kemal Çalış / İK: Ece Uğurlu", "Kadın/Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_adidas_capacity", "Adidas Capacity", "Temizlik", "Ataköy, Bakırköy", 40.9777011, 28.8713911, "stop_bakirkoy", "09:45-11:45", "14.170₺", "-", "-", "Telefon görüşmesi — Operasyon: Feridun Aksu / İK: Aybars Zeki", "Kadın", false, true, "", "Temizlik Görevlisi"],
    ["proj_adidas_cevahir", "Adidas Cevahir", "Temizlik", "Büyükdere, Şişli", 41.0620365, 28.9929816, "stop_sisli", "09:45-11:45", "14.170₺", "-", "-", "Telefon görüşmesi — Operasyon: Feridun Aksu / İK: Aybars Zeki", "Kadın", false, true, "", "Temizlik Görevlisi"],
    ["proj_gap_tarlabasi", "Gap Tarlabaşı", "Temizlik", "Tarlabaşı, Beyoğlu", 41.03668, 28.9803363, "stop_huseyin_aga_camii", "07.00-17.00", "29.400₺", "550₺", "3.628₺", "Projeye yönlendirilecek — Operasyon: Feridun Aksu / İK: Haşim Berkay Aslıhak", "Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_halic_universitesi_bahcivan", "Haliç Üniversitesi Temizlik Hizmeti", "Temizlik", "5. Levent, Alibeyköy", 41.0858518, 28.9521866, "stop_alibeykoy_cep_otogari", "08.30-17.30", "32.500₺", "Yemekhane", "3.628₺", "Projeye yönlendirilecek — Operasyon: Kemal Çalış / İK: Ece Uğurlu", "Erkek", false, true, "", "Bahçıvan"],
    ["proj_halic_universitesi", "Haliç Üniversitesi Temizlik Hizmeti", "Temizlik", "5. Levent, Alibeyköy", 41.0858518, 28.9521866, "stop_alibeykoy_cep_otogari", "08.00-17.00", "32.500₺", "Yemekhane", "3.628₺", "Projeye yönlendirilecek — Operasyon: Kemal Çalış / İK: Ece Uğurlu", "Kadın", false, true, "", "Temizlik Görevlisi"],
    ["proj_pamir_gida_haribo", "Pamir Gıda (Haribo) Temizlik Hizmeti", "Temizlik", "Ömerli, Arnavutköy", 41.1244293, 28.6334334, "stop_kayasehir", "07:00-15:00", "42.500₺", "Yemekhane", "Servis", "Projeye yönlendirilecek — Operasyon: Rıdvan Altuntaş / İK: Ahmet Berat İmamoğlu", "Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_bilgili_holding_akaretler", "Bilgili Holding / Akaretler Beşiktaş", "Temizlik", "Akaretler, Beşiktaş", 41.0431457, 29.0024549, "stop_besiktas_iskele", "07.00-15.00/13.00-21.00", "34.900₺", "8.690₺", "3.628₺", "Projeye yönlendirilecek — Operasyon: Feridun Aksu / İK: Ece Uğurlu", "Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_aras_kargo_ikitelli", "Aras Kargo İkitelli", "Temizlik", "Başakşehir", 41.0952146, 28.8003704, "stop_basak_konutlari", "08.00-17.30", "35.000₺", "8.300₺", "3.628₺", "Telefon görüşmesi — Operasyon: Rıdvan Altuntaş / İK: Ali Remzi Adar", "Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_metro_properties_beylikduzu", "Metro Properties Beylikdüzü AVM", "Temizlik", "Çelebi Mehmet Cd., Esenyurt", 41.0092874, 28.6600973, "stop_halkali", "08:00-15:00/15:00-22:00", "28.000₺", "10.000₺", "3.567₺ Multinet", "Telefon görüşmesi — Operasyon: Rıdvan Altuntaş / İK: Ali Remzi Adar", "Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_akbank_bankacilik_merkezi_gebze", "Akbank Bankacılık Merkezi - Gebze", "Temizlik", "Şekerpınar, Çayırova, Kocaeli", 40.860809, 29.375146, "stop_gtu_fatih", "07.00-15.00/15.00-23.00", "36.333₺", "16.900₺", "Servis", "Telefon görüşmesi / banka müşteri onayı — Operasyon: Mehmet Bayraktar / İK: Kerem Evcil", "Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_sabiha_gokcen_havalimani", "Sabiha Gökçen Havalimanı", "Temizlik", "Kurtköy, Pendik", 40.918454, 29.32171, "stop_sabiha_gokcen_havalimani", "07.00-15.00/15.00-23.00/23.00-07.00", "41.773₺", "Projede", "Servis", "Projeye yönlendirilecek — İK: Ali Berk Topçakar", "Kadın/Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_hilltown_avm", "Hilltown AVM", "Temizlik", "Aydınevler, Maltepe", 40.952614, 29.122145, "stop_kucukyali", "07.00-15.00/14.30-22.30", "38.497₺", "7.200₺", "3.300₺", "Projeye yönlendirilecek — Operasyon: Tolga Aydın / İK: Tarık Öznur", "Kadın/Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_medicalpark_goztepe", "Medicalpark Göztepe", "Temizlik", "Göztepe, Kadıköy", 40.987753, 29.067699, "stop_goztepe", "07.00-15.00/15.00-23.00/23.00-07.00", "29.200₺", "Projede", "3.300₺ Multinet", "Projeye yönlendirilecek — Operasyon: Şirali Kılınç", "Kadın/Erkek", false, true, "", "Temizlik Görevlisi"],
    ["proj_medicalpark_kocaeli", "Medicalpark Kocaeli", "Temizlik", "Başiskele, Kocaeli", 40.729671, 29.993913, "stop_gebze", "07.00-15.00/15.00-23.00/23.00-07.00", "29.200₺", "Projede", "3.000₺ Multinet", "Projeye yönlendirilecek — Operasyon: Şirali Kılınç / İK: Kerem Evcil", "Kadın", false, true, "", "Temizlik Görevlisi"],
  ];
  sheet.getRange(2, 1, rows.length, FIELDS.length).setValues(rows);
}

function doGet(e) {
  ensureLaterAddedColumns_();
  const projects = readAllRows_();
  const comments = readAllComments_();
  const candidates = readAllCandidates_();
  return ContentService.createTextOutput(JSON.stringify({ ok: true, projects, comments, candidates }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonError_("Geçersiz istek gövdesi");
  }

  const action = body.action;

  // AI istekleri Sheet'e dokunmaz — sheet kilidinin dışında, hemen işlenir
  // (aksi halde bir Gemini çağrısı sürerken diğer kullanıcıların proje
  // kaydetme/güncelleme istekleri gereksiz yere bekler).
  if (action === "aiComplete") {
    return callGemini_(body.system, body.prompt, body.maxTokens);
  }

  const sheet = getSheet_();

  // Aynı anda birden fazla yazma isteği gelirse (ör. birkaç kişi aynı anda
  // kaydet'e basarsa) satır numaraları kayabilir ve yanlış satırlar
  // güncellenebilir — bu kilit, bir istek bitmeden diğerinin başlamasını
  // engelleyerek bunu önler.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (action === "add") {
      ensureLaterAddedColumns_();
      const p = body.project || {};
      if (!p.name) return jsonError_("name zorunlu");
      const id = p.id || ("proj_" + p.name.toLowerCase()
        .replace(/[ığüşöçİĞÜŞÖÇ]/g, (c) => ({ "ı": "i", "ğ": "g", "ü": "u", "ş": "s", "ö": "o", "ç": "c", "İ": "i", "Ğ": "g", "Ü": "u", "Ş": "s", "Ö": "o", "Ç": "c" }[c] || c))
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") + "_" + Date.now().toString(36));
      const row = FIELDS.map((f) => {
        if (f === "id") return id;
        if (f === "urgent" || f === "active") return p[f] ? true : (f === "active" ? true : false);
        return p[f] != null ? p[f] : "";
      });
      sheet.appendRow(row);
      return jsonOk_({ id });
    }

    if (action === "update") {
      const id = body.id;
      const patch = body.patch || {};
      if (!id) return jsonError_("id zorunlu");
      const rowIndex = findRowIndexById_(id);
      if (rowIndex === -1) return jsonError_("proje bulunamadı: " + id);
      const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      Object.keys(patch).forEach((key) => {
        const col = header.indexOf(key);
        if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(patch[key]);
      });
      return jsonOk_({ id });
    }

    // Birden fazla projeyi TEK bir istekte günceller — ama SADECE gerçekten
    // değişen hücrelere yazar. (ÖNEMLİ: önceki sürüm bütün satırı okuyup
    // range.setValues() ile TÜMÜNÜ geri yazıyordu; bu, dokunulmayan lat/lng
    // hücrelerinin bile Sheets tarafından yeniden yorumlanıp ondalık
    // noktalarının silinmesine — ör. 39.87 -> 3987 — yol açtı ve TÜM
    // projelerin koordinatını bozdu. Şimdi sadece id sütunu okunuyor, her
    // patch yalnızca kendi hücresine yazılıyor; başka hiçbir hücreye
    // dokunulmuyor.)
    if (action === "updateBatch") {
      ensureLaterAddedColumns_();
      const patches = body.patches || []; // [{ id, patch }, ...]
      const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      const idCol = header.indexOf("id");
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return jsonOk_({ updated: 0, notFound: patches.map((p) => p.id) });
      const idValues = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
      const idToRow = {};
      idValues.forEach((r, i) => { idToRow[r[0]] = i + 2; }); // 1-index + başlık satırı

      const notFound = [];
      let updated = 0;
      patches.forEach(({ id, patch }) => {
        const row = idToRow[id];
        if (row === undefined) { notFound.push(id); return; }
        Object.keys(patch || {}).forEach((key) => {
          const col = header.indexOf(key);
          if (col !== -1) sheet.getRange(row, col + 1).setValue(patch[key]);
        });
        updated++;
      });
      return jsonOk_({ updated, notFound });
    }

    if (action === "remove") {
      const id = body.id;
      if (!id) return jsonError_("id zorunlu");
      const rowIndex = findRowIndexById_(id);
      if (rowIndex === -1) return jsonError_("proje bulunamadı: " + id);
      sheet.deleteRow(rowIndex);
      return jsonOk_({ id });
    }

    if (action === "addComment") {
      const c = body.comment || {};
      if (!c.candidateId || !c.author || !c.text) {
        return jsonError_("candidateId, author ve text zorunlu");
      }
      const record = {
        candidateId: c.candidateId,
        candidateName: c.candidateName || "",
        author: c.author,
        text: c.text,
        createdAt: new Date().toISOString(),
      };
      getCommentsSheet_().appendRow(COMMENT_FIELDS.map((f) => record[f]));
      return jsonOk_({ comment: record });
    }

    // Bir yorumu candidateId+createdAt eşleşmesiyle bulup satırı siler (ör.
    // hatalı/test amaçlı girilmiş bir yorumu temizlemek için). createdAt her
    // yorumda benzersiz olduğundan (appendRow anında üretilir) bu ikili tek
    // bir satırı işaret etmeye yeter.
    if (action === "upsertCandidates") {
      return jsonOk_(upsertCandidates_(body.candidates || []));
    }

    if (action === "clearCandidates") {
      return jsonOk_(clearCandidates_());
    }

    if (action === "removeComment") {
      const target = body.comment || {};
      if (!target.candidateId || !target.createdAt) return jsonError_("candidateId ve createdAt zorunlu");
      const commentsSheet = getCommentsSheet_();
      const values = commentsSheet.getDataRange().getValues();
      const header = values[0].map(String);
      const candCol = header.indexOf("candidateId");
      const createdCol = header.indexOf("createdAt");
      for (let r = values.length - 1; r >= 1; r--) {
        if (String(values[r][candCol]) === target.candidateId && String(values[r][createdCol]) === target.createdAt) {
          commentsSheet.deleteRow(r + 1);
          return jsonOk_({ removed: true });
        }
      }
      return jsonError_("yorum bulunamadı");
    }

    return jsonError_("bilinmeyen action: " + action);
  } catch (err) {
    return jsonError_(String(err));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Google Gemini API'ye tek seferlik bir tamamlama isteği gönderir — İK
 * ekibine sunulan AI özellikleri (eşleşme gerekçesi, doğal dil filtre,
 * sütun eşleştirme önerisi) hepsi bu tek genel amaçlı uç noktayı kullanır.
 * API anahtarı bilerek istemci tarafında (app.js) DEĞİL, burada, Apps
 * Script "Script Özellikleri"nde tutulur — statik bir sitede anahtarı
 * tarayıcıya koymak herkese açık hale getirir.
 *
 * Kurulum: https://aistudio.google.com/apikey üzerinden ücretsiz bir
 * Gemini API anahtarı alın, sonra Apps Script editöründe Proje Ayarları >
 * Script Özellikleri'ne GEMINI_API_KEY adında bir özellik ekleyip bu
 * anahtarı değer olarak girin.
 */
function callGemini_(system, prompt, maxTokens) {
  if (!prompt) return jsonError_("prompt zorunlu");
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) {
    return jsonError_("GEMINI_API_KEY tanımlı değil — Apps Script > Proje Ayarları > Script Özellikleri'nden ekleyin (aistudio.google.com/apikey'den ücretsiz alınır).");
  }
  // Model, görünür metinden ÖNCE değişken miktarda "düşünme" tokenı da
  // harcıyor (thinkingConfig bu modelde desteklenmiyor — "invalid argument"
  // hatası verdi; sabit bir alt sınır tahmini de yetmedi, görev karmaşıklığına
  // göre değişiyor — canlı testte gözlemlendi). Bu yüzden çağıranın istediği
  // değer YOK SAYILIYOR, her istekte doğrudan izin verilen tavan (2048)
  // kullanılıyor — bu kısa, tek seferlik İK istekleri için maliyet önemsiz.
  const payload = {
    contents: [{ role: "user", parts: [{ text: String(prompt) }] }],
    generationConfig: { maxOutputTokens: 2048 },
  };
  if (system) payload.systemInstruction = { parts: [{ text: String(system) }] };

  const model = "gemini-flash-lite-latest";
  const res = UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(apiKey),
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    }
  );

  let data;
  try {
    data = JSON.parse(res.getContentText());
  } catch (err) {
    return jsonError_("Gemini yanıtı ayrıştırılamadı: " + res.getContentText());
  }
  if (res.getResponseCode() !== 200) {
    return jsonError_("Gemini API hatası: " + ((data.error && data.error.message) || res.getContentText()));
  }
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts.map((p) => p.text || "").join("");
  return jsonOk_({ text });
}

function jsonOk_(extra) {
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ ok: true }, extra)))
    .setMimeType(ContentService.MimeType.JSON);
}
function jsonError_(message) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
