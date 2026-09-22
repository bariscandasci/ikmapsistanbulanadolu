/**
 * ISTANBUL_DATA — Ulaşım & Proje Eşleştirme Modülü veri modeli (İstanbul).
 *
 * Bu dosya classic <script> olarak yüklenir (ES module DEĞİL) ki index.html
 * dosya sisteminden (file://) çift tıklanarak da açılabilsin.
 *
 * DURUM (İSKELET AŞAMASI — güncelleme: 2026-09-07)
 * -------------------------------------------------
 * Bu, Ankara modülünün (ikmaps-main) İstanbul için İSKELET/altyapı sürümüdür.
 * Aşağıdakiler henüz GERÇEK ŞİRKET VERİSİ DEĞİL, yer tutucudur:
 *
 *   1. projects[] — "ÖRNEK" ön ekli birkaç kurgusal proje. Gerçek Tepe
 *      Destek İstanbul proje portföyü (adres, koordinat, vardiya, maaş,
 *      yemek, servis, referans) İK'dan alınıp bu diziye işlenmeli — bkz.
 *      Ankara'daki ikmaps-main/data.js'in projects[] alanı örnek format için.
 *   2. districts[] — İstanbul'un 39 ilçesinden 16'sı (8 Avrupa + 8 Anadolu
 *      yakası) ve her birinden 2 mahalle seçildi; koordinatlar ilçe/mahalle
 *      merkezine yakın kabaca değerlerdir (proje pini hassasiyeti değil,
 *      "adayın bulunduğu bölge" seçimi için yeterli). Kapsam genişletilebilir.
 *
 * transitStops[] / transitLines[] / hubStopIds[] (raylı sistem — metro/tramvay/
 * Marmaray/füniküler) OpenStreetMap/Overpass API'den GERÇEK istasyon adı ve
 * sırasıyla çekildi (bkz. ilgili blok başındaki kaynak notu). Bunun ÜSTÜNE,
 * Ankara'daki transit_network.json'ın muadili olarak İETT'nin RESMİ GTFS
 * verisinden (İBB Açık Veri Portalı, data.ibb.gov.tr/dataset/iett-gtfs-verisi,
 * 21.04.2026 tarihli, indirilme 2026-09-07) 1486 gerçek otobüs hattı ve 13.183
 * gerçek durak eklendi — bkz. proje kökündeki transit_network.json. Bu hatlar
 * ana rota motoruna (resolveTransfer/BFS) DAHİL DEĞİL, sadece adres aramasında
 * "yakında hangi otobüsler geçiyor" bilgisini (discoverNearbyTransitLocal)
 * besliyor. Kapsam notu: GTFS feed'inde her hat numarası+yön için BİRDEN FAZLA
 * program-varyantı (gün/saat bazlı küçük güzergah farkları) var; her biri için
 * TEK bir temsili varyant (mevcutsa en düşük varyant numaralı, "ana" örüntü)
 * seçildi — 2128 hat+yön kombinasyonundan 642'sinin GTFS'te hiç aktif seferi
 * yoktu (muhtemelen iptal/mevsimlik), bu yüzden 1486 hatla sonuçlandı.
 * transit_network_geometry.json boş kaldı — bu GTFS feed'i shapes.txt (gerçek
 * güzergah şekli) içermiyor; haritada rotalar düz/kesikli çizgiyle çizilir.
 *
 * Şema, Ankara'daki (ANKARA_DATA) ile birebir aynıdır — bkz. o dosyanın
 * başındaki şema açıklaması.
 */

