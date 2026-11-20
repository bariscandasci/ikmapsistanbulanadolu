/**
 * Çok kiracılı Supabase okuma/yazma katmanı.
 * Tüm hat ve nokta sorguları company_id + region_id ile süzülür.
 * app.js'ten sonra yüklenir.
 */
(function () {
  const REGION_ORDER = [
    "ankara-guvenlik",
    "ankara-servis",
    "ist-avrupa-guvenlik",
    "ist-avrupa-servis",
    "ist-anadolu-guvenlik",
    "ist-anadolu-servis",
  ];
  const STORAGE_KEY = "ikmaps_region_slug";
  const PAGE_SIZE = 1000;
  // sync_from_sheets.py içindeki SHEET_SOURCES ile aynı adresler.
  // Ankara Güvenlik reposunun main dalında SHEET_API_URL boş; o bölge butonla silinmez.
  const SHEET_SOURCES = [
    { slug: "ankara-servis", url: "https://script.google.com/macros/s/AKfycbxprctzoQPNbHz1kA3g4qQciSZ9hqIGtN_BC_q0YzSEvOmUGYxW9PKWTTpA7z6SoPw/exec" },
    { slug: "ist-avrupa-guvenlik", url: "https://script.google.com/macros/s/AKfycbxK0P6RVaMEqxJaAdvxFhBh0MbHIeiywb3NfTxdqTKjC8KTY5OXVZGFroUkK4D87u8/exec" },
    { slug: "ist-avrupa-servis", url: "https://script.google.com/macros/s/AKfycbxj6m9Kv2J0I2lFJJjP6XUVc3-04pO0TS2CriInYaW3Yp9j3NS0j9_eKq7juOokbNPI/exec" },
    { slug: "ist-anadolu-guvenlik", url: "https://script.google.com/macros/s/AKfycbxWXq2J0JS2YLoqKY9aQntbT6SAvkWUrDAWhHd66YlRyz9yvoTxCjeoOH9crRh6q0cx/exec" },
    { slug: "ist-anadolu-servis", url: "https://script.google.com/macros/s/AKfycbxWlbu0OwKM76SKoExW_1UtnLlK7fQFP4EqKSRo_3cFGn6nc6Gha7qPwTKYOeJO6r4/exec" },
  ];

  const cfg = window.SUPABASE_CONFIG || {};
  const siteLock = window.SITE_LOCK
    ? SITE_LOCK.resolveSiteLock(cfg, window.location)
    : { slug: "", source: "", hideSelector: false, title: "" };
  const regionSelect = document.getElementById("regionSelect");
  const regionSwitcher = document.getElementById("regionSwitcher");
  const regionStatus = document.getElementById("regionStatus");
  const sheetSyncBtnEarly = document.getElementById("sheetSyncBtn");
  const siteBrand = document.getElementById("siteBrand");

  function applySiteChrome() {
    const locked = Boolean(siteLock.slug);
    if (regionSwitcher) regionSwitcher.classList.toggle("hidden", locked && siteLock.hideSelector);
    if (sheetSyncBtnEarly) sheetSyncBtnEarly.classList.toggle("hidden", locked && siteLock.hideSelector);
    if (locked) document.documentElement.classList.add("region-locked");
    if (siteLock.title) {
      document.title = siteLock.title;
      if (siteBrand) siteBrand.textContent = siteLock.title.split(" - ")[0];
    }
  }
  applySiteChrome();

  let client = null;
  let company = null;
  let regions = [];

  function setStatus(text) {
    if (regionStatus) regionStatus.textContent = text || "";
  }

  function detailsOf(row) {
    let details = row && row.details;
    if (typeof details === "string") {
      try {
        details = JSON.parse(details);
      } catch {
        details = {};
      }
    }
    return details && typeof details === "object" ? details : {};
  }

  function metadataOf(row) {
    let metadata = row && row.metadata;
    if (typeof metadata === "string") {
      try {
        metadata = JSON.parse(metadata);
      } catch {
        metadata = {};
      }
    }
    return metadata && typeof metadata === "object" ? metadata : {};
  }

  async function fetchAll(table, columns, filters) {
    const rows = [];
    let from = 0;
    while (true) {
      let query = client.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
      Object.keys(filters).forEach((key) => {
        query = query.eq(key, filters[key]);
      });
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return rows;
  }

  function sortRegions(list) {
    return list.slice().sort((a, b) => {
      const ai = REGION_ORDER.indexOf(a.slug);
      const bi = REGION_ORDER.indexOf(b.slug);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }

  function fillRegionSelect(selectedSlug) {
    if (!regionSelect) return;
    regionSelect.innerHTML = "";
    regions.forEach((region) => {
      const option = document.createElement("option");
      option.value = region.slug;
      option.textContent = region.name;
      regionSelect.appendChild(option);
    });
    if (selectedSlug && regions.some((region) => region.slug === selectedSlug)) {
      regionSelect.value = selectedSlug;
    }
  }

  /** PostGIS GeoJSON ([lng, lat]) -> Leaflet ([lat, lng]). */
  function geometryForMap(raw) {
    if (!raw) return undefined;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        return undefined;
      }
    }
    const swap = (pair) => [Number(pair[1]), Number(pair[0])];
    if (raw.type === "LineString" && Array.isArray(raw.coordinates)) {
      return raw.coordinates.filter((pair) => pair && pair.length >= 2).map(swap);
    }
    if (raw.type === "MultiLineString" && Array.isArray(raw.coordinates)) {
      return raw.coordinates.flatMap((part) =>
        (part || []).filter((pair) => pair && pair.length >= 2).map(swap)
      );
    }
    if (Array.isArray(raw) && raw.length > 1 && Array.isArray(raw[0])) return raw;
    return undefined;
  }

  function lineFromRow(row) {
    const metadata = metadataOf(row);
    const geometry = geometryForMap(row.geometry);
    return {
      id: metadata.externalId || row.line_code,
      name: row.line_name,
      mode: metadata.mode || "otobus",
      verified: metadata.verified !== false,
      source: metadata.source || "",
      stopIds: metadata.stopIds || [],
      hatNo: metadata.hatNo || "",
      operator: metadata.operator || "",
      headwayMin: metadata.headwayMin,
      geometry: geometry || undefined,
      role: metadata.role || "network",
    };
  }

  function bundleFromRows(region, lineRows, pointRows) {
    const lines = lineRows.map(lineFromRow);
    const projects = [];
    const districts = [];
    const curatedStops = [];
    const networkStops = [];
    const candidates = [];
    let hubStopIds = [];

    pointRows.forEach((row) => {
      const details = detailsOf(row);
      const lat = row.lat != null ? Number(row.lat) : details.lat;
      const lng = row.lng != null ? Number(row.lng) : details.lng;
      if (row.point_type === "project") {
        projects.push({
          ...details,
          id: details.id || row.id,
          name: details.name || row.title,
          lat,
          lng,
          address: details.address || "",
          _rowId: row.id,
        });
      } else if (row.point_type === "district") {
        districts.push({ ...details, id: details.id || row.id, name: details.name || row.title, lat, lng });
      } else if (row.point_type === "stop") {
        const stop = { ...details, id: details.id || row.id, name: details.name || row.title, lat, lng };
        if (details.role === "curated") curatedStops.push(stop);
        else networkStops.push(stop);
      } else if (row.point_type === "candidate") {
        candidates.push({ ...details, id: details.id || row.id, fullName: details.fullName || row.title, lat, lng });
      } else if (row.point_type === "config") {
        hubStopIds = details.hubStopIds || [];
        (details.stopsWithoutCoords || []).forEach((stop) => {
          if (stop.role === "network" || stop.role === "dolmus") networkStops.push(stop);
          else curatedStops.push(stop);
        });
        (details.candidatesWithoutCoords || []).forEach((candidate) => candidates.push(candidate));
      }
    });

    const curatedLines = lines.filter((line) => line.role === "curated");
    const serviceLines = lines.filter((line) => line.role !== "curated");
    return {
      region,
      projects,
      districts,
      transitStops: curatedStops,
      transitLines: curatedLines,
      hubStopIds,
      network: { stops: networkStops, lines: serviceLines },
      candidates,
    };
  }

  async function loadRegion(region) {
    if (!company || !region) return;
    setStatus(`${region.name} yükleniyor…`);
    const filters = { company_id: company.id, region_id: region.id };
    const [lineRows, pointRows] = await Promise.all([
      fetchAll("transit_lines", "id,company_id,region_id,line_code,line_name,geometry,metadata", filters),
      fetchAll("map_points", "id,company_id,region_id,point_type,title,lat,lng,details", filters),
    ]);
    const bundle = bundleFromRows(region, lineRows, pointRows);
    if (typeof applySupabaseRegion === "function") applySupabaseRegion(bundle);
    const projectCount = bundle.projects.length;
    const lineCount = (bundle.network.lines || []).length;
    setStatus(`${company.name} · ${projectCount} proje · ${lineCount} hat`);
    try {
      localStorage.setItem(STORAGE_KEY, region.slug);
    } catch {
      /* yoksay */
    }
    TenantStore.region = region;
    TenantStore.regionSlug = region.slug;
  }

  async function write(body) {
    if (!company || !TenantStore.region) throw new Error("Bölge seçili değil");
    const region = TenantStore.region;
    if (body.action === "add") {
      const project = body.project || {};
      const id =
        project.id ||
        "proj_" +
          Date.now().toString(36);
      project.id = id;
      const record = { ...project, id, role: "project" };
      delete record._rowId;
      const { data, error } = await client
        .from("map_points")
        .insert({
          company_id: company.id,
          region_id: region.id,
          point_type: "project",
          title: record.name,
          lat: record.lat,
          lng: record.lng,
          details: record,
        })
        .select("id")
        .single();
      if (error) throw error;
      project._rowId = data.id;
      auditWrite(body);
      return { ok: true, id };
    }
    if (body.action === "delete") {
      const project = (typeof ANKARA_DATA !== "undefined" ? ANKARA_DATA.projects : []).find((row) => row.id === body.id);
      if (!project || !project._rowId) return { ok: false, notFound: [body.id] };
      const { error } = await client
        .from("map_points")
        .delete()
        .eq("id", project._rowId)
        .eq("company_id", company.id)
        .eq("region_id", region.id);
      if (error) throw error;
      auditWrite(body);
      return { ok: true };
    }
    if (body.action === "updateBatch") {
      const notFound = [];
      for (const item of body.patches || []) {
        const project = (ANKARA_DATA.projects || []).find((row) => row.id === item.id);
        if (!project || !project._rowId) {
          notFound.push(item.id);
          continue;
        }
        const next = { ...project, ...item.patch, role: "project" };
        delete next._rowId;
        const { error } = await client
          .from("map_points")
          .update({
            title: next.name,
            lat: next.lat,
            lng: next.lng,
            details: next,
          })
          .eq("id", project._rowId)
          .eq("company_id", company.id)
          .eq("region_id", region.id);
        if (error) throw error;
        auditWrite({ action: "updateBatch", patches: [item] });
      }
      return { ok: true, notFound };
    }
    throw new Error("Desteklenmeyen Supabase yazması");
  }

  function auditWrite(body) {
    if (!window.StaffDesk || typeof StaffDesk.record !== "function") return;
    const projects = typeof ANKARA_DATA !== "undefined" && ANKARA_DATA.projects ? ANKARA_DATA.projects : [];
    const titleOf = (id) => {
      const row = projects.find((item) => item.id === id);
      return (row && (row.name || row.title)) || id || "";
    };
    if (body.action === "add") {
      StaffDesk.record({
        action_type: "create",
        target_title: (body.project && body.project.name) || "",
        details: { id: body.project && body.project.id },
      });
      return;
    }
    if (body.action === "delete") {
      StaffDesk.record({
        action_type: "delete",
        target_title: body.title || titleOf(body.id),
        details: { id: body.id },
      });
      return;
    }
    (body.patches || []).forEach((item) => {
      const patch = item.patch || {};
      const keys = Object.keys(patch);
      let actionType = "update";
      if (keys.length === 1 && keys[0] === "urgent") actionType = "urgent_toggle";
      else if (keys.length === 1 && keys[0] === "active") actionType = "status_toggle";
      StaffDesk.record({
        action_type: actionType,
        target_title: titleOf(item.id),
        details: patch,
      });
    });
  }

  async function boot() {
    if (!client) return;
    setStatus("Şirket ve bölgeler okunuyor…");
    try {
      let companyQuery = client.from("companies").select("id,name,slug");
      if (cfg.companySlug) companyQuery = companyQuery.eq("slug", cfg.companySlug);
      const { data: companyRows, error: companyError } = await companyQuery;
      if (companyError) throw companyError;
      company = (companyRows || [])[0] || null;
      if (!company) {
        setStatus("Supabase'de şirket kaydı yok. migrate_all_regions.py çalıştırın. Yerel yedek gösteriliyor.");
        if (regionSelect) regionSelect.innerHTML = '<option value="">Bölge yok</option>';
        if (typeof loadLiveProjects === "function") loadLiveProjects();
        loadLocalFallback();
        return;
      }
      const { data: regionRows, error: regionError } = await client
        .from("regions")
        .select("id,company_id,name,slug,center_lat,center_lng")
        .eq("company_id", company.id);
      if (regionError) throw regionError;
      regions = sortRegions(regionRows || []);
      if (!regions.length) {
        setStatus("Bu şirkete bağlı bölge yok. migrate_all_regions.py çalıştırın.");
        if (regionSelect) regionSelect.innerHTML = '<option value="">Bölge yok</option>';
        if (typeof loadLiveProjects === "function") loadLiveProjects();
        loadLocalFallback();
        return;
      }
      let slug = siteLock.slug;
      if (!slug) {
        try {
          slug = localStorage.getItem(STORAGE_KEY) || "";
        } catch {
          slug = "";
        }
      }
      if (siteLock.slug && !regions.some((region) => region.slug === siteLock.slug)) {
        setStatus(`Bu site ${siteLock.slug} bölgesine kilitli, Supabase'de bu bölge yok.`);
        if (regionSelect) regionSelect.innerHTML = '<option value="">Bölge yok</option>';
        return;
      }
      if (!regions.some((region) => region.slug === slug)) slug = regions[0].slug;
      fillRegionSelect(slug);
      if (siteLock.slug && regionSelect) regionSelect.disabled = true;
      await loadRegion(regions.find((region) => region.slug === slug));
    } catch (err) {
      console.error(err);
      setStatus("Supabase okunamadı, yerel yedek gösteriliyor.");
      if (typeof loadLiveProjects === "function") loadLiveProjects();
      loadLocalFallback();
    }
  }

  function loadLocalFallback() {
    if (typeof loadLocalTransitNetwork !== "function") return;
    loadLocalTransitNetwork().then(() => {
      if (typeof loadLocalTransitGeometry === "function") loadLocalTransitGeometry();
    });
  }

  if (regionSelect && !siteLock.slug) {
    regionSelect.addEventListener("change", () => {
      const region = regions.find((item) => item.slug === regionSelect.value);
      if (!region) return;
      loadRegion(region).catch((err) => {
        console.error(err);
        setStatus("Bölge yüklenemedi.");
      });
    });
  }

  function coordOk(lat, lng) {
    const la = Number(lat);
    const ln = Number(lng);
    return Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
  }

  function projectPoint(region, project) {
    const lat = Number(project.lat);
    const lng = Number(project.lng);
    if (!coordOk(lat, lng)) return null;
    const details = { ...project, role: "project" };
    delete details._rowId;
    return {
      company_id: company.id,
      region_id: region.id,
      point_type: "project",
      title: String(project.name || project.id || "proje").slice(0, 300),
      lat,
      lng,
      details,
    };
  }

  function candidatePoint(region, candidate) {
    const coords = candidate.coords || {};
    const lat = Number(candidate.lat != null ? candidate.lat : coords.lat);
    const lng = Number(candidate.lng != null ? candidate.lng : coords.lng);
    if (!coordOk(lat, lng)) return null;
    const details = { ...candidate, role: "candidate", lat, lng };
    delete details._rowId;
    return {
      company_id: company.id,
      region_id: region.id,
      point_type: "candidate",
      title: String(candidate.fullName || candidate.name || candidate.id || "aday").slice(0, 300),
      lat,
      lng,
      details,
    };
  }

  async function replaceRegionPeople(region, projects, candidates) {
    const { error: deleteError } = await client
      .from("map_points")
      .delete()
      .eq("company_id", company.id)
      .eq("region_id", region.id)
      .in("point_type", ["project", "candidate"]);
    if (deleteError) throw deleteError;

    const projectRows = [];
    let skipped = 0;
    (projects || []).forEach((project) => {
      const row = projectPoint(region, project);
      if (row) projectRows.push(row);
      else skipped += 1;
    });
    const candidateRows = [];
    const loose = [];
    (candidates || []).forEach((candidate) => {
      const row = candidatePoint(region, candidate);
      if (row) candidateRows.push(row);
      else loose.push(candidate);
    });
    const rows = projectRows.concat(candidateRows);
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await client.from("map_points").insert(rows.slice(i, i + 200));
      if (error) throw error;
    }

    const { data: configs, error: configError } = await client
      .from("map_points")
      .select("id,details")
      .eq("company_id", company.id)
      .eq("region_id", region.id)
      .eq("point_type", "config")
      .limit(1);
    if (configError) throw configError;
    if (configs && configs.length) {
      const details = detailsOf(configs[0]);
      details.candidatesWithoutCoords = loose;
      const { error } = await client
        .from("map_points")
        .update({ details })
        .eq("id", configs[0].id)
        .eq("company_id", company.id)
        .eq("region_id", region.id);
      if (error) throw error;
    }
    return { projects: projectRows.length, candidates: candidateRows.length, loose: loose.length, skipped };
  }

  async function syncFromSheets() {
    if (!client || !company) throw new Error("Supabase hazır değil");
    const notes = [];
    for (const source of SHEET_SOURCES) {
      const region = regions.find((item) => item.slug === source.slug);
      if (!region) {
        notes.push(`${source.slug}: bölge yok`);
        continue;
      }
      setStatus(`${region.name} Sheet okunuyor…`);
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`${region.name} Sheet yanıtı ${response.status}`);
      const data = await response.json();
      if (!data || data.ok === false || !Array.isArray(data.projects)) {
        throw new Error(`${region.name} Sheet projeleri okunamadı`);
      }
      const counts = await replaceRegionPeople(region, data.projects, data.candidates || []);
      notes.push(`${region.name}: ${counts.projects} proje`);
    }
    const current = regions.find((item) => item.slug === (regionSelect && regionSelect.value)) || TenantStore.region;
    if (current) await loadRegion(current);
    setStatus(notes.join(" · "));
    return notes;
  }

  const sheetSyncBtn = document.getElementById("sheetSyncBtn");
  if (sheetSyncBtn) {
    sheetSyncBtn.addEventListener("click", async () => {
      sheetSyncBtn.disabled = true;
      const previous = sheetSyncBtn.textContent;
      sheetSyncBtn.textContent = "Güncelleniyor…";
      try {
        await syncFromSheets();
      } catch (err) {
        console.error(err);
        setStatus("Sheets güncellemesi başarısız: " + (err && err.message ? err.message : "bilinmeyen hata"));
      } finally {
        sheetSyncBtn.disabled = false;
        sheetSyncBtn.textContent = previous;
      }
    });
  }

  window.TenantStore = {
    client: null,
    region: null,
    regionSlug: "",
    boot,
    write,
    syncFromSheets,
    get companyId() {
      return company ? company.id : null;
    },
  };

  const loginForm = document.getElementById("loginForm");
  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const loginError = document.getElementById("loginError");
  const loginSubmit = document.getElementById("loginSubmit");
  const logoutBtn = document.getElementById("logoutBtn");
  let appStarted = false;

  function showApp() {
    document.body.classList.add("authenticated");
  }

  function showLogin() {
    document.body.classList.remove("authenticated");
    const list = document.getElementById("resultsList");
    if (list) list.innerHTML = "";
  }

  function loginMessage(error) {
    const text = (error && error.message) || "";
    if (/confirm/i.test(text)) return "E-posta henüz doğrulanmamış.";
    if (/invalid/i.test(text) || /credential/i.test(text)) return "E-posta veya şifre hatalı.";
    return "Giriş yapılamadı. Bilgileri kontrol edip tekrar deneyin.";
  }

  function paintMap() {
    if (typeof window.refreshMapLayout === "function") window.refreshMapLayout();
  }

  function afterLayout(done) {
    requestAnimationFrame(() => requestAnimationFrame(done));
  }

  async function startApp() {
    if (appStarted) return;
    appStarted = true;
    showApp();
    await new Promise((resolve) => afterLayout(resolve));
    paintMap();
    try {
      await boot();
    } catch (err) {
      console.error(err);
      setStatus("Veriler yüklenemedi.");
    }
    paintMap();
    setTimeout(paintMap, 200);
    try {
      if (window.StaffDesk) await StaffDesk.start();
    } catch (err) {
      console.error(err);
    }
  }

  async function requireAuth() {
    if (!cfg.url || !cfg.publishableKey || !window.supabase) {
      showLogin();
      if (loginError) loginError.textContent = "Supabase ayarı yok.";
      return;
    }
    client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    TenantStore.client = client;
    client.auth.onAuthStateChange((event, session) => {
      if (!session || event === "SIGNED_OUT") {
        appStarted = false;
        if (window.StaffDesk) StaffDesk.stop();
        showLogin();
        return;
      }
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setTimeout(() => {
          startApp();
        }, 0);
      }
    });
    const { data, error } = await client.auth.getSession();
    if (error) {
      showLogin();
      if (loginError) loginError.textContent = "Oturum okunamadı.";
      return;
    }
    if (data && data.session) await startApp();
    else showLogin();
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!client) return;
      if (loginError) loginError.textContent = "";
      if (loginSubmit) {
        loginSubmit.disabled = true;
        loginSubmit.textContent = "Giriş yapılıyor…";
      }
      try {
        const { error } = await client.auth.signInWithPassword({
          email: loginEmail.value.trim(),
          password: loginPassword.value,
        });
        if (error) {
          if (loginError) loginError.textContent = loginMessage(error);
        }
      } catch (err) {
        if (loginError) loginError.textContent = loginMessage(err);
      } finally {
        if (loginSubmit) {
          loginSubmit.disabled = false;
          loginSubmit.textContent = "Giriş Yap";
        }
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      if (window.StaffDesk) await StaffDesk.stop();
      if (client) await client.auth.signOut();
      showLogin();
    });
  }

  requireAuth();
})();
