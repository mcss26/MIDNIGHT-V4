/* /js/pages/admin-movimientos.js */

(function() {
  const client = window.supabaseClient;

  // =========================
  // State
  // =========================
  let currentStatus = "PENDING";
  let movesAll = [];
  let openId = null;
  let openRow = null;

  // =========================
  // UI Refs
  // =========================
  const tbody = document.querySelector("#movTable tbody");
  const statusEl = document.getElementById("statusLine");
  const countEl = document.getElementById("countLine");
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

  function statusTagClass(st) {
    const map = {
      "PENDING": "tag tag-yellow",
      "APPROVED": "tag tag-green",
      "REJECTED": "tag tag-red",
      "CANCELLED": "tag tag-gray"
    };
    return map[st] || "tag";
  }

  function fmtDateTime(ts) {
    if (!ts) return "—";
    try {
      return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(ts));
    } catch { return "—"; }
  }

  function shortId(id) { return String(id || "").slice(0, 8); }

  // =========================
  // Panel Management
  // =========================
  function closeDetails() {
    openId = null;
    if (openRow && openRow.parentNode) openRow.parentNode.removeChild(openRow);
    openRow = null;
    document.querySelectorAll("tr.list-row.is-open").forEach(tr => tr.classList.remove("is-open"));
  }

  function toggleDetailsFor(movementId, anchorRow, rowData) {
    if (openId === movementId) { closeDetails(); return; }
    closeDetails();

    openId = movementId;
    anchorRow.classList.add("is-open");

    const sys = asNum(rowData.stock_actual_sistema, 0);
    const obs = asNum(rowData.observed_stock, 0);
    const adj = asNum(rowData.ajustar, 0);
    const tgt = asNum(rowData.target_stock, 0);
    const delta = tgt - sys;

    openRow = document.createElement("tr");
    openRow.className = "details-row";

    const td = document.createElement("td");
    td.colSpan = 8;

    td.innerHTML = `
      <div class="details-wrap">
        <div class="details-grid">
          <div class="kv"><div class="k">Movimiento</div><div class="v">#${escapeHtml(shortId(rowData.movement_id))}</div></div>
          <div class="kv"><div class="k">Creado</div><div class="v">${escapeHtml(fmtDateTime(rowData.created_at))}</div></div>
          <div class="kv"><div class="k">Estado</div><div class="v">${escapeHtml(rowData.status || "—")}</div></div>
          <div class="kv"><div class="k">SKU ID</div><div class="v">${escapeHtml(shortId(rowData.sku_id || ""))}</div></div>
        </div>

        <div class="details-grid">
          <div class="kv"><div class="k">Stock sistema</div><div class="v">${sys}</div></div>
          <div class="kv"><div class="k">Observado</div><div class="v">${obs}</div></div>
          <div class="kv"><div class="k">Ajustar</div><div class="v">${adj}</div></div>
          <div class="kv"><div class="k">Target Final</div><div class="v">${tgt} <span class="delta ${delta >= 0 ? 'is-pos' : 'is-neg'}">(${delta >= 0 ? '+' : ''}${delta})</span></div></div>
        </div>
      </div>
    `;

    openRow.appendChild(td);
    anchorRow.insertAdjacentElement("afterend", openRow);
  }

  // =========================
  // Actions
  // =========================
  async function approveMovement(movementId, approve) {
    const { error } = await client.rpc("approve_inventory_movement", {
      p_movement_id: movementId,
      p_approve: !!approve
    });
    if (error) throw error;
  }

  // =========================
  // Rendering
  // =========================
  async function loadMovimientos() {
    closeDetails();
    setStatus("Cargando movimientos...");

    try {
      let q = client
        .from("v_admin_movimientos")
        .select("*");

      if (currentStatus !== "ALL") {
        q = q.eq("status", currentStatus);
      }

      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) throw error;

      movesAll = data || [];
      setStatus("");
      render();
    } catch (e) {
      console.error(e);
      setStatus("Error de sincronización", true);
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Error al cargar datos.</td></tr>`;
    }
  }

  function render() {
    countEl.textContent = `MOSTRANDO ${movesAll.length}`;
    if (!movesAll.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No se encontraron movimientos.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    movesAll.forEach(m => {
      const tr = document.createElement("tr");
      tr.className = "list-row";
      
      const sys = asNum(m.stock_actual_sistema, 0);
      const tgt = asNum(m.target_stock, 0);
      const delta = tgt - sys;

      tr.onclick = (ev) => {
        if (ev.target.tagName === "BUTTON") return;
        toggleDetailsFor(m.movement_id, tr, m);
      };

      const tdItem = document.createElement("td");
      tdItem.className = "cell-pl";
      tdItem.innerHTML = `
        <div class="row-title">${escapeHtml(m.name || "Sin nombre")}</div>
        <div class="row-sub-text">COD: ${escapeHtml(m.external_id || "-")} · #${escapeHtml(shortId(m.movement_id))}</div>
      `;

      tr.appendChild(tdItem);
      tr.innerHTML += `
        <td class="text-center"><span class="row-sub-text">${sys}</span></td>
        <td class="text-center"><span class="row-sub-text">${asNum(m.observed_stock,0)}</span></td>
        <td class="text-center"><span class="row-sub-text">${asNum(m.ajustar,0)}</span></td>
        <td class="text-center"><span class="row-sub-text">${tgt}</span></td>
        <td class="text-center"><span class="delta ${delta === 0 ? 'is-zero' : (delta > 0 ? 'is-pos' : 'is-neg')}">${delta > 0 ? '+' : ''}${delta}</span></td>
        <td class="text-center"><span class="${statusTagClass(m.status)}">${m.status}</span></td>
      `;

      const tdAct = document.createElement("td");
      tdAct.className = "text-center cell-pr";
      
      if (m.status === "PENDING") {
        const wrap = document.createElement("div");
        wrap.className = "row-actions";

        const btnOk = createActionBtn("Aprobar", "btn-primary", () => runAction(m, true));
        const btnNo = createActionBtn("X", "btn-danger", () => runAction(m, false));

        wrap.append(btnOk, btnNo);
        tdAct.appendChild(wrap);
      } else {
        tdAct.innerHTML = `<span class="row-sub-text">—</span>`;
      }

      tr.appendChild(tdAct);
      tbody.appendChild(tr);
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

  async function runAction(m, approve) {
    const actionText = approve ? "Aprobar" : "Rechazar";
    const msg = approve 
      ? `¿Aprobar ajuste para "${m.name}"?\nStock: ${m.stock_actual_sistema} → ${m.target_stock}`
      : `¿Rechazar ajuste para "${m.name}"?`;

    if (!confirm(msg)) return;

    try {
      setStatus(`${actionText}ando...`);
      await approveMovement(m.movement_id, approve);
      await loadMovimientos();
    } catch (e) {
      console.error(e);
      alert("Error: " + (e.message || e));
    } finally { setStatus(""); }
  }

  // =========================
  // Listeners
  // =========================
  function attachStatusTabs() {
    document.querySelectorAll("#statusTabs .tab-btn").forEach(btn => {
      btn.onclick = async (e) => {
        document.querySelectorAll("#statusTabs .tab-btn").forEach(b => b.classList.remove("active"));
        e.currentTarget.classList.add("active");
        currentStatus = e.currentTarget.dataset.st || "PENDING";
        await loadMovimientos();
      };
    });
  }

  if (btnBack) btnBack.onclick = () => window.location.href = "admin-stock-index.html";

  // =========================
  // Boot
  // =========================
  (async function init() {
    try {
      await requireAdmin();
      attachStatusTabs();
      await loadMovimientos();
    } catch (e) {
      console.error(e);
      window.location.replace("../auth/login.html");
    }
  })();

})();
