/**
 * İstanbul Ulaşım & Proje Eşleştirme Modülü — paylaşımlı proje veritabanı + aday yorumları + AI.
 * Ankara'daki (ikmaps) Code.gs'in İSTANBUL İÇİN AYRI bir kopyası — kendi
 * Google Sheet'ine yazar, Ankara'nınkine dokunmaz.
 *
 * Kurulum: bu dosyayı, İstanbul için oluşturulan (Ankara'dan bağımsız) yeni
 * bir Google Sheet'te Uzantılar > Apps Script menüsünden açılan editöre
 * YAPIŞTIR, "seedIfEmpty" fonksiyonunu bir kez çalıştır (16 projeyi yazar),
 * sonra Dağıt > Yeni Dağıtım > Web Uygulaması (Execute as: Me, Who has
 * access: Anyone) ile yayınla. Çıkan /exec URL'ini ikmaps-istanbul/app.js'teki
 * SHEET_API_URL'e yapıştır (aday yorumları ve AI de aynı URL'i kullanır).
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
 * hiç satır eklenmemişse) data.js'teki 16 gerçek projeyi Sheet'e yazar.
 * Apps Script editöründe Çalıştır menüsünden manuel tetiklenir. Sheet'te
 * zaten veri varsa hiçbir şey yapmadan çıkar — güvenle tekrar çalıştırılabilir.
 */
