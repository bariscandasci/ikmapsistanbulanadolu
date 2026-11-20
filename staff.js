/**
 * Rol, aktif çalışma süresi ve işlem geçmişi.
 * Bölge kilidi TenantStore.regionSlug üzerinden gelir; bu dosya bölgeyi değiştirmez.
 */
(function () {
  const PING_MS = 30000;
  const IDLE_MS = 5 * 60 * 1000;
  const ONLINE_MS = 90000;
  const ACTION_LABELS = {
    create: "Proje ekleme",
    update: "Güncelleme",
    delete: "Silme",
    urgent_toggle: "Acil işaret",
    status_toggle: "Aç / kapa",
  };

  let profile = null;
  let sessionId = null;
  let activeSeconds = 0;
  let idleSeconds = 0;
  let lastInteraction = Date.now();
  let idle = false;
  let tickTimer = null;
  let pingTimer = null;
  let started = false;
  let activityBound = false;
  let accessToken = "";
  let cache = { profiles: [], sessions: [], logs: [], todaySessions: [], todayLogs: [], online: [], recentLogs: [] };

  function client() {
    return window.TenantStore && TenantStore.client;
  }

  function regionSlug() {
    const live = window.TenantStore && TenantStore.regionSlug;
    return live || (profile && profile.region_slug) || "";
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatClock(total) {
    const seconds = Math.max(0, Math.floor(total || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return pad(hours) + "sa " + pad(minutes) + "dk " + pad(rest) + "sn";
  }

  function formatHours(total) {
    const seconds = Math.max(0, Math.floor(total || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours + " sa " + minutes + " dk";
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function displayName(row) {
    if (!row) return "Kullanıcı";
    return row.full_name || row.user_name || row.email || "Kullanıcı";
  }

  function roleLabel(role) {
    return role === "admin" ? "Yönetici" : "Çalışan";
  }

  function paintIdentity() {
    const chip = document.getElementById("userChip");
    const name = document.getElementById("userName");
    const badge = document.getElementById("userRole");
    const button = document.getElementById("adminPanelBtn");
    if (name) name.textContent = displayName(profile);
    if (badge) {
      badge.textContent = roleLabel(profile && profile.role);
      badge.className = profile && profile.role === "admin"
        ? "text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700"
        : "text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600";
    }
    if (chip) {
      chip.classList.remove("hidden");
      chip.classList.add("flex");
    }
    if (button) button.classList.toggle("hidden", !profile || profile.role !== "admin");
    paintTimer();
  }

  function paintTimer() {
    const node = document.getElementById("activeTimer");
    if (!node) return;
    node.textContent = formatClock(activeSeconds);
    node.title = idle ? "Etkileşim yok, süre duraklatıldı" : "Aktif çalışma süresi";
    node.classList.toggle("text-slate-400", idle);
    node.classList.toggle("text-indigo-700", !idle);
  }

  function markInteraction() {
    lastInteraction = Date.now();
    idle = false;
  }

  function tick() {
    idle = Date.now() - lastInteraction >= IDLE_MS;
    if (idle) idleSeconds += 1;
    else activeSeconds += 1;
    paintTimer();
  }

  async function currentToken() {
    const supabase = client();
    if (!supabase) return "";
    const { data } = await supabase.auth.getSession();
    return (data && data.session && data.session.access_token) || "";
  }

  async function rememberToken() {
    accessToken = await currentToken();
  }

  function ping(keepalive) {
    if (!sessionId || !profile) return Promise.resolve();
    const payload = {
      last_ping_at: new Date().toISOString(),
      active_seconds: activeSeconds,
      idle_seconds: idleSeconds,
      is_online: !keepalive,
      region_slug: regionSlug(),
    };
    const cfg = window.SUPABASE_CONFIG || {};
    if (keepalive) {
      if (!cfg.url || !accessToken) return Promise.resolve();
      fetch(cfg.url.replace(/\/$/, "") + "/rest/v1/work_sessions?id=eq." + encodeURIComponent(sessionId), {
        method: "PATCH",
        keepalive: true,
        headers: {
          apikey: cfg.publishableKey,
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
      }).catch(function () {});
      return Promise.resolve();
    }
    const supabase = client();
    if (!supabase) return Promise.resolve();
    return supabase.from("work_sessions").update(payload).eq("id", sessionId).eq("user_id", profile.id).then(function () {
      return rememberToken();
    });
  }

  async function ensureProfile(user) {
    const supabase = client();
    const fallback = {
      id: user.id,
      email: user.email || "",
      full_name: (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || (user.email || "").split("@")[0],
      role: "employee",
      region_slug: regionSlug() || "all",
      _local: true,
    };
    const { data, error } = await supabase.from("user_profiles").select("id,email,full_name,role,region_slug").eq("id", user.id).maybeSingle();
    if (error) {
      console.error(error);
      return fallback;
    }
    if (data) return data;
    const created = {
      id: user.id,
      email: fallback.email,
      full_name: fallback.full_name,
      role: "employee",
      region_slug: fallback.region_slug,
    };
    const inserted = await supabase.from("user_profiles").insert(created).select("id,email,full_name,role,region_slug").maybeSingle();
    if (inserted.error) {
      console.error(inserted.error);
      return fallback;
    }
    return inserted.data || created;
  }

  async function openSession() {
    const supabase = client();
    if (!supabase || !profile || profile._local) return;
    await supabase.from("work_sessions").update({ is_online: false }).eq("user_id", profile.id).eq("is_online", true);
    const { data, error } = await supabase
      .from("work_sessions")
      .insert({
        user_id: profile.id,
        region_slug: regionSlug(),
        login_at: new Date().toISOString(),
        last_ping_at: new Date().toISOString(),
        active_seconds: 0,
        idle_seconds: 0,
        is_online: true,
      })
      .select("id")
      .single();
    if (error) {
      console.error(error);
      return;
    }
    sessionId = data.id;
    await rememberToken();
  }

  function bindActivity() {
    if (activityBound) return;
    activityBound = true;
    ["pointerdown", "keydown", "mousemove", "touchstart", "wheel"].forEach(function (type) {
      window.addEventListener(type, markInteraction, { passive: true });
    });
    window.addEventListener("pagehide", function () {
      ping(true);
    });
  }

  async function start() {
    if (started) return;
    const supabase = client();
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    const user = data && data.user;
    if (!user) return;
    started = true;
    profile = await ensureProfile(user);
    activeSeconds = 0;
    idleSeconds = 0;
    lastInteraction = Date.now();
    idle = false;
    paintIdentity();
    await openSession();
    if (!tickTimer) tickTimer = window.setInterval(tick, 1000);
    if (!pingTimer) pingTimer = window.setInterval(function () { ping(false).catch(function (err) { console.error(err); }); }, PING_MS);
    bindActivity();
  }

  async function stop() {
    const panel = document.getElementById("adminPanel");
    if (panel) {
      panel.classList.add("hidden");
      panel.classList.remove("flex");
    }
    if (sessionId && profile && client()) {
      await client().from("work_sessions").update({
        is_online: false,
        last_ping_at: new Date().toISOString(),
        active_seconds: activeSeconds,
        idle_seconds: idleSeconds,
        region_slug: regionSlug(),
      }).eq("id", sessionId).eq("user_id", profile.id);
    }
    if (tickTimer) window.clearInterval(tickTimer);
    if (pingTimer) window.clearInterval(pingTimer);
    tickTimer = null;
    pingTimer = null;
    sessionId = null;
    started = false;
    profile = null;
    const chip = document.getElementById("userChip");
    const button = document.getElementById("adminPanelBtn");
    if (chip) chip.classList.add("hidden");
    if (button) button.classList.add("hidden");
  }

  function record(entry) {
    const supabase = client();
    if (!supabase || !profile || profile._local) return;
    const row = {
      user_id: profile.id,
      user_name: displayName(profile),
      region_slug: regionSlug(),
      action_type: entry.action_type,
      target_title: entry.target_title || "",
      details: entry.details || {},
    };
    supabase.from("activity_logs").insert(row).then(function (result) {
      if (result.error) console.error(result.error);
    });
  }

  function todayBounds() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start: start, end: end };
  }

  function rangeBounds() {
    const mode = (document.getElementById("adminRange") || {}).value || "today";
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (mode === "week") {
      const day = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - day);
    } else if (mode === "month") {
      start.setDate(1);
    } else if (mode === "custom") {
      const from = document.getElementById("adminFrom");
      const to = document.getElementById("adminTo");
      if (from && from.value) start.setTime(new Date(from.value + "T00:00:00").getTime());
      if (to && to.value) end.setTime(new Date(to.value + "T23:59:59").getTime());
    }
    return { start: start, end: end };
  }

  function inRange(value, bounds) {
    const time = new Date(value).getTime();
    return time >= bounds.start.getTime() && time <= bounds.end.getTime();
  }

  async function loadAdmin() {
    const status = document.getElementById("adminStatus");
    const supabase = client();
    if (!supabase || !profile || profile.role !== "admin") return;
    if (status) status.textContent = "Kayıtlar okunuyor…";
    const bounds = rangeBounds();
    const today = todayBounds();
    const sessionColumns = "id,user_id,region_slug,login_at,last_ping_at,active_seconds,idle_seconds,is_online";
    const logColumns = "id,user_id,user_name,region_slug,action_type,target_title,details,created_at";
    const [profilesResult, sessionsResult, logsResult, todaySessionsResult, todayLogsResult, onlineResult, recentLogsResult] = await Promise.all([
      supabase.from("user_profiles").select("id,email,full_name,role,region_slug").order("full_name"),
      supabase.from("work_sessions").select(sessionColumns).gte("login_at", bounds.start.toISOString()).lte("login_at", bounds.end.toISOString()).order("login_at", { ascending: false }).limit(1000),
      supabase.from("activity_logs").select(logColumns).gte("created_at", bounds.start.toISOString()).lte("created_at", bounds.end.toISOString()).order("created_at", { ascending: false }).limit(1000),
      supabase.from("work_sessions").select(sessionColumns).gte("login_at", today.start.toISOString()).lte("login_at", today.end.toISOString()).limit(1000),
      supabase.from("activity_logs").select(logColumns).gte("created_at", today.start.toISOString()).lte("created_at", today.end.toISOString()).limit(1000),
      supabase.from("work_sessions").select(sessionColumns).eq("is_online", true).order("last_ping_at", { ascending: false }).limit(50),
      supabase.from("activity_logs").select("user_id,created_at").order("created_at", { ascending: false }).limit(200),
    ]);
    const error = profilesResult.error || sessionsResult.error || logsResult.error || todaySessionsResult.error || todayLogsResult.error || onlineResult.error || recentLogsResult.error;
    if (error) {
      console.error(error);
      if (status) status.textContent = "Yönetim tabloları okunamadı. supabase/admin_and_tracking.sql dosyasını SQL Editor'da çalıştırın.";
      return;
    }
    cache = {
      profiles: profilesResult.data || [],
      sessions: sessionsResult.data || [],
      logs: logsResult.data || [],
      todaySessions: todaySessionsResult.data || [],
      todayLogs: todayLogsResult.data || [],
      online: onlineResult.data || [],
      recentLogs: recentLogsResult.data || [],
    };
    fillUserFilter();
    renderAdmin();
    if (status) status.textContent = "";
  }

  function profileById(id) {
    return cache.profiles.find(function (row) { return row.id === id; }) || null;
  }

  function fillUserFilter() {
    const select = document.getElementById("adminUser");
    if (!select) return;
    const current = select.value;
    const options = ['<option value="">Tüm çalışanlar</option>'];
    cache.profiles.forEach(function (row) {
      options.push('<option value="' + esc(row.id) + '">' + esc(displayName(row)) + "</option>");
    });
    select.innerHTML = options.join("");
    if (current) select.value = current;
  }

  function selectedUser() {
    return (document.getElementById("adminUser") || {}).value || "";
  }

  function selectedAction() {
    return (document.getElementById("adminAction") || {}).value || "";
  }

  function visibleLogs() {
    const userId = selectedUser();
    const action = selectedAction();
    return cache.logs.filter(function (row) {
      if (userId && row.user_id !== userId) return false;
      if (action && row.action_type !== action) return false;
      return true;
    });
  }

  function performanceRows() {
    const userId = selectedUser();
    const rows = new Map();
    function bucket(id) {
      if (!rows.has(id)) {
        const person = profileById(id);
        rows.set(id, {
          id: id,
          name: displayName(person) || "Kullanıcı",
          email: person ? person.email : "",
          role: person ? person.role : "employee",
          region: person ? person.region_slug : "",
          active: 0,
          idle: 0,
          actions: 0,
        });
      }
      return rows.get(id);
    }
    cache.sessions.forEach(function (session) {
      if (userId && session.user_id !== userId) return;
      const row = bucket(session.user_id);
      row.active += session.active_seconds || 0;
      row.idle += session.idle_seconds || 0;
      if (session.region_slug) row.region = session.region_slug;
    });
    cache.logs.forEach(function (log) {
      if (userId && log.user_id !== userId) return;
      bucket(log.user_id).actions += 1;
    });
    return Array.from(rows.values()).sort(function (a, b) { return b.active - a.active; });
  }

  function renderOnline() {
    const host = document.getElementById("onlineStrip");
    if (!host) return;
    const now = Date.now();
    const people = (cache.online || []).filter(function (session) {
      return session.is_online && now - new Date(session.last_ping_at).getTime() <= ONLINE_MS;
    });
    if (!people.length) {
      host.innerHTML = '<p class="text-sm text-slate-500">Şu an çevrimiçi çalışan yok.</p>';
      return;
    }
    host.innerHTML = people.map(function (session) {
      const person = profileById(session.user_id);
      const lastLog = (cache.recentLogs || []).find(function (log) { return log.user_id === session.user_id; });
      const when = lastLog ? new Date(lastLog.created_at) : new Date(session.last_ping_at);
      return (
        '<article class="shrink-0 w-56 rounded-xl border border-slate-200 bg-white px-3 py-3">' +
          '<div class="flex items-center gap-2">' +
            '<span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>' +
            '<strong class="text-sm text-slate-800 truncate">' + esc(displayName(person)) + "</strong>" +
          "</div>" +
          '<p class="mt-2 text-[11px] text-slate-500">Son işlem ' + esc(when.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })) + "</p>" +
          '<p class="text-xs font-medium text-indigo-700">' + formatClock(session.active_seconds) + "</p>" +
        "</article>"
      );
    }).join("");
  }

  function renderKpis() {
    const logs = cache.todayLogs || [];
    const active = (cache.todaySessions || []).reduce(function (sum, session) { return sum + (session.active_seconds || 0); }, 0);
    const projects = logs.filter(function (log) { return log.action_type === "create" || log.action_type === "update"; }).length;
    const urgent = logs.filter(function (log) { return log.action_type === "urgent_toggle"; }).length;
    const cards = [
      ["kpiOps", String(logs.length), "Bugünkü işlem"],
      ["kpiHours", formatHours(active), "Aktif çalışma"],
      ["kpiProjects", String(projects), "Eklenen / güncellenen"],
      ["kpiUrgent", String(urgent), "Acil işaret"],
    ];
    cards.forEach(function (card) {
      const node = document.getElementById(card[0]);
      if (!node) return;
      node.querySelector("[data-value]").textContent = card[1];
    });
  }

  function renderTable() {
    const body = document.getElementById("perfBody");
    if (!body) return;
    const rows = performanceRows();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="px-3 py-4 text-sm text-slate-400">Bu aralıkta kayıt yok.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (row) {
      return (
        "<tr class=\"border-t border-slate-100\">" +
          '<td class="px-3 py-2 text-sm text-slate-800">' + esc(row.name) + "</td>" +
          '<td class="px-3 py-2 text-xs text-slate-500">' + esc(row.region || "—") + "</td>" +
          '<td class="px-3 py-2 text-sm text-slate-700">' + formatHours(row.active) + "</td>" +
          '<td class="px-3 py-2 text-sm text-slate-700">' + formatHours(row.idle) + "</td>" +
          '<td class="px-3 py-2 text-sm text-slate-700">' + row.actions + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderLogs() {
    const body = document.getElementById("logBody");
    if (!body) return;
    const rows = visibleLogs();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="px-3 py-4 text-sm text-slate-400">Bu filtrede işlem yok.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (row) {
      const person = profileById(row.user_id);
      return (
        "<tr class=\"border-t border-slate-100\">" +
          '<td class="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">' + new Date(row.created_at).toLocaleString("tr-TR") + "</td>" +
          '<td class="px-3 py-2 text-sm text-slate-800">' + esc(row.user_name || displayName(person)) + "</td>" +
          '<td class="px-3 py-2 text-xs text-slate-600">' + esc(ACTION_LABELS[row.action_type] || row.action_type) + "</td>" +
          '<td class="px-3 py-2 text-sm text-slate-700">' + esc(row.target_title || "—") + "</td>" +
          '<td class="px-3 py-2 text-xs text-slate-500">' + esc(row.region_slug || "—") + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderAdmin() {
    renderOnline();
    renderKpis();
    renderTable();
    renderLogs();
  }

  function csvCell(value) {
    const text = value == null ? "" : String(value);
    if (/[",\n;]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function exportCsv() {
    const lines = [[
      "kayit", "ad", "eposta", "rol", "bolge", "aktif_saniye", "bosta_saniye", "islem_adedi", "islem_turu", "hedef", "zaman",
    ].join(";")];
    performanceRows().forEach(function (row) {
      lines.push([
        "sure", row.name, row.email, roleLabel(row.role), row.region, row.active, row.idle, row.actions, "", "", "",
      ].map(csvCell).join(";"));
    });
    visibleLogs().forEach(function (row) {
      const person = profileById(row.user_id);
      lines.push([
        "islem",
        row.user_name || displayName(person),
        person ? person.email : "",
        person ? roleLabel(person.role) : "",
        row.region_slug || "",
        "",
        "",
        "",
        ACTION_LABELS[row.action_type] || row.action_type,
        row.target_title || "",
        new Date(row.created_at).toLocaleString("tr-TR"),
      ].map(csvCell).join(";"));
    });
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "ekip-raporu.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function openPanel() {
    const panel = document.getElementById("adminPanel");
    if (!panel || !profile || profile.role !== "admin") return;
    panel.classList.remove("hidden");
    panel.classList.add("flex");
    loadAdmin().catch(function (err) {
      console.error(err);
      const status = document.getElementById("adminStatus");
      if (status) status.textContent = "Panel yüklenemedi.";
    });
  }

  function closePanel() {
    const panel = document.getElementById("adminPanel");
    if (panel) {
      panel.classList.add("hidden");
      panel.classList.remove("flex");
    }
    if (typeof window.refreshMapLayout === "function") window.refreshMapLayout();
  }

  function bindPanel() {
    const button = document.getElementById("adminPanelBtn");
    const close = document.getElementById("adminClose");
    const range = document.getElementById("adminRange");
    const refresh = document.getElementById("adminRefresh");
    const exportButton = document.getElementById("adminExport");
    if (button) button.addEventListener("click", openPanel);
    if (close) close.addEventListener("click", closePanel);
    [range, document.getElementById("adminFrom"), document.getElementById("adminTo")].forEach(function (node) {
      if (!node) return;
      node.addEventListener("change", function () {
        const custom = document.getElementById("adminCustom");
        if (custom && range) custom.classList.toggle("hidden", range.value !== "custom");
        loadAdmin().catch(function (err) { console.error(err); });
      });
    });
    ["adminUser", "adminAction"].forEach(function (id) {
      const node = document.getElementById(id);
      if (node) node.addEventListener("change", renderAdmin);
    });
    if (refresh) refresh.addEventListener("click", function () { loadAdmin().catch(function (err) { console.error(err); }); });
    if (exportButton) exportButton.addEventListener("click", exportCsv);
  }

  bindPanel();

  window.StaffDesk = {
    start: start,
    stop: stop,
    record: record,
  };
})();
