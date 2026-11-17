/**
 * Bölge kilidi: dağıtım ayarı, alt alan adı veya ?region= parametresi.
 * config.js (VITE_LOCKED_REGION) tanımlıysa o bölge kazanır; adresle başka bölgeye geçilmez.
 */
(function () {
  const SLUGS = [
    "ankara-guvenlik",
    "ankara-servis",
    "ist-avrupa-guvenlik",
    "ist-avrupa-servis",
    "ist-anadolu-guvenlik",
    "ist-anadolu-servis",
  ];
  const TITLES = {
    "ankara-servis": "Ankara Servis - İK Harita",
    "ankara-guvenlik": "Ankara Güvenlik - İK Harita",
    "ist-avrupa-servis": "İstanbul Avrupa Servis - İK Harita",
    "ist-avrupa-guvenlik": "İstanbul Avrupa Güvenlik - İK Harita",
    "ist-anadolu-servis": "İstanbul Anadolu Servis - İK Harita",
    "ist-anadolu-guvenlik": "İstanbul Anadolu Güvenlik - İK Harita",
  };

  function knownSlug(value) {
    const slug = String(value || "").trim().toLowerCase();
    return SLUGS.indexOf(slug) !== -1 ? slug : "";
  }

  function slugFromHost(hostname) {
    const host = String(hostname || "").toLowerCase().split(":")[0];
    if (!host || host === "localhost" || host === "127.0.0.1" || host === "[::1]") return "";
    return knownSlug(host.split(".")[0]);
  }

  function slugFromQuery(search) {
    try {
      return knownSlug(new URLSearchParams(search || "").get("region"));
    } catch (err) {
      return "";
    }
  }

  function resolveSiteLock(config, loc) {
    const cfg = config || {};
    const fromEnv = knownSlug(cfg.lockedRegion);
    const fromHost = slugFromHost(loc && loc.hostname);
    const fromQuery = slugFromQuery(loc && loc.search);
    const slug = fromEnv || fromHost || fromQuery || "";
    const source = fromEnv ? "env" : fromHost ? "host" : fromQuery ? "query" : "";
    return {
      slug: slug,
      source: source,
      hideSelector: Boolean(slug),
      title: cfg.siteTitle || TITLES[slug] || "",
    };
  }

  window.SITE_LOCK = {
    SLUGS: SLUGS,
    TITLES: TITLES,
    resolveSiteLock: resolveSiteLock,
  };
})();