function seedIfEmpty() {
  const sheet = getSheet_();
  if (sheet.getLastRow() > 1) return; // zaten veri var, dokunma
  const rows = [
    ["proj_bezmialem_hastanesi_vatan_tem_hiz", "Bezmialem Hastanesi Vatan Tem. Hiz.", "Temizlik", "Topkapı, Fatih", 41.018829, 28.935077, "stop_capa_sehremini", "07.30-17.30", "28.000₺", "Yemekhane", "Servis", "Projeye yönlendirilecek — Operasyon: Kemal Çalış / İK: Mustafa Kerem As", "Kadın/Erkek", false, true],
    ["proj_calik_holding_temizlik_hizmeti", "Çalık Holding Temizlik Hizmeti", "Temizlik", "Esentepe, Zincirlikuyu", 41.071161, 29.015096, "stop_gayrettepe", "08.00-17.30", "29.000₺", "550₺", "3.628₺", "Projeye yönlendirilecek — Operasyon: Feridun Aksu / İK: Haşim Berkay Aslıhak", "Erkek", false, true],
    ["proj_havas_istanbul_havalimani_tem_hiz", "Havaş İstanbul Havalimanı Tem. Hiz.", "Temizlik", "Tayakadın, Arnavutköy", 41.276148, 28.728735, "stop_istanbul_havalimani", "08.00-17.00/16.00-24.00", "34.000₺", "Yemekhane", "Servis", "Telefon görüşmesi — Operasyon: Feridun Aksu / İK: Ahmet Berat İmamoğlu", "Erkek", false, true],
    ["proj_haribo_temizlik_hizmeti", "Haribo Temizlik Hizmeti", "Temizlik", "Ömerli, Arnavutköy", 41.124429, 28.633433, "stop_tasoluk", "08:00-17:00 / 16:00-24:00", "34.000₺", "Yemekhane", "Servis", "Telefon görüşmesi — Operasyon: Rıdvan Altuntaş / İK: Ali Remzi Adar", "Erkek", false, true],
    ["proj_kuzey_marmara_santiye_tem_hiz", "Kuzey Marmara Şantiye Tem. Hiz.", "Temizlik", "Sazlıdere, Başakşehir", 41.105915, 28.718574, "stop_kayasehir", "08:00-17:00", "30.000₺", "Yemekhane", "Servis", "Telefon görüşmesi — Operasyon: Kemal Çalış / İK: Ahmet Berat İmamoğlu", "Erkek", false, true],
    ["proj_kadir_has_uni_cibali_ana_kampus_tem_hiz", "Kadir Has Üni. Cibali Ana Kampüs Tem. Hiz.", "Temizlik", "Cibali, Fatih", 41.024951, 28.958974, "stop_cibali", "07:00-16:00 / 07:00-17:00", "30.000₺", "330₺", "Multinet", "Projeye yönlendirilecek — Operasyon: Kemal Çalış / İK: Haşim Berkay Aslıhak", "Erkek", false, true],
    ["proj_enka_okullari_istinye_temizlik_hiz", "Enka Okulları İstinye Temizlik Hiz.", "Temizlik", "İstinye, Sarıyer", 41.113932, 29.035994, "stop_ataturk_oto_sanayi", "07:30-16:00 / 10:30-19:00", "34.000₺", "Yemekhane", "3.628₺", "Projeye yönlendirilecek — Operasyon: Kemal Çalış / İK: Ece Uğurlu", "Kadın/Erkek", false, true],
    ["proj_adidas_capacity", "Adidas Capacity", "Temizlik", "Ataköy, Bakırköy", 40.977701, 28.871391, "stop_bakirkoy", "09:45-11:45", "14.170₺", "-", "-", "Telefon görüşmesi — Operasyon: Feridun Aksu / İK: Aybars Zeki", "Kadın", false, true],
    ["proj_adidas_cevahir", "Adidas Cevahir", "Temizlik", "Büyükdere, Şişli", 41.062036, 28.992982, "stop_sisli", "09:45-11:45", "14.170₺", "-", "-", "Telefon görüşmesi — Operasyon: Feridun Aksu / İK: Aybars Zeki", "Kadın", false, true],
    ["proj_gap_tarlabasi", "Gap Tarlabaşı", "Temizlik", "Tarlabaşı, Beyoğlu", 41.03668, 28.980336, "stop_huseyin_aga_camii", "07.00-17.00", "29.400₺", "550₺", "3.628₺", "Projeye yönlendirilecek — Operasyon: Feridun Aksu / İK: Haşim Berkay Aslıhak", "Erkek", false, true],
    ["proj_halic_universitesi_temizlik_hizmeti", "Haliç Üniversitesi Temizlik Hizmeti", "Temizlik", "5.Levent, Alibeyköy", 41.085852, 28.952187, "stop_alibeykoy", "08.30-17.30", "32.500₺", "Yemekhane", "3.628₺", "Projeye yönlendirilecek — Operasyon: Kemal Çalış / İK: Ece Uğurlu", "Erkek", false, true],
    ["proj_halic_universitesi_temizlik_hizmeti_2", "Haliç Üniversitesi Temizlik Hizmeti", "Temizlik", "5.Levent, Alibeyköy", 41.085852, 28.952187, "stop_alibeykoy", "08.00-17.00", "32.500₺", "Yemekhane", "3.628₺", "Projeye yönlendirilecek — Operasyon: Kemal Çalış / İK: Ece Uğurlu", "Kadın", false, true],
    ["proj_pamir_gida", "Pamir Gıda (Haribo) Temizlik Hizm.", "Temizlik", "Ömerli, Arnavutköy", 41.124429, 28.633433, "stop_tasoluk", "07:00-15:00 / 15:00-23:00 / 23:00-07:00", "42.500₺", "Yemekhane", "Servis", "Projeye yönlendirilecek — Operasyon: Rıdvan Altuntaş / İK: Ahmet Berat İmamoğlu", "Erkek", false, true],
    ["proj_bilgili_holding", "Bilgili Holding / Akaretler Beşiktaş", "Temizlik", "Akaretler, Beşiktaş", 41.043146, 29.002455, "stop_besiktas_iskele", "07.00-15.00 / 13.00-21.00", "34.900₺", "8.690₺", "3.628₺", "Projeye yönlendirilecek — Operasyon: Feridun Aksu / İK: Ece Uğurlu", "Erkek", false, true],
    ["proj_aras_kargo_ikitelli", "Aras Kargo İkitelli", "Temizlik", "İkitelli, Başakşehir", 41.095215, 28.80037, "stop_siteler", "08.00-17.30", "35.000₺", "8.300₺", "3.628₺", "Telefon görüşmesi — Operasyon: Rıdvan Altuntaş / İK: Ali Remzi Adar", "Erkek", false, true],
    ["proj_metro_properties_beylikduzu_avm_tem_hiz", "Metro Properties - Beylikdüzü AVM Tem. Hiz.", "Temizlik", "Çelebi Mehmet Cd. (E5 Yan Yol), Esenyurt", 41.009287, 28.660097, "stop_halkali", "08:00-15:00 / 15:00-22:00", "28.000₺", "10.000₺", "3.567₺ Multinet", "Telefon görüşmesi — Operasyon: Rıdvan Altuntaş / İK: Ali Remzi Adar", "Erkek", false, true],
  ];
  // Seed satırları eski (kontenjan/pozisyon öncesi) sütun düzeninde; sondaki iki
  // sütunu (capacity, position) burada ekliyoruz. Pozisyonlar kaynak Excel'in
  // unvan sütunundan (TEMİZLİK ELEMANI/PERSONELİ -> Temizlik Görevlisi, BAHÇIVAN).
  const POSITION_BY_ID = { proj_halic_universitesi_temizlik_hizmeti: "Bahçıvan" };
  const full = rows.map((r) => r.concat(["", POSITION_BY_ID[r[0]] || "Temizlik Görevlisi"]));
  sheet.getRange(2, 1, full.length, FIELDS.length).setValues(full);
}

function doGet(e) {
  ensureLaterAddedColumns_();
  const projects = readAllRows_();
  const comments = readAllComments_();
  return ContentService.createTextOutput(JSON.stringify({ ok: true, projects, comments }))
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
