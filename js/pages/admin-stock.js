/* /js/pages/admin-stock.js */

(function() {
  const client = window.supabaseClient;

  // =========================
  // State
  // =========================
  const KNOWN_CATEGORIES = ["BEBIDAS","INSUMOS BARRA","LIMPIEZA","LIBRERIA","MANTENIMIENTO"];
  let currentCategory = "ALL";
  let rowsAll = [];
  let pendingReqBySku = new Map();
  let sessionRef = null;

  // =========================
  // UI Refs
  // =========================
  const tbody = document.querySelector("#adminStockTable tbody");
  const statusEl = document.getElementById("statusLine");
  const countEl = document.getElementById("countLine");
  const searchEl = document.getElementById("search");
  const showInactiveEl = document.getElementById("showInactive");
  const btnRefresh = document.getElementById("btnRefresh");
  const btnBack = document.getElementById("btnBack");

  // =========================
  // Auth
  // =========================
  async function requireAdmin() {
    if (!client) {
      window.location.replace("../auth/login.html");
      return null;
    }
    const { data: sessData } = await client.auth.getSession();
    const session = sessData?.session;
    if (!session) {
      window.location.replace("../auth/login.html");
      return null;
    }

    const { data: prof, error: profErr } = await client
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (profErr || prof?.role?.toUpperCase() !== "ADMIN") {
      try { await client.auth.signOut(); } catch {}
      window.location.replace("../auth/login.html");
      return null;
    }
    return session;
  }

  // =========================
  // Helpers
  // =========================
  function setStatus(msg) { statusEl.textContent = msg || ""; }

  function escapeHtml(str) {
    return String(str ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  function asNum(v, fallback = 0) {
    const n = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function fmtDateTime(ts) {
    if (!ts) return "—";
    try {
      return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(ts));
    } catch { return "—"; }
  }

  function fmtRelative(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    const ms = Date.now() - d.getTime();
    if (!Number.isFinite(ms)) return "—";
    const min = Math.floor(ms / 60000);
    if (min < 1) return "recién";
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h`;
    const days = Math.floor(h / 24);
    return `${days}d`;
  }

  // =========================
  // Data Logic
  // =========================
  async function loadPendingRequests() {
    pendingReqBySku.clear();
    const { data, error } = await client
      .from("inventory_check_requests")
      .select("id,sku_id,status")
      .in("status", ["OPEN","IN_PROGRESS"]);

    if (error) throw error;
    (data || []).forEach(r => {
      // guardamos el más reciente o cualquiera abierto
      if (!pendingReqBySku.has(r.sku_id)) {
        pendingReqBySku.set(r.sku_id, { id: r.id, status: r.status });
      }
    });
  }

  async function loadAdminStock() {
    setStatus("Sincronizando...");
    try {
      const { data, error } = await client
        .from("v_admin_stock")
        .select("*");

      if (error) throw error;
      rowsAll = data || [];

      await loadPendingRequests();
      render();
    } catch (e) {
      console.error(e);
      setStatus("Error de red");
    } finally { setStatus(""); }
  }

  async function upsertStockActual(skuId, value) {
    const stockActual = Math.max(0, asNum(value, 0));
    const { error } = await client
      .from("inventory_stock_current")
      .upsert(
        { sku_id: skuId, stock_actual: stockActual, updated_from: "admin_manual" },
        { onConflict: "sku_id" }
      );
    if (error) throw error;
    return stockActual;
  }

  async function createCheckRequest(skuId) {
    const { error } = await client
      .from("inventory_check_requests")
      .insert({ sku_id: skuId, created_by: sessionRef.user.id, status: "OPEN" });
    if (error) throw error;
  }

  // =========================
  // Rendering
  // =========================
  function getFiltered() {
    const term = (searchEl.value || "").toLowerCase().trim();
    const showInactive = !!showInactiveEl.checked;

    return rowsAll.filter(r => {
      if (!showInactive && r.is_active === false) return false;
      const cat = (r.category || "").trim();
      if (currentCategory !== "ALL") {
        if (currentCategory === "OTROS") {
          if (KNOWN_CATEGORIES.includes(cat)) return false;
        } else if (cat !== currentCategory) return false;
      }
      if (!term) return true;
      return (r.name || "").toLowerCase().includes(term) || (r.external_id || "").toLowerCase().includes(term);
    }).sort((a, b) => {
      const aLow = (asNum(a.stock_ideal,0) - asNum(a.stock_actual,0)) > 0 ? 1 : 0;
      const bLow = (asNum(b.stock_ideal,0) - asNum(b.stock_actual,0)) > 0 ? 1 : 0;
      if (aLow !== bLow) return bLow - aLow; // Bajo ideal primero
      return String(a.name).localeCompare(String(b.name));
    });
  }

  function render() {
    const rows = getFiltered();
    countEl.textContent = `MOSTRANDO ${rows.length}`;
    
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No hay resultados.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    rows.forEach(r => {
      const tr = document.createElement("tr");
      tr.className = "list-row";

      const cur = asNum(r.stock_actual, 0);
      const ide = asNum(r.stock_ideal, 0);
      const diff = Math.max(0, ide - cur);
      const isLow = diff > 0;
      if (isLow) tr.classList.add("is-low");

      // Item Name
      const tdName = document.createElement("td");
      tdName.className = "cell-pl";
      const off = r.is_active === false ? ' <span class="tag tag-red">OFF</span>' : '';
      tdName.innerHTML = `
        <div class="row-title">${escapeHtml(r.name || "-")}${off}</div>
        <div class="row-sub-text">COD: ${escapeHtml(r.external_id || "-")}</div>
      `;

      // Current Stock (Override)
      const tdCur = document.createElement("td");
      tdCur.className = "text-center";
      const wrapCur = document.createElement("div");
      wrapCur.className = "cell-inline";
      const inVal = document.createElement("input");
      inVal.type = "number";
      inVal.className = "table-input table-input--narrow";
      inVal.value = cur;
      
      const btnSave = document.createElement("button");
      btnSave.className = "btn-mini btn-mini-primary";
      btnSave.textContent = "✓";
      btnSave.disabled = true;

      inVal.oninput = () => { btnSave.disabled = (Number(inVal.value) === cur); };
      btnSave.onclick = async () => {
        try {
          btnSave.disabled = inVal.disabled = true;
          const saved = await upsertStockActual(r.sku_id, inVal.value);
          r.stock_actual = saved;
          render();
        } catch (e) {
          alert("Error al actualizar stock");
          inVal.value = cur;
        } finally { btnSave.disabled = inVal.disabled = false; }
      };

      wrapCur.append(inVal, btnSave);
      tdCur.appendChild(wrapCur);

      // Ideal & Diff
      const tdIdeal = document.createElement("td");
      tdIdeal.className = "text-center";
      tdIdeal.innerHTML = `<span class="row-sub-text">${ide}</span>`;

      const tdDiff = document.createElement("td");
      tdDiff.className = "text-center";
      tdDiff.innerHTML = `<span class="row-diff">${diff}</span>`;

      // Status Flag
      const tdFlag = document.createElement("td");
      tdFlag.className = "text-center";
      const fl = document.createElement("span");
      fl.className = "row-flag" + (isLow ? " is-low" : "");
      fl.textContent = isLow ? "BAJO IDEAL" : "OK";
      tdFlag.appendChild(fl);

      // Last Check
      const tdLast = document.createElement("td");
      tdLast.className = "text-center";
      tdLast.innerHTML = `<span class="row-sub-text lastcheck" title="${fmtDateTime(r.last_check_at)}">${fmtRelative(r.last_check_at)}</span>`;

      // Actions
      const tdAct = document.createElement("td");
      tdAct.className = "text-center cell-pr";
      const pending = pendingReqBySku.get(r.sku_id);
      if (pending) {
        tdAct.innerHTML = `<span class="tag tag-yellow">${pending.status === 'IN_PROGRESS' ? 'EN CURSO' : 'PENDIENTE'}</span>`;
      } else {
        const b = document.createElement("button");
        b.className = "btn-primary btn-xs";
        b.textContent = "Check";
        b.onclick = async () => {
          try {
            b.disabled = true;
            await createCheckRequest(r.sku_id);
            await loadAdminStock();
          } catch (e) { b.disabled = false; }
        };
        tdAct.appendChild(b);
      }

      tr.append(tdName, tdCur, tdIdeal, tdDiff, tdFlag, tdLast, tdAct);
      tbody.appendChild(tr);
    });
  }

  // =========================
  // Listeners
  // =========================
  function attachTabs() {
    document.querySelectorAll("#categoryTabs .tab-btn").forEach(btn => {
      btn.onclick = (e) => {
        document.querySelectorAll("#categoryTabs .tab-btn").forEach(b => b.classList.remove("active"));
        e.currentTarget.classList.add("active");
        currentCategory = e.currentTarget.dataset.cat || "ALL";
        render();
      };
    });
  }

  searchEl.oninput = render;
  showInactiveEl.onchange = render;
  btnRefresh.onclick = loadAdminStock;
  if(btnBack) btnBack.onclick = () => window.location.href = "admin-stock-index.html";

  // =========================
  // Boot
  // =========================
  (async function init() {
    try {
      sessionRef = await requireAdmin();
      if (!sessionRef) return;
      attachTabs();
      await loadAdminStock();
    } catch (e) {
      console.error(e);
      window.location.replace("../auth/login.html");
    }
  })();

})();