const ISTANBUL_DATA = {
  districts: [
    // --- AVRUPA YAKASI ---
    {
      id: "besiktas", name: "Beşiktaş", lat: 41.0422, lng: 29.0060, accessStopId: "stop_kabatas",
      neighborhoods: [
        { id: "besiktas_levent", name: "Levent", lat: 41.0815, lng: 29.0119, accessStopId: "stop_levent" },
        { id: "besiktas_etiler", name: "Etiler", lat: 41.0789, lng: 29.0339, accessStopId: "stop_etiler" },
      ],
    },
    {
      id: "sisli", name: "Şişli", lat: 41.0602, lng: 28.9877, accessStopId: "stop_sisli",
      neighborhoods: [
        { id: "sisli_mecidiyekoy", name: "Mecidiyeköy", lat: 41.0670, lng: 28.9950, accessStopId: "stop_mecidiyekoy" },
        { id: "sisli_nisantasi", name: "Nişantaşı", lat: 41.0480, lng: 28.9940, accessStopId: "stop_osmanbey" },
      ],
    },
    {
      id: "bakirkoy", name: "Bakırköy", lat: 40.9819, lng: 28.8772, accessStopId: "stop_bakirkoy",
      neighborhoods: [
        { id: "bakirkoy_yesilkoy", name: "Yeşilköy", lat: 40.9686, lng: 28.8250, accessStopId: "stop_yesilkoy" },
        { id: "bakirkoy_florya", name: "Florya", lat: 40.9760, lng: 28.7930, accessStopId: "stop_florya" },
      ],
    },
    {
      id: "bagcilar", name: "Bağcılar", lat: 41.0390, lng: 28.8560, accessStopId: "stop_bagcilar_meydan",
      neighborhoods: [
        { id: "bagcilar_merkez", name: "Bağcılar Merkez", lat: 41.0390, lng: 28.8560, accessStopId: "stop_kirazli" },
        { id: "bagcilar_gunesli", name: "Güneşli", lat: 41.0620, lng: 28.8390, accessStopId: "stop_kirazli" },
      ],
    },
    // Not: Esenyurt, çekilen gerçek raylı sistem verisinde henüz doğrudan
    // kapsanmıyor (M1B'nin gerçek OSM'deki ucu Kirazlı) — en yakın gerçek
    // aktarma noktası (Kirazlı) kullanıldı, bu bir YAKLAŞIKLIKTIR.
    {
      id: "esenyurt", name: "Esenyurt", lat: 41.0350, lng: 28.6770, accessStopId: "stop_kirazli",
      neighborhoods: [
        { id: "esenyurt_merkez", name: "Esenyurt Merkez", lat: 41.0350, lng: 28.6770, accessStopId: "stop_kirazli" },
        { id: "esenyurt_pinar", name: "Pınar", lat: 41.0270, lng: 28.6690, accessStopId: "stop_kirazli" },
      ],
    },
    {
      id: "kucukcekmece", name: "Küçükçekmece", lat: 41.0000, lng: 28.7750, accessStopId: "stop_kucukcekmece",
      neighborhoods: [
        { id: "kucukcekmece_halkali", name: "Halkalı", lat: 41.0230, lng: 28.7810, accessStopId: "stop_halkali" },
        { id: "kucukcekmece_sefakoy", name: "Sefaköy", lat: 40.9910, lng: 28.7940, accessStopId: "stop_yesilyurt" },
      ],
    },
    {
      id: "basaksehir", name: "Başakşehir", lat: 41.0930, lng: 28.8010, accessStopId: "stop_sehir_hastanesi",
      neighborhoods: [
        { id: "basaksehir_merkez", name: "Başakşehir Merkez", lat: 41.0930, lng: 28.8010, accessStopId: "stop_sehir_hastanesi" },
        { id: "basaksehir_sultangazi_sinir", name: "Onurkent", lat: 41.0890, lng: 28.7930, accessStopId: "stop_onurkent" },
      ],
    },
    {
      id: "fatih", name: "Fatih", lat: 41.0190, lng: 28.9490, accessStopId: "stop_aksaray",
      neighborhoods: [
        { id: "fatih_aksaray", name: "Aksaray", lat: 41.0110, lng: 28.9540, accessStopId: "stop_aksaray" },
        { id: "fatih_yenikapi", name: "Yenikapı", lat: 41.0010, lng: 28.9500, accessStopId: "stop_yenikapi" },
      ],
    },

    // --- ANADOLU YAKASI ---
    {
      id: "kadikoy", name: "Kadıköy", lat: 40.9906, lng: 29.0274, accessStopId: "stop_kadikoy",
      neighborhoods: [
        { id: "kadikoy_bostanci", name: "Bostancı", lat: 40.9600, lng: 29.0940, accessStopId: "stop_bostanci" },
        { id: "kadikoy_fenerbahce", name: "Fenerbahçe", lat: 40.9760, lng: 29.0400, accessStopId: "stop_bahariye" },
      ],
    },
    {
      id: "uskudar", name: "Üsküdar", lat: 41.0226, lng: 29.0150, accessStopId: "stop_uskudar",
      neighborhoods: [
        { id: "uskudar_altunizade", name: "Altunizade", lat: 41.0180, lng: 29.0570, accessStopId: "stop_altunizade" },
        { id: "uskudar_umraniye_sinir", name: "Bulgurlu", lat: 41.0170, lng: 29.0630, accessStopId: "stop_bulgurlu" },
      ],
    },
    {
      id: "umraniye", name: "Ümraniye", lat: 41.0160, lng: 29.1240, accessStopId: "stop_umraniye",
      neighborhoods: [
        { id: "umraniye_merkez", name: "Ümraniye Merkez", lat: 41.0160, lng: 29.1240, accessStopId: "stop_umraniye" },
        { id: "umraniye_carsi", name: "Çarşı", lat: 41.0230, lng: 29.0940, accessStopId: "stop_carsi_2" },
      ],
    },
    {
      id: "atasehir", name: "Ataşehir", lat: 40.9920, lng: 29.1270, accessStopId: "stop_kozyatagi",
      neighborhoods: [
        { id: "atasehir_merkez", name: "Ataşehir Merkez", lat: 40.9920, lng: 29.1270, accessStopId: "stop_kozyatagi" },
        { id: "atasehir_icerenkoy", name: "İçerenköy", lat: 40.9760, lng: 29.1200, accessStopId: "stop_icerenkoy" },
      ],
    },
    {
      id: "maltepe", name: "Maltepe", lat: 40.9350, lng: 29.1560, accessStopId: "stop_maltepe",
      neighborhoods: [
        { id: "maltepe_merkez", name: "Maltepe Merkez", lat: 40.9350, lng: 29.1560, accessStopId: "stop_maltepe" },
        { id: "maltepe_gulsuyu", name: "Gülsuyu", lat: 40.9280, lng: 29.1350, accessStopId: "stop_gulsuyu" },
      ],
    },
    {
      id: "kartal", name: "Kartal", lat: 40.9060, lng: 29.1900, accessStopId: "stop_kartal",
      neighborhoods: [
        { id: "kartal_merkez", name: "Kartal Merkez", lat: 40.9060, lng: 29.1900, accessStopId: "stop_kartal" },
        { id: "kartal_soganlik", name: "Soğanlık", lat: 40.9100, lng: 29.1700, accessStopId: "stop_soganlik" },
      ],
    },
    {
      id: "pendik", name: "Pendik", lat: 40.8770, lng: 29.2340, accessStopId: "stop_pendik",
      neighborhoods: [
        { id: "pendik_merkez", name: "Pendik Merkez", lat: 40.8770, lng: 29.2340, accessStopId: "stop_pendik" },
        { id: "pendik_kurtkoy", name: "Kurtköy", lat: 40.9040, lng: 29.3170, accessStopId: "stop_kurtkoy" },
      ],
    },
    {
      id: "sancaktepe", name: "Sancaktepe", lat: 41.0000, lng: 29.2330, accessStopId: "stop_sancaktepe",
      neighborhoods: [
        { id: "sancaktepe_merkez", name: "Sancaktepe Merkez", lat: 41.0000, lng: 29.2330, accessStopId: "stop_sancaktepe" },
      ],
    },

    // --- KALAN İLÇELER (39 ilçenin tamamı için) — 2026-09-07 eklendi ---
    // Çoğu, adıyla birebir örtüşen veya çok yakın gerçek bir raylı/vapur
    // durağına bağlandı (ör. Bayrampaşa->stop_bayrampasa_maltepe,
    // Esenler->stop_esenler). Raylı/vapur ağından ÇOK uzak kalan ilçeler
    // (Beykoz, Avcılar, Beylikdüzü, Büyükçekmece, Çatalca, Silivri, Şile)
    // için en yakın GERÇEK İETT otobüs durağı (transit_network.json'dan,
    // isim+mesafeyle bulundu) kullanıldı — bu duraklar gerçek otobüs
    // hatlarıyla ağın geri kalanına bağlı olduğu doğrulandı (BFS testi),
    // ama rayla doğrudan bağlantıları olmadığından süre tahminleri bu
    // ilçeler için daha kaba olacaktır.

    // Avrupa yakası
    {
      id: "zeytinburnu", name: "Zeytinburnu", lat: 40.9950, lng: 28.9020, accessStopId: "stop_zeytinburnu",
      neighborhoods: [
        { id: "zeytinburnu_kazlicesme", name: "Kazlıçeşme", lat: 40.9927, lng: 28.9170, accessStopId: "stop_kazlicesme" },
      ],
    },
    {
      id: "eyupsultan", name: "Eyüpsultan", lat: 41.0480, lng: 28.9339, accessStopId: "stop_eyupsultan_teleferik",
      neighborhoods: [
        { id: "eyupsultan_alibeykoy", name: "Alibeyköy", lat: 41.0792, lng: 28.9496, accessStopId: "stop_alibeykoy" },
      ],
    },
    {
      id: "kagithane", name: "Kağıthane", lat: 41.0796, lng: 28.9731, accessStopId: "stop_kagithane",
      neighborhoods: [
        { id: "kagithane_caglayan", name: "Çağlayan", lat: 41.0708, lng: 28.9806, accessStopId: "stop_caglayan" },
      ],
    },
    {
      id: "beyoglu", name: "Beyoğlu", lat: 41.0370, lng: 28.9850, accessStopId: "stop_taksim",
      neighborhoods: [
        { id: "beyoglu_karakoy", name: "Karaköy", lat: 41.0222, lng: 28.9748, accessStopId: "stop_karakoy" },
        { id: "beyoglu_cihangir", name: "Cihangir", lat: 41.0316, lng: 28.9822, accessStopId: "stop_taksim" },
      ],
    },
    {
      // Not: Sarıyer geniş bir ilçe; en yakın gerçek durak (M2'nin kuzey ucu
      // Hacıosman) merkez/İstinye'ye birkaç km mesafede — yaklaşık kabul edildi.
      id: "sariyer", name: "Sarıyer", lat: 41.1670, lng: 29.0570, accessStopId: "stop_haciosman",
      neighborhoods: [
        { id: "sariyer_maslak", name: "Maslak", lat: 41.1082, lng: 29.0209, accessStopId: "stop_itu_ayazaga" },
        { id: "sariyer_istinye", name: "İstinye", lat: 41.1090, lng: 29.0570, accessStopId: "stop_haciosman" },
      ],
    },
    {
      id: "bayrampasa", name: "Bayrampaşa", lat: 41.0360, lng: 28.9080, accessStopId: "stop_bayrampasa_maltepe",
      neighborhoods: [
        { id: "bayrampasa_merkez", name: "Bayrampaşa Merkez", lat: 41.0360, lng: 28.9080, accessStopId: "stop_bayrampasa_maltepe" },
      ],
    },
    {
      id: "esenler", name: "Esenler", lat: 41.0440, lng: 28.8760, accessStopId: "stop_esenler",
      neighborhoods: [
        { id: "esenler_merkez", name: "Esenler Merkez", lat: 41.0440, lng: 28.8760, accessStopId: "stop_esenler" },
      ],
    },
    {
      id: "gungoren", name: "Güngören", lat: 41.0180, lng: 28.8730, accessStopId: "stop_gungoren",
      neighborhoods: [
        { id: "gungoren_merkez", name: "Güngören Merkez", lat: 41.0180, lng: 28.8730, accessStopId: "stop_gungoren" },
      ],
    },
    {
      id: "bahcelievler", name: "Bahçelievler", lat: 41.0000, lng: 28.8590, accessStopId: "stop_bahcelievler",
      neighborhoods: [
        { id: "bahcelievler_merkez", name: "Bahçelievler Merkez", lat: 41.0000, lng: 28.8590, accessStopId: "stop_bahcelievler" },
      ],
    },
    {
      // Not: en yakın gerçek durak (M7 Veysel Karani-Akşemsettin) merkeze
      // ~2km — yaklaşık kabul edildi.
      id: "gaziosmanpasa", name: "Gaziosmanpaşa", lat: 41.0650, lng: 28.9150, accessStopId: "stop_veysel_karani_aksemsettin",
      neighborhoods: [
        { id: "gaziosmanpasa_merkez", name: "Gaziosmanpaşa Merkez", lat: 41.0650, lng: 28.9150, accessStopId: "stop_veysel_karani_aksemsettin" },
      ],
    },
    {
      // "50. Yıl-Baştabya" (T4) gerçekten Sultangazi'nin 50. Yıl Mahallesi'nde.
      id: "sultangazi", name: "Sultangazi", lat: 41.1070, lng: 28.8670, accessStopId: "stop_50_yil_bastabya",
      neighborhoods: [
        { id: "sultangazi_merkez", name: "Sultangazi Merkez", lat: 41.1070, lng: 28.8670, accessStopId: "stop_50_yil_bastabya" },
      ],
    },
    {
      id: "arnavutkoy", name: "Arnavutköy", lat: 41.1850, lng: 28.7400, accessStopId: "stop_arnavutkoy_hastane",
      neighborhoods: [
        { id: "arnavutkoy_merkez", name: "Arnavutköy Merkez", lat: 41.1850, lng: 28.7400, accessStopId: "stop_arnavutkoy_hastane" },
      ],
    },
    {
      // Raylı/vapur ağından uzak — en yakın GERÇEK İETT durağı kullanıldı
      // (bkz. blok başındaki not).
      id: "avcilar", name: "Avcılar", lat: 40.9800, lng: 28.7210, accessStopId: "iett_509586",
      neighborhoods: [
        { id: "avcilar_merkez", name: "Avcılar Merkez", lat: 40.9800, lng: 28.7210, accessStopId: "iett_509586" },
      ],
    },
    {
      id: "beylikduzu", name: "Beylikdüzü", lat: 41.0020, lng: 28.6400, accessStopId: "iett_5252405",
      neighborhoods: [
        { id: "beylikduzu_merkez", name: "Beylikdüzü Merkez", lat: 41.0020, lng: 28.6400, accessStopId: "iett_5252405" },
      ],
    },
    {
      id: "buyukcekmece", name: "Büyükçekmece", lat: 41.0200, lng: 28.5850, accessStopId: "iett_290569",
      neighborhoods: [
        { id: "buyukcekmece_merkez", name: "Büyükçekmece Merkez", lat: 41.0200, lng: 28.5850, accessStopId: "iett_290569" },
      ],
    },
    {
      id: "catalca", name: "Çatalca", lat: 41.1430, lng: 28.4610, accessStopId: "iett_284339",
      neighborhoods: [
        { id: "catalca_merkez", name: "Çatalca Merkez", lat: 41.1430, lng: 28.4610, accessStopId: "iett_284339" },
      ],
    },
    {
      id: "silivri", name: "Silivri", lat: 41.0730, lng: 28.2470, accessStopId: "iett_284638",
      neighborhoods: [
        { id: "silivri_merkez", name: "Silivri Merkez", lat: 41.0730, lng: 28.2470, accessStopId: "iett_284638" },
      ],
    },

    // Anadolu yakası
    {
      id: "adalar", name: "Adalar", lat: 40.8747, lng: 29.1256, accessStopId: "stop_buyukada",
      neighborhoods: [
        { id: "adalar_heybeliada", name: "Heybeliada", lat: 40.8780, lng: 29.1014, accessStopId: "stop_heybeliada" },
        { id: "adalar_burgazada", name: "Burgazada", lat: 40.8811, lng: 29.0708, accessStopId: "stop_burgazada" },
      ],
    },
    {
      // Raylı/vapur ağından uzak — en yakın GERÇEK İETT durağı kullanıldı.
      id: "beykoz", name: "Beykoz", lat: 41.1250, lng: 29.0930, accessStopId: "iett_293015",
      neighborhoods: [
        { id: "beykoz_merkez", name: "Beykoz Merkez", lat: 41.1250, lng: 29.0930, accessStopId: "iett_293015" },
      ],
    },
    {
      id: "cekmekoy", name: "Çekmeköy", lat: 41.0145, lng: 29.1895, accessStopId: "stop_cekmekoy",
      neighborhoods: [
        { id: "cekmekoy_merkez", name: "Çekmeköy Merkez", lat: 41.0145, lng: 29.1895, accessStopId: "stop_cekmekoy" },
      ],
    },
    {
      id: "sultanbeyli", name: "Sultanbeyli", lat: 40.9659, lng: 29.2725, accessStopId: "stop_sultanbeyli",
      neighborhoods: [
        { id: "sultanbeyli_merkez", name: "Sultanbeyli Merkez", lat: 40.9659, lng: 29.2725, accessStopId: "stop_sultanbeyli" },
      ],
    },
    {
      // Raylı ağdan çok uzak (~20km+) — en yakın GERÇEK İETT durağı kullanıldı,
      // ama gerçekte Şile'den şehir merkezine ulaşım büyük ölçüde özel/servis
      // araçlarına dayanır; bu tahmin oldukça kabadır.
      id: "sile", name: "Şile", lat: 41.1750, lng: 29.6130, accessStopId: "iett_284667",
      neighborhoods: [
        { id: "sile_merkez", name: "Şile Merkez", lat: 41.1750, lng: 29.6130, accessStopId: "iett_284667" },
      ],
    },
    {
      id: "tuzla", name: "Tuzla", lat: 40.8298, lng: 29.3227, accessStopId: "stop_tuzla",
      neighborhoods: [
        { id: "tuzla_merkez", name: "Tuzla Merkez", lat: 40.8298, lng: 29.3227, accessStopId: "stop_tuzla" },
      ],
    },
  ],

  // HAFTALIK ACİL PROJELER: Buraya id'sini eklediğin projeler, sonuç
  // kartlarında kırmızı "ACİL" rozetiyle öne çıkarılır. İK bu listeyi her
  // hafta günceller.
  urgentProjectIds: [],

  // İSKELET AŞAMASI (güncelleme: 2026-09-22): bu, ikmaps-istanbul (Avrupa
  // yakası) uygulamasının Anadolu yakası muadilidir — aynı motor/mantık,
  // AYRI proje portföyü. Gerçek Anadolu yakası proje verisi İK'dan
  // gelmedi henüz; projects[] bilinçli olarak BOŞ bırakıldı. Veri geldiğinde
  // ikmaps-istanbul'daki 2026-09-18 importuyla aynı pipeline izlenmeli (bkz.
  // o projenin import notları): Konum linklerini koordinata çöz, accessStopId
  // en yakın transitStops girdisiyle eşleştir, aynı alan şeması (id, name,
  // sector, position, address, lat, lng, accessStopId, shift, salary, meal,
  // transport, referral, gender).
  projects: [],

  // ---------------------------------------------------------------------
  // KAYNAK: OpenStreetMap / Overpass API (overpass-api.de), 2026-09-07
  // tarihinde çekilen GERÇEK İstanbul raylı sistem (metro, tramvay, Marmaray,
  // füniküler) rota verilerine dayanır.
  //
  // KAPSAM: M1A, M1B, M2, M3, M4, M5, M6, M7, M8, M9, M11 metro hatları;
  // T1-T5 tramvay hatları (T3 Kadıköy-Moda nostaljik tramvay dahil); F1-F4
  // füniküler hatları; Marmaray (Gebze-Halkalı). Bu dizideki hatlar ana rota
  // motoru (resolveTransfer/BFS) tarafından kullanılır. OTOBÜS/METROBÜS
  // hatları BURADA DEĞİL — onlar proje kökündeki transit_network.json'da
  // (İETT resmi GTFS verisi, 1486 hat/13.183 durak — bkz. o dosyanın/
  // yukarıdaki dosya başlığının notu) ve sadece adres aramasında "yakında
  // hangi otobüsler geçiyor" bilgisini besliyor (bkz. app.js
  // discoverNearbyTransitLocal), ana rota hesabına dahil değil.
  //
  // ATLANAN/HARİÇ TUTULAN VERİ (uydurmamak için):
  // - "Darıca Sahil–Gebze OSB" ve "(Gebze–Sabiha Gökçen Havalimanı) Hattı":
  //   İstanbul sınırları dışında/taslak relation, dahil edilmedi.
  // - "Üsküdar-Cevizli"/"Cevizli-Üsküdar" (ref'siz, "tram" etiketli ama M5 ile
  //   örtüşen 33 duraklı bir relation): kimliği doğrulanamadı, dahil edilmedi.
  // - Teleferik/aerialway hatları (ör. TF2 Eyüp-Pierre Loti) sorgulanmadı.
  // - M11 (Halkalı-Gayrettepe) 15 durakla geldi; hattın güncel açılış
  //   durumuna göre OSM'de eksik durak olabilir, teyit edilmeli.
  //
  // BİLİNEN SINIRLAMA: bazı gerçek aktarmalar iki AYRI isimli istasyon
  // arasında yürüyerek yapılır ve ortak bir stopId paylaşmaz (M2 "Şişli" ile
  // M7 "Mecidiyeköy", ~300m). Bunun için app.js'te WALK_TRANSFERS listesi var
  // — Ankara'daki HUB_BRIDGE'in muadili. Başka örnekler olabilir, tam tarama
  // yapılmadı.
  // ---------------------------------------------------------------------
  transitStops: [
    { id: "stop_kabatas", name: "Kabataş", mode: "hub", lat: 41.0344774, lng: 28.9926707 },
    { id: "stop_findikli_msu", name: "Fındıklı - MSÜ", mode: "tramvay", lat: 41.0315308, lng: 28.9894567 },
    { id: "stop_tophane", name: "Tophane", mode: "tramvay", lat: 41.0268005, lng: 28.9802781 },
    { id: "stop_karakoy", name: "Karaköy", mode: "hub", lat: 41.0222299, lng: 28.9747557 },
    { id: "stop_eminonu", name: "Eminönü", mode: "hub", lat: 41.0174499, lng: 28.9732148 },
    { id: "stop_sirkeci", name: "Sirkeci", mode: "hub", lat: 41.0151642, lng: 28.9758304 },
    { id: "stop_gulhane", name: "Gülhane", mode: "tramvay", lat: 41.0121632, lng: 28.9784087 },
    { id: "stop_sultanahmet", name: "Sultanahmet", mode: "tramvay", lat: 41.0081113, lng: 28.9755143 },
    { id: "stop_cemberlitas", name: "Çemberlitaş", mode: "tramvay", lat: 41.0084652, lng: 28.9711451 },
    { id: "stop_beyazit_kapali_carsi", name: "Beyazıt - Kapalı Çarşı", mode: "tramvay", lat: 41.0090852, lng: 28.9666458 },
    { id: "stop_aksaray", name: "Aksaray", mode: "hub", lat: 41.0096115, lng: 28.9538781 },
    { id: "stop_yusufpasa", name: "Yusufpaşa", mode: "tramvay", lat: 41.0100961, lng: 28.9466545 },
    { id: "stop_haseki", name: "Haseki", mode: "tramvay", lat: 41.0110406, lng: 28.9431092 },
    { id: "stop_findikzade", name: "Fındıkzade", mode: "tramvay", lat: 41.0118214, lng: 28.9404859 },
    { id: "stop_capa_sehremini", name: "Çapa-Şehremini", mode: "tramvay", lat: 41.015279, lng: 28.9333351 },
    { id: "stop_pazartekke", name: "Pazartekke", mode: "tramvay", lat: 41.0182396, lng: 28.9271904 },
    { id: "stop_topkapi", name: "Topkapı", mode: "hub", lat: 41.0192853, lng: 28.9194457 },
    { id: "stop_cevizlibag_a_o_y", name: "Cevizlibağ-A.Ö.Y.", mode: "tramvay", lat: 41.0160557, lng: 28.9115859 },
    { id: "stop_merkez_efendi", name: "Merkez Efendi", mode: "tramvay", lat: 41.0103501, lng: 28.9094588 },
    { id: "stop_seyitnizam_aksemsettin", name: "Seyitnizam-Akşemsettin", mode: "tramvay", lat: 41.0042355, lng: 28.9073596 },
    { id: "stop_mithatpasa", name: "Mithatpaşa", mode: "tramvay", lat: 41.003385, lng: 28.8998873 },
    { id: "stop_mehmet_akif", name: "Mehmet Akif", mode: "tramvay", lat: 41.0058363, lng: 28.8816928 },
    { id: "stop_merter_tekstil_merkezi", name: "Merter Tekstil Merkezi", mode: "tramvay", lat: 41.0115728, lng: 28.8807848 },
    { id: "stop_gungoren", name: "Güngören", mode: "tramvay", lat: 41.0152632, lng: 28.877486 },
    { id: "stop_akincilar", name: "Akıncılar", mode: "tramvay", lat: 41.0171401, lng: 28.8714699 },
    { id: "stop_soganli", name: "Soğanlı", mode: "tramvay", lat: 41.0205923, lng: 28.8676168 },
    { id: "stop_gunestepe", name: "Güneştepe", mode: "tramvay", lat: 41.028958, lng: 28.8610215 },
    { id: "stop_yavuz_selim", name: "Yavuz Selim", mode: "tramvay", lat: 41.0235482, lng: 28.8640724 },
    { id: "stop_zeytinburnu", name: "Zeytinburnu", mode: "hub", lat: 41.0015333, lng: 28.8901578 },
    { id: "stop_bagcilar", name: "Bağcılar", mode: "tramvay", lat: 41.0322093, lng: 28.8606194 },
    { id: "stop_taksim", name: "Taksim", mode: "hub", lat: 41.0367798, lng: 28.9866658 },
    { id: "stop_beyoglu", name: "Beyoğlu", mode: "funikuler", lat: 41.0283447, lng: 28.9739892 },
    { id: "stop_huseyin_aga_camii", name: "Hüseyin Ağa Camii", mode: "tramvay", lat: 41.0348722, lng: 28.9806501 },
    { id: "stop_galatasaray_lisesi", name: "Galatasaray Lisesi", mode: "tramvay", lat: 41.0336607, lng: 28.9775878 },
    { id: "stop_odakule", name: "Odakule", mode: "tramvay", lat: 41.0316434, lng: 28.9760385 },
    { id: "stop_tunel", name: "Tünel", mode: "tramvay", lat: 41.0288361, lng: 28.9747735 },
    { id: "stop_yenikapi", name: "Yenikapı", mode: "hub", lat: 41.005728, lng: 28.9505658 },
    { id: "stop_emniyet_fatih", name: "Emniyet - Fatih", mode: "hub", lat: 41.0174301, lng: 28.9396317 },
    { id: "stop_topkapi_ulubatli", name: "Topkapı Ulubatlı", mode: "hub", lat: 41.0238758, lng: 28.9306248 },
    { id: "stop_bayrampasa_maltepe", name: "Bayrampaşa-Maltepe", mode: "hub", lat: 41.0341161, lng: 28.9203244 },
    { id: "stop_sagmalcilar", name: "Sağmalcılar", mode: "hub", lat: 41.040912, lng: 28.9072258 },
    { id: "stop_kocatepe", name: "Kocatepe", mode: "hub", lat: 41.0485107, lng: 28.8954577 },
    { id: "stop_otogar", name: "Otogar", mode: "hub", lat: 41.0401083, lng: 28.8946163 },
    { id: "stop_terazidere", name: "Terazidere", mode: "metro", lat: 41.0303612, lng: 28.897936 },
    { id: "stop_davutpasa_ytu", name: "Davutpaşa - YTÜ", mode: "metro", lat: 41.0205272, lng: 28.900245 },
    { id: "stop_merter", name: "Merter", mode: "metro", lat: 41.0076182, lng: 28.8961612 },
    { id: "stop_bakirkoy_incirli", name: "Bakırköy-İncirli", mode: "metro", lat: 40.9966391, lng: 28.8753909 },
    { id: "stop_bahcelievler", name: "Bahçelievler", mode: "metro", lat: 40.9955091, lng: 28.8632993 },
    { id: "stop_atakoy_sirinevler", name: "Ataköy-Şirinevler", mode: "metro", lat: 40.9913766, lng: 28.8460141 },
    { id: "stop_yenibosna", name: "Yenibosna", mode: "hub", lat: 40.9894444, lng: 28.8367394 },
    { id: "stop_dtm_istanbul_fuar_merkezi", name: "DTM-İstanbul Fuar Merkezi", mode: "metro", lat: 40.9866459, lng: 28.8284451 },
    { id: "stop_ataturk_havalimani", name: "Atatürk Havalimanı", mode: "metro", lat: 40.9797389, lng: 28.8210402 },
    { id: "stop_kadikoy", name: "Kadıköy", mode: "metro", lat: 40.9904895, lng: 29.0222177 },
    { id: "stop_ayrilik_cesmesi", name: "Ayrılık Çeşmesi", mode: "hub", lat: 41.0001803, lng: 29.0305822 },
    { id: "stop_acibadem", name: "Acıbadem", mode: "metro", lat: 41.0021833, lng: 29.0443227 },
    { id: "stop_unalan", name: "Ünalan", mode: "metro", lat: 40.9979489, lng: 29.0599485 },
    { id: "stop_goztepe", name: "Göztepe", mode: "hub", lat: 40.9939726, lng: 29.0705409 },
    { id: "stop_yenisahra", name: "Yenisahra", mode: "metro", lat: 40.9844847, lng: 29.09026 },
    { id: "stop_kozyatagi", name: "Kozyatağı", mode: "hub", lat: 40.9752948, lng: 29.099433 },
    { id: "stop_bostanci", name: "Bostancı", mode: "hub", lat: 40.964554, lng: 29.1050971 },
    { id: "stop_kucukyali", name: "Küçükyalı", mode: "hub", lat: 40.9488718, lng: 29.1218816 },
    { id: "stop_maltepe", name: "Maltepe", mode: "hub", lat: 40.9357512, lng: 29.139347 },
    { id: "stop_huzurevi", name: "Huzurevi", mode: "metro", lat: 40.9298874, lng: 29.1466228 },
    { id: "stop_gulsuyu", name: "Gülsuyu", mode: "metro", lat: 40.9237153, lng: 29.1546158 },
    { id: "stop_esenkent", name: "Esenkent", mode: "metro", lat: 40.920721, lng: 29.1663075 },
    { id: "stop_hastane_adliye", name: "Hastane Adliye", mode: "metro", lat: 40.9162552, lng: 29.1781645 },
    { id: "stop_soganlik", name: "Soğanlık", mode: "metro", lat: 40.9131034, lng: 29.1923629 },
    { id: "stop_kartal", name: "Kartal", mode: "hub", lat: 40.9064711, lng: 29.211193 },
    { id: "stop_yakacik_adnan_kahveci", name: "Yakacık—Adnan Kahveci", mode: "metro", lat: 40.8965079, lng: 29.2269937 },
    { id: "stop_pendik", name: "Pendik", mode: "hub", lat: 40.8885542, lng: 29.2384563 },
    { id: "stop_tavsantepe", name: "Tavşantepe", mode: "metro", lat: 40.8820354, lng: 29.2487168 },
    { id: "stop_fevzi_cakmak_hastane", name: "Fevzi Çakmak - Hastane", mode: "metro", lat: 40.888829, lng: 29.2626488 },
    { id: "stop_yayalar_seyhli", name: "Yayalar-Şeyhli", mode: "metro", lat: 40.9036264, lng: 29.2751183 },
    { id: "stop_kurtkoy", name: "Kurtköy", mode: "metro", lat: 40.9098537, lng: 29.2961025 },
    { id: "stop_sabiha_gokcen_havalimani", name: "Sabiha Gökçen Havalimanı", mode: "metro", lat: 40.9064421, lng: 29.3114781 },
    { id: "stop_kadikoy_ido_metro", name: "Kadıköy - İDO- Metro", mode: "tramvay", lat: 40.989981, lng: 29.0221226 },
    { id: "stop_iskele_cami", name: "İskele Cami", mode: "tramvay", lat: 40.9906526, lng: 29.0231785 },
    { id: "stop_carsi", name: "Çarşı", mode: "tramvay", lat: 40.9911511, lng: 29.025524 },
    { id: "stop_altiyol", name: "Altıyol", mode: "tramvay", lat: 40.9893839, lng: 29.0288441 },
    { id: "stop_bahariye", name: "Bahariye", mode: "tramvay", lat: 40.987668, lng: 29.0285525 },
    { id: "stop_kilise", name: "Kilise", mode: "tramvay", lat: 40.9859846, lng: 29.0279178 },
    { id: "stop_moda_ilkokulu", name: "Moda İlkokulu", mode: "tramvay", lat: 40.9840944, lng: 29.0266951 },
    { id: "stop_moda_caddesi", name: "Moda Caddesi", mode: "tramvay", lat: 40.9840631, lng: 29.0243788 },
    { id: "stop_riza_pasa", name: "Rıza Paşa", mode: "tramvay", lat: 40.9846726, lng: 29.0227213 },
    { id: "stop_muhurdar", name: "Mühürdar", mode: "tramvay", lat: 40.9854891, lng: 29.0211099 },
    { id: "stop_damga_sokak", name: "Damga Sokak", mode: "tramvay", lat: 40.9888514, lng: 29.0205606 },
    { id: "stop_esenler", name: "Esenler", mode: "metro", lat: 41.0375458, lng: 28.8885667 },
    { id: "stop_menderes", name: "Menderes", mode: "metro", lat: 41.0428043, lng: 28.8784472 },
    { id: "stop_ucyuzlu", name: "Üçyüzlü", mode: "metro", lat: 41.036756, lng: 28.8706206 },
    { id: "stop_bagcilar_meydan", name: "Bağcılar Meydan", mode: "metro", lat: 41.034741, lng: 28.8566453 },
    { id: "stop_kirazli", name: "Kirazlı", mode: "hub", lat: 41.0318577, lng: 28.8421605 },
    { id: "stop_gebze", name: "Gebze", mode: "marmaray", lat: 40.7839925, lng: 29.4107891 },
    { id: "stop_darica", name: "Darıca", mode: "marmaray", lat: 40.7914702, lng: 29.3919766 },
    { id: "stop_osmangazi", name: "Osmangazi", mode: "marmaray", lat: 40.7992974, lng: 29.3801707 },
    { id: "stop_gtu_fatih", name: "GTÜ-Fatih", mode: "marmaray", lat: 40.8077161, lng: 29.3637973 },
    { id: "stop_cayirova", name: "Çayırova", mode: "marmaray", lat: 40.8105826, lng: 29.3473857 },
    { id: "stop_tuzla", name: "Tuzla", mode: "marmaray", lat: 40.8298362, lng: 29.3226734 },
    { id: "stop_icmeler", name: "İçmeler", mode: "marmaray", lat: 40.8457446, lng: 29.3001066 },
    { id: "stop_aydintepe", name: "Aydıntepe", mode: "marmaray", lat: 40.8523581, lng: 29.2932504 },
    { id: "stop_guzelyali", name: "Güzelyalı", mode: "marmaray", lat: 40.8569574, lng: 29.2835991 },
    { id: "stop_tersane", name: "Tersane", mode: "marmaray", lat: 40.8611722, lng: 29.2733746 },
    { id: "stop_kaynarca", name: "Kaynarca", mode: "marmaray", lat: 40.8714179, lng: 29.2560275 },
    { id: "stop_yunus", name: "Yunus", mode: "marmaray", lat: 40.8846053, lng: 29.210478 },
    { id: "stop_basak", name: "Başak", mode: "marmaray", lat: 40.8903677, lng: 29.1775879 },
    { id: "stop_atalar", name: "Atalar", mode: "marmaray", lat: 40.8988409, lng: 29.1692744 },
    { id: "stop_cevizli", name: "Cevizli", mode: "marmaray", lat: 40.910029, lng: 29.1561754 },
    { id: "stop_sureyya_plaji", name: "Süreyya Plajı", mode: "marmaray", lat: 40.9268311, lng: 29.1243411 },
    { id: "stop_idealtepe", name: "İdealtepe", mode: "marmaray", lat: 40.937876, lng: 29.1143192 },
    { id: "stop_suadiye", name: "Suadiye", mode: "marmaray", lat: 40.9605413, lng: 29.0844454 },
    { id: "stop_erenkoy", name: "Erenköy", mode: "marmaray", lat: 40.9716866, lng: 29.0764605 },
    { id: "stop_feneryolu", name: "Feneryolu", mode: "marmaray", lat: 40.978848, lng: 29.0488908 },
    { id: "stop_sogutlucesme", name: "Söğütlüçeşme", mode: "marmaray", lat: 40.9907493, lng: 29.0380826 },
    { id: "stop_uskudar", name: "Üsküdar", mode: "hub", lat: 41.0258396, lng: 29.0132642 },
    { id: "stop_kazlicesme", name: "Kazlıçeşme", mode: "marmaray", lat: 40.9927446, lng: 28.9169682 },
    { id: "stop_zeytinburnu_fisekhane", name: "Zeytinburnu-Fişekhane", mode: "marmaray", lat: 40.9859358, lng: 28.9053777 },
    { id: "stop_yeni_mahalle", name: "Yeni Mahalle", mode: "marmaray", lat: 40.9818034, lng: 28.8810217 },
    { id: "stop_bakirkoy", name: "Bakırköy", mode: "marmaray", lat: 40.9804407, lng: 28.8724034 },
    { id: "stop_atakoy", name: "Ataköy", mode: "hub", lat: 40.9802954, lng: 28.8562255 },
    { id: "stop_yesilyurt", name: "Yeşilyurt", mode: "marmaray", lat: 40.9655489, lng: 28.8372396 },
    { id: "stop_yesilkoy", name: "Yeşilköy", mode: "marmaray", lat: 40.9627331, lng: 28.8248804 },
    { id: "stop_florya_akvaryum", name: "Florya Akvaryum", mode: "marmaray", lat: 40.9678693, lng: 28.7970755 },
    { id: "stop_florya", name: "Florya", mode: "marmaray", lat: 40.9729697, lng: 28.7876456 },
    { id: "stop_kucukcekmece", name: "Küçükçekmece", mode: "marmaray", lat: 40.9885491, lng: 28.773056 },
    { id: "stop_mustafa_kemal", name: "Mustafa Kemal", mode: "marmaray", lat: 41.0061388, lng: 28.7739784 },
    { id: "stop_halkali", name: "Halkalı", mode: "hub", lat: 41.0184381, lng: 28.7668524 },
    { id: "stop_bakirkoy_sahil", name: "Bakırköy Sahil", mode: "metro", lat: 40.9735585, lng: 28.8679821 },
    { id: "stop_ozgurluk_meydani", name: "Özgürlük Meydanı", mode: "metro", lat: 40.9817899, lng: 28.8743051 },
    { id: "stop_incirli", name: "İncirli", mode: "metro", lat: 40.9976509, lng: 28.8753178 },
    { id: "stop_haznedar", name: "Haznedar", mode: "metro", lat: 41.0047045, lng: 28.8718966 },
    { id: "stop_ilkyuva", name: "İlkyuva", mode: "metro", lat: 41.0117328, lng: 28.8657307 },
    { id: "stop_yildiztepe", name: "Yıldıztepe", mode: "metro", lat: 41.019572, lng: 28.8578319 },
    { id: "stop_molla_gurani", name: "Molla Gürani", mode: "metro", lat: 41.0259558, lng: 28.8480788 },
    { id: "stop_yeni_mahalle_2", name: "Yeni Mahalle", mode: "metro", lat: 41.0404308, lng: 28.8361223 },
    { id: "stop_mahmutbey", name: "Mahmutbey", mode: "hub", lat: 41.0548896, lng: 28.8306126 },
    { id: "stop_istoc", name: "İSTOÇ", mode: "metro", lat: 41.065077, lng: 28.8260847 },
    { id: "stop_ikitelli_sanayi", name: "İkitelli Sanayi", mode: "hub", lat: 41.0713956, lng: 28.8038216 },
    { id: "stop_turgut_ozal", name: "Turgut Özal", mode: "metro", lat: 41.0811589, lng: 28.7976309 },
    { id: "stop_siteler", name: "Siteler", mode: "metro", lat: 41.0882794, lng: 28.7966542 },
    { id: "stop_basak_konutlari", name: "Başak Konutları", mode: "metro", lat: 41.0977803, lng: 28.7914561 },
    { id: "stop_metrokent", name: "Metrokent", mode: "metro", lat: 41.1082043, lng: 28.8016211 },
    { id: "stop_onurkent", name: "Onurkent", mode: "metro", lat: 41.1135424, lng: 28.7904668 },
    { id: "stop_sehir_hastanesi", name: "Şehir Hastanesi", mode: "metro", lat: 41.1032857, lng: 28.7775639 },
    { id: "stop_toplu_konutlar", name: "Toplu Konutlar", mode: "metro", lat: 41.1077392, lng: 28.768059 },
    { id: "stop_kayasehir_merkez", name: "Kayaşehir Merkez", mode: "metro", lat: 41.1190274, lng: 28.7663849 },
    { id: "stop_cobancesme", name: "Çobançeşme", mode: "metro", lat: 40.9997593, lng: 28.822727 },
    { id: "stop_29_ekim_cumhuriyet", name: "29 Ekim Cumhuriyet", mode: "metro", lat: 41.006234, lng: 28.8188131 },
    { id: "stop_dogu_sanayi", name: "Doğu Sanayi", mode: "metro", lat: 41.0149429, lng: 28.8181549 },
    { id: "stop_mimar_sinan", name: "Mimar Sinan", mode: "metro", lat: 41.0250791, lng: 28.8167821 },
    { id: "stop_15_temmuz", name: "15 Temmuz", mode: "metro", lat: 41.0369237, lng: 28.8142134 },
    { id: "stop_halkali_caddesi", name: "Halkalı Caddesi", mode: "metro", lat: 41.0451704, lng: 28.8066077 },
    { id: "stop_ataturk_mahallesi", name: "Atatürk Mahallesi", mode: "metro", lat: 41.0521866, lng: 28.7989581 },
    { id: "stop_bahariye_2", name: "Bahariye", mode: "metro", lat: 41.0585053, lng: 28.7994906 },
    { id: "stop_masko", name: "MASKO", mode: "metro", lat: 41.0639891, lng: 28.8042749 },
    { id: "stop_ziya_gokalp", name: "Ziya Gökalp", mode: "metro", lat: 41.0746891, lng: 28.786412 },
    { id: "stop_olimpiyat", name: "Olimpiyat", mode: "metro", lat: 41.0796429, lng: 28.7670768 },
    { id: "stop_mescid_i_selam", name: "Mescid-i Selam", mode: "tramvay", lat: 41.1162428, lng: 28.8511412 },
    { id: "stop_cebeci", name: "Cebeci", mode: "tramvay", lat: 41.1124107, lng: 28.8575196 },
    { id: "stop_yeni_mahalle_3", name: "Yeni Mahalle", mode: "tramvay", lat: 41.1002839, lng: 28.8628946 },
    { id: "stop_haci_sukru", name: "Hacı Şükrü", mode: "tramvay", lat: 41.0933385, lng: 28.8638623 },
    { id: "stop_50_yil_bastabya", name: "50. Yıl-Baştabya", mode: "tramvay", lat: 41.087787, lng: 28.8669014 },
    { id: "stop_cumhuriyet_mahallesi", name: "Cumhuriyet Mahallesi", mode: "tramvay", lat: 41.0845661, lng: 28.8715664 },
    { id: "stop_kiptas_venezia", name: "KİPTAŞ Venezia", mode: "tramvay", lat: 41.0812918, lng: 28.8745733 },
    { id: "stop_karadeniz", name: "Karadeniz", mode: "tramvay", lat: 41.0751817, lng: 28.8824304 },
    { id: "stop_taskopru", name: "Taşköprü", mode: "tramvay", lat: 41.0725735, lng: 28.8877129 },
    { id: "stop_ali_fuat_basgil", name: "Ali Fuat Başgil", mode: "tramvay", lat: 41.0684467, lng: 28.8956044 },
    { id: "stop_bosna_cukurcesme", name: "Bosna-Çukurçeşme", mode: "tramvay", lat: 41.0618015, lng: 28.9020548 },
    { id: "stop_uluyol_berec", name: "Uluyol-Bereç", mode: "tramvay", lat: 41.0541152, lng: 28.9102178 },
    { id: "stop_rami", name: "Rami", mode: "tramvay", lat: 41.0465704, lng: 28.9155264 },
    { id: "stop_topcular", name: "Topçular", mode: "tramvay", lat: 41.0416106, lng: 28.9195261 },
    { id: "stop_demirkapi", name: "Demirkapı", mode: "tramvay", lat: 41.0369846, lng: 28.9233484 },
    { id: "stop_sehitlik", name: "Şehitlik", mode: "tramvay", lat: 41.0341412, lng: 28.9282944 },
    { id: "stop_edirnekapi", name: "Edirnekapı", mode: "tramvay", lat: 41.0313088, lng: 28.9340531 },
    { id: "stop_vatan", name: "Vatan", mode: "tramvay", lat: 41.0255685, lng: 28.9292392 },
    { id: "stop_fetihkapi", name: "Fetihkapı", mode: "tramvay", lat: 41.0215177, lng: 28.9249855 },
    { id: "stop_haciosman", name: "Hacıosman", mode: "metro", lat: 41.1398775, lng: 29.0303462 },
    { id: "stop_darussafaka", name: "Darüşşafaka", mode: "metro", lat: 41.1292867, lng: 29.0248677 },
    { id: "stop_ataturk_oto_sanayi", name: "Atatürk Oto Sanayi", mode: "metro", lat: 41.1181945, lng: 29.0239613 },
    { id: "stop_itu_ayazaga", name: "İTÜ-Ayazağa", mode: "metro", lat: 41.1082049, lng: 29.0209202 },
    { id: "stop_sanayi", name: "Sanayi", mode: "metro", lat: 41.0942446, lng: 29.0049849 },
    { id: "stop_4_levent", name: "4. Levent", mode: "metro", lat: 41.086047, lng: 29.0069725 },
    { id: "stop_levent", name: "Levent", mode: "hub", lat: 41.0769862, lng: 29.0135732 },
    { id: "stop_gayrettepe", name: "Gayrettepe", mode: "hub", lat: 41.0691324, lng: 29.0110477 },
    { id: "stop_sisli", name: "Şişli", mode: "metro", lat: 41.0646058, lng: 28.9926418 },
    { id: "stop_osmanbey", name: "Osmanbey", mode: "metro", lat: 41.0527563, lng: 28.9872434 },
    { id: "stop_sishane", name: "Şişhane", mode: "metro", lat: 41.0284104, lng: 28.9725882 },
    { id: "stop_halic", name: "Haliç", mode: "metro", lat: 41.0226507, lng: 28.9665946 },
    { id: "stop_vezneciler", name: "Vezneciler", mode: "metro", lat: 41.0122579, lng: 28.9595144 },
    { id: "stop_seyrantepe", name: "Seyrantepe", mode: "hub", lat: 41.1012886, lng: 28.9957442 },
    { id: "stop_bogazici_universitesi_hisarustu", name: "Boğaziçi Üniversitesi/Hisarüstü", mode: "metro", lat: 41.0853915, lng: 29.0456269 },
    { id: "stop_etiler", name: "Etiler", mode: "metro", lat: 41.0824907, lng: 29.037567 },
    { id: "stop_nispetiye", name: "Nispetiye", mode: "metro", lat: 41.077422, lng: 29.0239918 },
    { id: "stop_vadi_istanbul", name: "Vadi İstanbul", mode: "funikuler", lat: 41.107559, lng: 28.9882407 },
    { id: "stop_fistikagaci", name: "Fıstıkağacı", mode: "metro", lat: 41.0280497, lng: 29.0285937 },
    { id: "stop_baglarbasi", name: "Bağlarbaşı", mode: "metro", lat: 41.0217617, lng: 29.0363203 },
    { id: "stop_altunizade", name: "Altunizade", mode: "metro", lat: 41.0217742, lng: 29.048436 },
    { id: "stop_kisikli", name: "Kısıklı", mode: "metro", lat: 41.0220866, lng: 29.0619282 },
    { id: "stop_bulgurlu", name: "Bulgurlu", mode: "metro", lat: 41.0161665, lng: 29.0764166 },
    { id: "stop_umraniye", name: "Ümraniye", mode: "metro", lat: 41.0244489, lng: 29.0847203 },
    { id: "stop_carsi_2", name: "Çarşı", mode: "metro", lat: 41.0257977, lng: 29.0973586 },
    { id: "stop_yamanevler", name: "Yamanevler", mode: "metro", lat: 41.0240795, lng: 29.1086815 },
    { id: "stop_cakmak", name: "Çakmak", mode: "metro", lat: 41.0214949, lng: 29.1182375 },
    { id: "stop_ihlamurkuyu", name: "Ihlamurkuyu", mode: "metro", lat: 41.0196907, lng: 29.1304822 },
    { id: "stop_altinsehir", name: "Altınşehir", mode: "metro", lat: 41.0164848, lng: 29.1405992 },
    { id: "stop_imam_hatip_lisesi", name: "İmam Hatip Lisesi", mode: "metro", lat: 41.0158999, lng: 29.1518013 },
    { id: "stop_dudullu", name: "Dudullu", mode: "hub", lat: 41.0152062, lng: 29.1628733 },
    { id: "stop_necip_fazil", name: "Necip Fazıl", mode: "metro", lat: 41.0159831, lng: 29.1793459 },
    { id: "stop_cekmekoy", name: "Çekmeköy", mode: "metro", lat: 41.014462, lng: 29.1894989 },
    { id: "stop_meclis", name: "Meclis", mode: "metro", lat: 41.0095407, lng: 29.1987716 },
    { id: "stop_sarigazi", name: "Sarıgazi", mode: "metro", lat: 41.0099171, lng: 29.2125636 },
    { id: "stop_sancaktepe_sehir_hastanesi", name: "Sancaktepe Şehir Hastanesi", mode: "metro", lat: 41.0009411, lng: 29.2174459 },
    { id: "stop_sancaktepe", name: "Sancaktepe", mode: "metro", lat: 40.9920477, lng: 29.2288887 },
    { id: "stop_samandira_merkez", name: "Samandıra Merkez", mode: "metro", lat: 40.9838069, lng: 29.2312944 },
    { id: "stop_veysel_karani", name: "Veysel Karani", mode: "metro", lat: 40.9688309, lng: 29.239932 },
    { id: "stop_hasanpasa", name: "Hasanpaşa", mode: "metro", lat: 40.9685726, lng: 29.2550552 },
    { id: "stop_sultanbeyli", name: "Sultanbeyli", mode: "metro", lat: 40.9658951, lng: 29.2724753 },
    { id: "stop_mecidiyekoy", name: "Mecidiyeköy", mode: "metro", lat: 41.0653135, lng: 28.9955607 },
    { id: "stop_caglayan", name: "Çağlayan", mode: "metro", lat: 41.0707989, lng: 28.9806277 },
    { id: "stop_kagithane", name: "Kağıthane", mode: "hub", lat: 41.079665, lng: 28.9731572 },
    { id: "stop_nurtepe", name: "Nurtepe", mode: "metro", lat: 41.0799595, lng: 28.9632821 },
    { id: "stop_alibeykoy", name: "Alibeyköy", mode: "metro", lat: 41.0791653, lng: 28.9495879 },
    { id: "stop_circir_mahallesi", name: "Çırçır Mahallesi", mode: "metro", lat: 41.0802839, lng: 28.9361933 },
    { id: "stop_veysel_karani_aksemsettin", name: "Veysel Karani-Akşemsettin", mode: "metro", lat: 41.0797574, lng: 28.9281764 },
    { id: "stop_yesilpinar", name: "Yeşilpınar", mode: "metro", lat: 41.0824149, lng: 28.9183405 },
    { id: "stop_k_zim_karabekir", name: "Kâzım Karabekir", mode: "metro", lat: 41.0854613, lng: 28.9085465 },
    { id: "stop_yenimahalle", name: "Yenimahalle", mode: "metro", lat: 41.0839716, lng: 28.8928118 },
    { id: "stop_karadeniz_mahallesi", name: "Karadeniz Mahallesi", mode: "metro", lat: 41.0813391, lng: 28.8749302 },
    { id: "stop_giyimkent_tekstilkent", name: "Giyimkent-Tekstilkent", mode: "metro", lat: 41.0713794, lng: 28.8667234 },
    { id: "stop_oruc_reis_yuzyil", name: "Oruç Reis - Yüzyıl", mode: "metro", lat: 41.0628956, lng: 28.8552786 },
    { id: "stop_goztepe_2", name: "Göztepe", mode: "metro", lat: 41.0570155, lng: 28.8479518 },
    { id: "stop_yildiz", name: "Yıldız", mode: "metro", lat: 41.0540063, lng: 29.0098445 },
    { id: "stop_fulya", name: "Fulya", mode: "metro", lat: 41.0620788, lng: 29.007826 },
    { id: "stop_alibeykoy_cep_otogari", name: "Alibeyköy Cep Otogarı", mode: "tramvay", lat: 41.0868716, lng: 28.9439324 },
    { id: "stop_alibeykoy_metro", name: "Alibeyköy Metro", mode: "tramvay", lat: 41.0784279, lng: 28.9494362 },
    { id: "stop_alibeykoy_merkez", name: "Alibeyköy Merkez", mode: "tramvay", lat: 41.0737108, lng: 28.945958 },
    { id: "stop_universite", name: "Üniversite", mode: "tramvay", lat: 41.0699016, lng: 28.9428216 },
    { id: "stop_silahtaraga_mahallesi", name: "Silahtarağa Mahallesi", mode: "tramvay", lat: 41.0648566, lng: 28.9429308 },
    { id: "stop_eyupsultan_devlet_hastanesi", name: "Eyüpsultan Devlet Hastanesi", mode: "tramvay", lat: 41.056762, lng: 28.9411459 },
    { id: "stop_eyupsultan_teleferik", name: "Eyüpsultan Teleferik", mode: "tramvay", lat: 41.0505614, lng: 28.9351644 },
    { id: "stop_feshane", name: "Feshane", mode: "tramvay", lat: 41.0455401, lng: 28.9378997 },
    { id: "stop_ayvansaray", name: "Ayvansaray", mode: "tramvay", lat: 41.0395444, lng: 28.9439399 },
    { id: "stop_balat", name: "Balat", mode: "tramvay", lat: 41.0340207, lng: 28.9480391 },
    { id: "stop_fener", name: "Fener", mode: "tramvay", lat: 41.0286148, lng: 28.9544538 },
    { id: "stop_cibali", name: "Cibali", mode: "tramvay", lat: 41.0242282, lng: 28.9602875 },
    { id: "stop_kucukpazar", name: "Küçükpazar", mode: "tramvay", lat: 41.0209233, lng: 28.9632559 },
    { id: "stop_rumeli_hisarustu", name: "Rumeli Hisarüstü", mode: "funikuler", lat: 41.0850008, lng: 29.0460846 },
    { id: "stop_asiyan", name: "Aşiyan", mode: "funikuler", lat: 41.0815409, lng: 29.0539745 },
    { id: "stop_emin_ali_pasa", name: "Emin Ali Paşa", mode: "metro", lat: 40.9608531, lng: 29.0937566 },
    { id: "stop_aysekadin", name: "Ayşekadın", mode: "metro", lat: 40.9668223, lng: 29.0870683 },
    { id: "stop_kucukbakkalkoy", name: "Küçükbakkalköy", mode: "metro", lat: 40.9787235, lng: 29.1117422 },
    { id: "stop_icerenkoy", name: "İçerenköy", mode: "metro", lat: 40.9787331, lng: 29.1262993 },
    { id: "stop_kayisdagi", name: "Kayışdağı", mode: "metro", lat: 40.9846547, lng: 29.1378132 },
    { id: "stop_mevlana", name: "Mevlana", mode: "metro", lat: 40.9920439, lng: 29.1534783 },
    { id: "stop_imes", name: "İMES", mode: "metro", lat: 41.0000815, lng: 29.156482 },
    { id: "stop_modoko", name: "MODOKO", mode: "metro", lat: 41.0072044, lng: 29.1621987 },
    { id: "stop_huzur", name: "Huzur", mode: "metro", lat: 41.022634, lng: 29.1596341 },
    { id: "stop_parseller", name: "Parseller", mode: "metro", lat: 41.0312515, lng: 29.152679 },
    { id: "stop_halkali_stadi", name: "Halkalı Stadı", mode: "metro", lat: 41.056569, lng: 28.7748859 },
    { id: "stop_olimpiyatkoy", name: "Olimpiyatköy", mode: "metro", lat: 41.0780764, lng: 28.7699116 },
    { id: "stop_kayasehir", name: "Kayaşehir", mode: "metro", lat: 41.1173262, lng: 28.7658803 },
    { id: "stop_ibn_haldun_universitesi", name: "İbn Haldun Üniversitesi", mode: "metro", lat: 41.1394663, lng: 28.793969 },
    { id: "stop_arnavutkoy_hastane", name: "Arnavutköy Hastane", mode: "metro", lat: 41.1791198, lng: 28.74788 },
    { id: "stop_tasoluk", name: "Taşoluk", mode: "metro", lat: 41.2070981, lng: 28.7160865 },
    { id: "stop_kargo_terminali", name: "Kargo Terminali", mode: "metro", lat: 41.2553423, lng: 28.712731 },
    { id: "stop_istanbul_havalimani", name: "İstanbul Havalimanı", mode: "metro", lat: 41.2558497, lng: 28.7426107 },
    { id: "stop_ihsaniye", name: "İhsaniye", mode: "metro", lat: 41.2428514, lng: 28.8088272 },
    { id: "stop_gokturk", name: "Göktürk", mode: "metro", lat: 41.1768557, lng: 28.8836397 },
    { id: "stop_kemerburgaz", name: "Kemerburgaz", mode: "metro", lat: 41.1590973, lng: 28.9101084 },
    { id: "stop_hasdal", name: "Hasdal", mode: "metro", lat: 41.1212278, lng: 28.9467385 },

    // VAPUR İSKELELERİ — OpenStreetMap/Overpass (route=ferry), 2026-09-07.
    // Not: İstanbul'un vapur hatları OSM'de metro kadar iyi haritalanmamış —
    // 21 route=ferry relation'ından sadece birkaçında gerçek, isimli, koordinatlı
    // durak (stop_position/ferry_terminal node'u) vardı; "Kabataş-Üsküdar",
    // "Eminönü-Üsküdar" gibi bazı GERÇEK (relation adıyla doğrulanan) hatların
    // OSM'de hiç durak noktası yoktu, o hatlarda mevcut raylı sistem hub'ı
    // (stop_kabatas/stop_uskudar) yaklaşık iskele konumu olarak kullanıldı —
    // aşağıdaki transitLines bloğunda ayrıca not düşüldü. stop_kadikoy_iskele
    // ve stop_eminonu_iskele, aynı isimli mevcut metro/tramvay duraklarına
    // (stop_kadikoy ~150m, stop_eminonu ~100m) app.js'teki WALK_TRANSFERS ile
    // bağlanır (Şişli/Mecidiyeköy ile aynı yöntem).
    { id: "stop_kadikoy_iskele", name: "Kadıköy İskelesi", mode: "vapur", lat: 40.9918235, lng: 29.0215476 },
    { id: "stop_besiktas_iskele", name: "Beşiktaş İskelesi", mode: "vapur", lat: 41.0399916, lng: 29.0057053 },
    { id: "stop_eminonu_iskele", name: "Eminönü İskelesi", mode: "vapur", lat: 41.0183472, lng: 28.973161 },
    { id: "stop_kinaliada", name: "Kınalıada İskelesi", mode: "vapur", lat: 40.9102213, lng: 29.0558369 },
    { id: "stop_burgazada", name: "Burgazada İskelesi", mode: "vapur", lat: 40.8810827, lng: 29.0707969 },
    { id: "stop_heybeliada", name: "Heybeliada İskelesi", mode: "vapur", lat: 40.8780078, lng: 29.1014071 },
    { id: "stop_buyukada", name: "Büyükada İskelesi", mode: "vapur", lat: 40.8747256, lng: 29.1255631 },
  ],
  transitLines: [
    {
      id: "T1", name: "T1: Kabataş → Bağcılar", mode: "tramvay", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_kabatas", "stop_findikli_msu", "stop_tophane", "stop_karakoy", "stop_eminonu", "stop_sirkeci", "stop_gulhane", "stop_sultanahmet", "stop_cemberlitas", "stop_beyazit_kapali_carsi", "stop_aksaray", "stop_yusufpasa", "stop_haseki", "stop_findikzade", "stop_capa_sehremini", "stop_pazartekke", "stop_topkapi", "stop_cevizlibag_a_o_y", "stop_merkez_efendi", "stop_seyitnizam_aksemsettin", "stop_mithatpasa", "stop_mehmet_akif", "stop_merter_tekstil_merkezi", "stop_gungoren", "stop_akincilar", "stop_soganli", "stop_gunestepe", "stop_yavuz_selim", "stop_zeytinburnu", "stop_bagcilar"],
    },
    {
      id: "F1", name: "F1: Taksim → Kabataş", mode: "funikuler", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_taksim", "stop_kabatas"],
    },
    {
      id: "F2", name: "Tünel (F2): Karaköy → Beyoğlu", mode: "funikuler", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_karakoy", "stop_beyoglu"],
    },
    {
      id: "T2", name: "T2: Taksim → Tünel", mode: "tramvay", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_taksim", "stop_huseyin_aga_camii", "stop_galatasaray_lisesi", "stop_odakule", "stop_tunel"],
    },
    {
      id: "M1A", name: "M1A: Yenikapı → Atatürk Havalimanı", mode: "metro", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_yenikapi", "stop_aksaray", "stop_emniyet_fatih", "stop_topkapi_ulubatli", "stop_bayrampasa_maltepe", "stop_sagmalcilar", "stop_kocatepe", "stop_otogar", "stop_terazidere", "stop_davutpasa_ytu", "stop_merter", "stop_zeytinburnu", "stop_bakirkoy_incirli", "stop_bahcelievler", "stop_atakoy_sirinevler", "stop_yenibosna", "stop_dtm_istanbul_fuar_merkezi", "stop_ataturk_havalimani"],
    },
    {
      id: "M4", name: "M4: Kadıköy → Sabiha Gökçen Havalimanı", mode: "metro", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_kadikoy", "stop_ayrilik_cesmesi", "stop_acibadem", "stop_unalan", "stop_goztepe", "stop_yenisahra", "stop_kozyatagi", "stop_bostanci", "stop_kucukyali", "stop_maltepe", "stop_huzurevi", "stop_gulsuyu", "stop_esenkent", "stop_hastane_adliye", "stop_soganlik", "stop_kartal", "stop_yakacik_adnan_kahveci", "stop_pendik", "stop_tavsantepe", "stop_fevzi_cakmak_hastane", "stop_yayalar_seyhli", "stop_kurtkoy", "stop_sabiha_gokcen_havalimani"],
    },
    {
      id: "T3", name: "T3: Kadıköy ↔ Moda Nostaljik Tramvay Hattı", mode: "tramvay", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_kadikoy_ido_metro", "stop_iskele_cami", "stop_carsi", "stop_altiyol", "stop_bahariye", "stop_kilise", "stop_moda_ilkokulu", "stop_moda_caddesi", "stop_riza_pasa", "stop_muhurdar", "stop_damga_sokak"],
    },
    {
      id: "M1B", name: "M1B: Yenikapı → Kirazlı", mode: "metro", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_yenikapi", "stop_aksaray", "stop_emniyet_fatih", "stop_topkapi_ulubatli", "stop_bayrampasa_maltepe", "stop_sagmalcilar", "stop_kocatepe", "stop_otogar", "stop_esenler", "stop_menderes", "stop_ucyuzlu", "stop_bagcilar_meydan", "stop_kirazli"],
    },
    {
      id: "B1", name: "Marmaray: Gebze - Halkalı", mode: "marmaray", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_gebze", "stop_darica", "stop_osmangazi", "stop_gtu_fatih", "stop_cayirova", "stop_tuzla", "stop_icmeler", "stop_aydintepe", "stop_guzelyali", "stop_tersane", "stop_kaynarca", "stop_pendik", "stop_yunus", "stop_kartal", "stop_basak", "stop_atalar", "stop_cevizli", "stop_maltepe", "stop_sureyya_plaji", "stop_idealtepe", "stop_kucukyali", "stop_bostanci", "stop_suadiye", "stop_erenkoy", "stop_goztepe", "stop_feneryolu", "stop_sogutlucesme", "stop_ayrilik_cesmesi", "stop_uskudar", "stop_sirkeci", "stop_yenikapi", "stop_kazlicesme", "stop_zeytinburnu_fisekhane", "stop_yeni_mahalle", "stop_bakirkoy", "stop_atakoy", "stop_yesilyurt", "stop_yesilkoy", "stop_florya_akvaryum", "stop_florya", "stop_kucukcekmece", "stop_mustafa_kemal", "stop_halkali"],
    },
    {
      id: "M3", name: "M3: Bakırköy Sahil → Kayaşehir Merkez", mode: "metro", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_bakirkoy_sahil", "stop_ozgurluk_meydani", "stop_incirli", "stop_haznedar", "stop_ilkyuva", "stop_yildiztepe", "stop_molla_gurani", "stop_kirazli", "stop_yeni_mahalle_2", "stop_mahmutbey", "stop_istoc", "stop_ikitelli_sanayi", "stop_turgut_ozal", "stop_siteler", "stop_basak_konutlari", "stop_metrokent", "stop_onurkent", "stop_sehir_hastanesi", "stop_toplu_konutlar", "stop_kayasehir_merkez"],
    },
    {
      id: "M9", name: "M9: Ataköy → Olimpiyat", mode: "metro", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_atakoy", "stop_yenibosna", "stop_cobancesme", "stop_29_ekim_cumhuriyet", "stop_dogu_sanayi", "stop_mimar_sinan", "stop_15_temmuz", "stop_halkali_caddesi", "stop_ataturk_mahallesi", "stop_bahariye_2", "stop_masko", "stop_ikitelli_sanayi", "stop_ziya_gokalp", "stop_olimpiyat"],
    },
    {
      id: "T4", name: "T4: Mescid-i Selam → Topkapı", mode: "tramvay", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_mescid_i_selam", "stop_cebeci", "stop_yeni_mahalle_3", "stop_haci_sukru", "stop_50_yil_bastabya", "stop_cumhuriyet_mahallesi", "stop_kiptas_venezia", "stop_karadeniz", "stop_taskopru", "stop_ali_fuat_basgil", "stop_bosna_cukurcesme", "stop_sagmalcilar", "stop_uluyol_berec", "stop_rami", "stop_topcular", "stop_demirkapi", "stop_sehitlik", "stop_edirnekapi", "stop_vatan", "stop_fetihkapi", "stop_topkapi"],
    },
    {
      id: "M2", name: "M2: Hacıosman → Yenikapı", mode: "metro", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_haciosman", "stop_darussafaka", "stop_ataturk_oto_sanayi", "stop_itu_ayazaga", "stop_sanayi", "stop_4_levent", "stop_levent", "stop_gayrettepe", "stop_sisli", "stop_osmanbey", "stop_taksim", "stop_sishane", "stop_halic", "stop_vezneciler", "stop_yenikapi", "stop_seyrantepe"],
    },
    {
      id: "M6", name: "M6: Boğaziçi Üniversitesi/Hisarüstü → Levent", mode: "metro", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_bogazici_universitesi_hisarustu", "stop_etiler", "stop_nispetiye", "stop_levent"],
    },
    {
      id: "F3", name: "F3: Seyrantepe → Vadistanbul", mode: "funikuler", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_seyrantepe", "stop_vadi_istanbul"],
    },
    {
      id: "M5", name: "M5: Üsküdar → Sultanbeyli", mode: "metro", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_uskudar", "stop_fistikagaci", "stop_baglarbasi", "stop_altunizade", "stop_kisikli", "stop_bulgurlu", "stop_umraniye", "stop_carsi_2", "stop_yamanevler", "stop_cakmak", "stop_ihlamurkuyu", "stop_altinsehir", "stop_imam_hatip_lisesi", "stop_dudullu", "stop_necip_fazil", "stop_cekmekoy", "stop_meclis", "stop_sarigazi", "stop_sancaktepe_sehir_hastanesi", "stop_sancaktepe", "stop_samandira_merkez", "stop_veysel_karani", "stop_hasanpasa", "stop_sultanbeyli"],
    },
    {
      id: "M7", name: "M7: Mecidiyeköy → Mahmutbey", mode: "metro", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_mecidiyekoy", "stop_caglayan", "stop_kagithane", "stop_nurtepe", "stop_alibeykoy", "stop_circir_mahallesi", "stop_veysel_karani_aksemsettin", "stop_yesilpinar", "stop_k_zim_karabekir", "stop_yenimahalle", "stop_karadeniz_mahallesi", "stop_giyimkent_tekstilkent", "stop_oruc_reis_yuzyil", "stop_goztepe_2", "stop_mahmutbey", "stop_yildiz", "stop_fulya"],
    },
    {
      id: "T5", name: "T5: Alibeyköy Cep Otogarı → Eminönü", mode: "tramvay", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_alibeykoy_cep_otogari", "stop_alibeykoy_metro", "stop_alibeykoy_merkez", "stop_universite", "stop_silahtaraga_mahallesi", "stop_eyupsultan_devlet_hastanesi", "stop_eyupsultan_teleferik", "stop_feshane", "stop_ayvansaray", "stop_balat", "stop_fener", "stop_cibali", "stop_kucukpazar", "stop_eminonu"],
    },
    {
      id: "F4", name: "F4: Boğaziçi Üniversitesi/Hisarüstü → Aşiyan", mode: "funikuler", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_rumeli_hisarustu", "stop_asiyan"],
    },
    {
      id: "M8", name: "M8: Bostancı → Parseller", mode: "metro", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_bostanci", "stop_emin_ali_pasa", "stop_aysekadin", "stop_kozyatagi", "stop_kucukbakkalkoy", "stop_icerenkoy", "stop_kayisdagi", "stop_mevlana", "stop_imes", "stop_modoko", "stop_dudullu", "stop_huzur", "stop_parseller"],
    },
    {
      id: "M11", name: "M11: Halkalı → Gayrettepe", mode: "metro", verified: true,
      source: "OpenStreetMap/Overpass API — 2026-09-07",
      stopIds: ["stop_halkali", "stop_halkali_stadi", "stop_olimpiyatkoy", "stop_kayasehir", "stop_ibn_haldun_universitesi", "stop_arnavutkoy_hastane", "stop_tasoluk", "stop_kargo_terminali", "stop_istanbul_havalimani", "stop_ihsaniye", "stop_gokturk", "stop_kemerburgaz", "stop_hasdal", "stop_kagithane", "stop_gayrettepe"],
    },
    {
      id: "F_KADIKOY_BESIKTAS", name: "Vapur: Kadıköy İskelesi ↔ Beşiktaş İskelesi (Şehir Hatları)", mode: "vapur", verified: true,
      source: "OpenStreetMap/Overpass API (route=ferry, Şehir Hatları) — 2026-09-07",
      stopIds: ["stop_kadikoy_iskele", "stop_besiktas_iskele"],
    },
    {
      id: "F_KADIKOY_EMINONU", name: "Vapur: Kadıköy İskelesi ↔ Eminönü İskelesi", mode: "vapur", verified: true,
      source: "OpenStreetMap/Overpass API (route=ferry) — 2026-09-07",
      stopIds: ["stop_kadikoy_iskele", "stop_eminonu_iskele"],
    },
    {
      id: "F_KADIKOY_KARAKOY", name: "Vapur: Kadıköy İskelesi ↔ Karaköy (Turyol)", mode: "vapur", verified: true,
      source: "OpenStreetMap/Overpass API (route=ferry, Turyol) — 2026-09-07. Karaköy ucu için OSM'de ayrı bir iskele noktası yoktu, mevcut stop_karakoy (T1 tramvay hub'ı) yaklaşık konum olarak kullanıldı.",
      stopIds: ["stop_kadikoy_iskele", "stop_karakoy"],
    },
    {
      id: "F_KADIKOY_ADALAR", name: "Vapur: Kadıköy İskelesi ↔ Adalar (Kınalıada-Burgazada-Heybeliada-Büyükada)", mode: "vapur", verified: true,
      source: "OpenStreetMap/Overpass API (route=ferry, Şehir Hatları) — 2026-09-07",
      stopIds: ["stop_kadikoy_iskele", "stop_kinaliada", "stop_burgazada", "stop_heybeliada", "stop_buyukada"],
    },
    {
      id: "F_KABATAS_USKUDAR", name: "Vapur: Kabataş ↔ Üsküdar (İDO)", mode: "vapur", verified: true,
      source: "OpenStreetMap/Overpass API (route=ferry relation'ı, \"Kabataş-Üsküdar\") — 2026-09-07. OSM'de bu relation'ın gerçek iskele durak noktası yoktu; her iki uç için de mevcut raylı sistem hub'ı (stop_kabatas, stop_uskudar) YAKLAŞIK iskele konumu olarak kullanıldı — gerçekte iskeleler bu hub'ların hemen yanında.",
      stopIds: ["stop_kabatas", "stop_uskudar"],
    },
    {
      id: "F_EMINONU_USKUDAR", name: "Vapur: Eminönü İskelesi ↔ Üsküdar", mode: "vapur", verified: true,
      source: "OpenStreetMap/Overpass API (route=ferry relation'ı, \"Eminönü-Üsküdar\") — 2026-09-07. Üsküdar ucu için OSM'de ayrı iskele noktası yoktu, mevcut stop_uskudar hub'ı YAKLAŞIK konum olarak kullanıldı.",
      stopIds: ["stop_eminonu_iskele", "stop_uskudar"],
    },
  ],
  // Not: rota hesaplama (app.js -> resolveTransfer) artık bu listeye değil,
  // hatlar arası GERÇEK ortak duraklardan kurulan bir graf araması (BFS)
  // kullanıyor — ≥2 hatta hizmet eden gerçek aktarma istasyonlarının
  // referans listesi olarak kalsın diye (ileride haritada "aktarma
  // istasyonu" rozeti gibi bir UI için) burada tutuluyor.
  hubStopIds: [
    "stop_yenikapi", "stop_aksaray", "stop_taksim", "stop_sagmalcilar", "stop_bostanci",
    "stop_kabatas", "stop_karakoy", "stop_eminonu", "stop_sirkeci", "stop_topkapi",
    "stop_zeytinburnu", "stop_emniyet_fatih", "stop_topkapi_ulubatli", "stop_bayrampasa_maltepe",
    "stop_kocatepe", "stop_otogar", "stop_yenibosna", "stop_ayrilik_cesmesi", "stop_goztepe",
    "stop_kozyatagi", "stop_kucukyali", "stop_maltepe", "stop_kartal", "stop_pendik",
    "stop_kirazli", "stop_uskudar", "stop_atakoy", "stop_halkali", "stop_mahmutbey",
    "stop_ikitelli_sanayi", "stop_levent", "stop_gayrettepe", "stop_seyrantepe", "stop_dudullu",
    "stop_kagithane",
  ],
};
