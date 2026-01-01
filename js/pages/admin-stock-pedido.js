/* /js/pages/admin-stock-pedido.js */

(function() {
  const client = window.supabaseClient;

  // =========================
  // States
  // =========================
  let openDetailsKey = null; // line_id
  let openDetailsRow = null;

  // =========================
  // UI Refs
  // =========================
  const statusLine = document.getElementById("statusLine");
  const countLine = document.getElementById("countLine");
  const reqTbody = document.querySelector("#reqTable tbody");
  const pendTbody = document.querySelector("#pendingTable tbody");
  const panelSolicitudes = document.getElementById("panelSolicitudes");
  const panelPendientes = document.getElementById("panelPendientes");
  const tabSolicitudes = document.getElementById("tabSolicitudes");
  const tabPendientes = document.getElementById("tabPendientes");
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
  function setStatus(msg) { statusLine.textContent = msg || ""; }

  function escapeHtml(str) {
    return String(str ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  function asNum(v, fallback = 0) {
    const n = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(d) {
    try { return new Date(d).toLocaleString("es-AR"); } catch { return String(d || ""); }
  }

  function shortId(id) { return String(id || "").slice(0, 8); }

  function calcDiff(stockIdeal, stockActual) {
    const ide = asNum(stockIdeal, 0);
    const cur = asNum(stockActual, 0);
    return Math.max(0, ide - cur);
  }

  function statusLabel(lineStatus) {
    const map = {
      "SUBMITTED": "NUEVO",
      "NEEDS_CHECK": "CHECK",
      "NEEDS_ADJUST": "AJUSTE",
      "APPROVED": "APROBADO",
      "REJECTED": "RECHAZADO"
    };
    return map[lineStatus] || lineStatus || "—";
  }

  // =========================
  // Panel Management
  // =========================
  function closeDetails() {
    openDetailsKey = null;
    if (openDetailsRow && openDetailsRow.parentNode) {
      openDetailsRow.parentNode.removeChild(openDetailsRow);
    }
    openDetailsRow = null;
    document.querySelectorAll("tr.list-row.is-open").forEach(tr => tr.classList.remove("is-open"));
  }

  function toggleDetailsFor(lineId, anchorRow, dataRow) {
    if (openDetailsKey === lineId) {
      closeDetails();
      return;
    }
    closeDetails();
    openDetailsKey = lineId;
    anchorRow.classList.add("is-open");

    openDetailsRow = document.createElement("tr");
    openDetailsRow.className = "details-row";

    const td = document.createElement("td");
    td.colSpan = 8;

    const diff = calcDiff(dataRow.stock_ideal, dataRow.stock_actual);
    const projected = asNum(dataRow.projected_stock, 0);

    td.innerHTML = `
      <div class="details-wrap">
        <div class="details-grid">
          <div class="kv"><div class="k">Pedido</div><div class="v">#${escapeHtml(shortId(dataRow.request_id))}</div></div>
          <div class="kv"><div class="k">Creado</div><div class="v">${escapeHtml(fmtDate(dataRow.request_created_at))}</div></div>
          <div class="kv"><div class="k">Diferencia</div><div class="v">${String(diff)}</div></div>
          <div class="kv"><div class="k">Proyectado</div><div class="v">${String(projected)}</div></div>
        </div>
        <div class="details-grid">
          <div class="kv"><div class="k">Nota admin</div><div class="v">${escapeHtml(dataRow.admin_note || "—")}</div></div>
          <div class="kv"><div class="k">Sugerido</div><div class="v">${dataRow.admin_suggested_packs == null ? "—" : String(dataRow.admin_suggested_packs)}</div></div>
          <div class="kv"><div class="k">Estado</div><div class="v">${escapeHtml(statusLabel(dataRow.line_status))}</div></div>
          <div class="kv"><div class="k">SKU ID</div><div class="v">${escapeHtml(shortId(dataRow.sku_id || ""))}</div></div>
        </div>
      </div>
    `;

    openDetailsRow.appendChild(td);
    anchorRow.insertAdjacentElement("afterend", openDetailsRow);
  }

  // =========================
  // Tabs
  // =========================
  function showTab(tab) {
    document.querySelectorAll("#mainTabs .tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelector(`#mainTabs .tab-btn[data-tab="${tab}"]`)?.classList.add("active");

    if (tab === "SOLICITUDES") {
      panelSolicitudes.classList.remove("is-hidden");
      panelPendientes.classList.add("is-hidden");
      loadSolicitudes();
    } else {
      panelSolicitudes.classList.add("is-hidden");
      panelPendientes.classList.remove("is-hidden");
      loadPendientes();
    }
  }

  // =========================
  // Data: Solicitudes
  // =========================
  async function loadSolicitudes() {
    closeDetails();
    try {
      setStatus("Cargando solicitudes...");
      const { data, error } = await client
        .from("v_admin_pedido_solicitudes")
        .select("*")
        .in("line_status", ["SUBMITTED", "NEEDS_CHECK", "NEEDS_ADJUST"])
        .order("request_created_at", { ascending: false });

      if (error) throw error;
      const rows = data || [];
      
      // Sort: SUBMITTED first, then NEEDS_ADJUST, then NEEDS_CHECK
      const prio = { "SUBMITTED": 0, "NEEDS_ADJUST": 1, "NEEDS_CHECK": 2 };
      rows.sort((a, b) => {
        const ap = prio[a.line_status] ?? 9;
        const bp = prio[b.line_status] ?? 9;
        if (ap !== bp) return ap - bp;
        const ad = calcDiff(a.stock_ideal, a.stock_actual);
        const bd = calcDiff(b.stock_ideal, b.stock_actual);
        return bd - ad; // Diff high to low
      });

      tabSolicitudes.textContent = `SOLICITUDES (${rows.length})`;
      renderSolicitudes(rows);
      setStatus("");
    } catch (e) {
      console.error(e);
      setStatus("Error de carga");
      reqTbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Error al cargar.</td></tr>`;
    }
  }

  function renderSolicitudes(rows) {
    countLine.textContent = `MOSTRANDO ${rows.length}`;
    if (!rows.length) {
      reqTbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No hay solicitudes pendientes.</td></tr>`;
      return;
    }

    reqTbody.innerHTML = "";
    rows.forEach(r => {
      const tr = document.createElement("tr");
      tr.className = "list-row";
      const diff = calcDiff(r.stock_ideal, r.stock_actual);
      if (diff > 0) tr.classList.add("is-low");

      tr.onclick = (ev) => {
        if (ev.target.tagName === "BUTTON") return;
        toggleDetailsFor(r.line_id, tr, r);
      };

      const tdName = document.createElement("td");
      tdName.className = "cell-pl";
      tdName.innerHTML = `
        <div class="row-title">${escapeHtml(r.name || "-")}</div>
        <div class="row-sub-text">#${escapeHtml(shortId(r.request_id))} · ${escapeHtml(statusLabel(r.line_status))}</div>
      `;

      const tdCur = document.createElement("td");
      tdCur.className = "text-center";
      tdCur.textContent = asNum(r.stock_actual, 0);

      const tdIdeal = document.createElement("td");
      tdIdeal.className = "text-center";
      tdIdeal.textContent = asNum(r.stock_ideal, 0);

      const tdDiff = document.createElement("td");
      tdDiff.className = "text-center";
      tdDiff.innerHTML = `<span class="row-diff">${diff}</span>`;

      const tdPacks = document.createElement("td");
      tdPacks.className = "text-center";
      const packs = asNum(r.requested_packs, 0);
      const sug = r.admin_suggested_packs;
      tdPacks.innerHTML = `
        <div class="row-title" style="font-size:12px;">${packs}</div>
        <div class="row-sub-text">${sug == null ? "" : ("sug: " + sug)}</div>
      `;

      const tdCost = document.createElement("td");
      tdCost.className = "text-right";
      tdCost.textContent = fmtMoney(r.line_cost);

      const tdProj = document.createElement("td");
      tdProj.className = "text-center";
      tdProj.textContent = asNum(r.projected_stock, 0);

      const tdAct = document.createElement("td");
      tdAct.className = "text-center cell-pr";
      
      const wrap = document.createElement("div");
      wrap.className = "row-actions";

      const btnApprove = createActionBtn("Aprobar", "btn-primary", () => doLineAction(r, "APPROVE"));
      const btnCheck = createActionBtn("Check", "btn-secondary", () => doLineAction(r, "NEEDS_CHECK"));
      const btnAdjust = createActionBtn("Ajuste", "btn-secondary", () => doLineAction(r, "NEEDS_ADJUST"));
      const btnReject = createActionBtn("X", "btn-danger", () => doLineAction(r, "REJECT"));

      wrap.append(btnApprove, btnCheck, btnAdjust, btnReject);
      tdAct.appendChild(wrap);

      tr.append(tdName, tdCur, tdIdeal, tdDiff, tdPacks, tdCost, tdProj, tdAct);
      reqTbody.appendChild(tr);
    });
  }

  function createActionBtn(text, cls, fn) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `${cls} btn-xs`;
    b.textContent = text;
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  }

  async function doLineAction(row, action) {
    let note = null;
    let suggested = null;

    if (action === "REJECT" && !confirm(`¿Rechazar "${row.name}"?`)) return;
    
    if (action === "NEEDS_CHECK") {
      note = prompt("Nota para el check:", row.admin_note || "");
      if (note === null) return;
    }
    
    if (action === "NEEDS_ADJUST") {
      const raw = prompt("Packs sugeridos:", String(row.admin_suggested_packs ?? row.requested_packs ?? 0));
      if (raw === null) return;
      suggested = parseInt(raw, 10) || 0;
      note = prompt("Nota para el ajuste:", row.admin_note || "");
    }

    if (action === "APPROVE" && !confirm(`¿Aprobar "${row.name}" (${row.requested_packs} packs)?`)) return;

    try {
      setStatus("Sincronizando...");
      const { error } = await client.rpc("admin_purchase_line_action", {
        p_line_id: row.line_id,
        p_action: action,
        p_note: note,
        p_suggested_packs: suggested
      });
      if (error) throw error;
      await loadSolicitudes();
    } catch (e) {
      console.error(e);
      alert("Error al procesar acción: " + (e.message || e));
    } finally { setStatus(""); }
  }

  // =========================
  // Data: Pendientes
  // =========================
  async function loadPendientes() {
    closeDetails();
    try {
      setStatus("Cargando pendientes...");
      const { data: reqs, error } = await client
        .from("inventory_purchase_requests")
        .select("id,status,created_at")
        .in("status", ["APPROVED", "PARTIAL_ACTION", "SUBMITTED"])
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      const ids = (reqs || []).map(r => r.id);
      let receipts = new Map();
      if (ids.length) {
        const { data: recs } = await client
          .from("inventory_purchase_receipts")
          .select("request_id,status")
          .in("request_id", ids);
        (recs || []).forEach(x => receipts.set(x.request_id, x.status));
      }

      // Fetch total cost per request
      let costs = new Map();
      if (ids.length) {
        const { data: costData } = await client
          .from("inventory_purchase_request_lines")
          .select("request_id,line_cost")
          .in("request_id", ids);
        
        (costData || []).forEach(l => {
          const c = asNum(l.line_cost, 0);
          costs.set(l.request_id, (costs.get(l.request_id) || 0) + c);
        });
      }

      tabPendientes.textContent = `PENDIENTES (${(reqs || []).length})`;
      countLine.textContent = `MOSTRANDO ${(reqs || []).length}`;
      renderPendientes(reqs || [], receipts, costs);
      setStatus("");
    } catch (e) {
      console.error(e);
      setStatus("Error en pendientes");
    }
  }

  function renderPendientes(reqs, receipts, costs) {
    if (!reqs.length) {
      pendTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No hay pedidos pendientes de recepción.</td></tr>`;
      return;
    }
    pendTbody.innerHTML = reqs.map(r => {
      const rs = receipts.get(r.id);
      const host = costs.get(r.id) || 0;
      const rep = rs === "SUBMITTED" ? "RECEPCIÓN ENVIADA" : (rs === "DRAFT" ? "RECEPCIÓN EN CURSO" : "ESPERANDO RECEPCIÓN");
      return `
        <tr class="list-row">
          <td class="cell-pl">
            <div class="row-title">#${escapeHtml(shortId(r.id))}</div>
            <div class="row-sub-text">${escapeHtml(fmtDate(r.created_at))}</div>
          </td>
          <td class="text-center"><span class="tag tag-gray">${r.status}</span></td>
          <td class="text-center">${rep}</td>
          <td class="text-right">${fmtMoney(host)}</td>
          <td class="text-center cell-pr">${escapeHtml(fmtDate(r.created_at))}</td>
        </tr>
      `;
    }).join("");
  }

  // =========================
  // Init
  // =========================
  if (btnBack) btnBack.onclick = () => window.location.href = "admin-stock-index.html";
  
  document.querySelectorAll("#mainTabs .tab-btn").forEach(btn => {
    btn.onclick = (e) => showTab(e.currentTarget.dataset.tab);
  });

  (async function init() {
    try {
      await requireAdmin();
      showTab("SOLICITUDES");
    } catch (e) {
      console.error(e);
      window.location.replace("../auth/login.html");
    }
  })();

})();
