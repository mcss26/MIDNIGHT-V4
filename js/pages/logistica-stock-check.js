/* /js/pages/logistica-stock-check.js */

(function() {
  const client = window.supabaseClient;

  // =========================
  // State
  // =========================
  const KNOWN_CATEGORIES = ["BEBIDAS","INSUMOS BARRA","LIMPIEZA","LIBRERIA","MANTENIMIENTO"];
  let currentCategory = "ALL";

  const tbody = document.querySelector("#opTable tbody");
  const statusEl = document.getElementById("statusLine");
  const btnBack = document.getElementById("btnBack");

  let sessionRef = null;

  let requestsAll = []; // { request_id, sku_id, status, created_at, sku }
  let stockSystemBySku = new Map(); // sku_id -> stock_actual (teórico)

  let draftRunByRequest = new Map(); // request_id -> run_id (draft del usuario)
  let lineByKey = new Map(); // `${run_id}:${sku_id}` -> { line_id, stock_actual, is_checked }

  // =========================
  // Auth Check
  // =========================
  async function requireOperativo() {
    if (!client) {
      window.location.replace("../auth/login.html");
      return null;
    }

    const { data: sessData } = await client.auth.getSession();
    const session = sessData?.session;

    if (!session?.user?.id) {
      window.location.replace("../auth/login.html");
      return null;
    }

    const { data: prof, error: profErr } = await client
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    // Allow Logistica, Operativo, Staff, Admin
    if (profErr || !prof?.role || !["LOGISTICA", "OPERATIVO","STAFF","ADMIN"].includes(prof.role.toUpperCase())) {
      try { await client.auth.signOut(); } catch {}
      window.location.replace("../auth/login.html");
      return null;
    }

    return session;
  }

  // =========================
  // Helpers
  // =========================
  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function categoryMatches(cat, rowCat) {
    const c = (rowCat || "").trim();
    if (cat === "ALL") return true;
    if (cat === "OTROS") return !KNOWN_CATEGORIES.includes(c);
    return c === cat;
  }

  function getFiltered() {
    return requestsAll.filter(x => categoryMatches(currentCategory, (x.sku || {}).category));
  }

  // =========================
  // Data load
  // =========================
  async function loadRequests() {
    setStatus("Cargando solicitudes...");

    // Using alias if needed, or straight select. Assuming schema matches provided draft.
    const { data, error } = await client
      .from("inventory_check_requests")
      .select("id,sku_id,status,created_at, inventory_sku:sku_id (id,name:nombre,external_id:sku,category:categoria,is_active)")
      .in("status", ["OPEN","IN_PROGRESS"])
      .order("created_at", { ascending: true });

    if (error) {
       console.error(error);
       setStatus("Error cargando: " + error.message);
       return;
    }

    requestsAll = (data || []).map(r => ({
      request_id: r.id,
      sku_id: r.sku_id,
      status: r.status,
      created_at: r.created_at,
      sku: r.inventory_sku
    }));

    const skuIds = [...new Set(requestsAll.map(r => r.sku_id))];

    stockSystemBySku.clear();
    if (skuIds.length) {
      const { data: cur, error: curErr } = await client
        .from("inventory_stock_current")
        .select("sku_id,stock_actual")
        .in("sku_id", skuIds);

      if (!curErr) (cur || []).forEach(r => stockSystemBySku.set(r.sku_id, Number(r.stock_actual) || 0));
    }

    draftRunByRequest.clear();
    lineByKey.clear();

    if (requestsAll.length) {
      const reqIds = requestsAll.map(r => r.request_id);

      // We need to look for runs started by THIS user in status DRAFT
      const { data: runs, error: runsErr } = await client
        .from("inventory_check_runs")
        .select("id,request_id,started_by,status")
        .eq("started_by", sessionRef.user.id)
        .eq("status", "DRAFT")
        .in("request_id", reqIds);

      if (!runsErr) (runs || []).forEach(r => draftRunByRequest.set(r.request_id, r.id));

      const runIds = [...new Set([...draftRunByRequest.values()])];
      if (runIds.length) {
        const { data: lines, error: linesErr } = await client
          .from("inventory_check_lines")
          .select("id,run_id,sku_id,stock_actual,is_checked")
          .in("run_id", runIds);

        if (!linesErr) {
          (lines || []).forEach(l => {
            lineByKey.set(`${l.run_id}:${l.sku_id}`, {
              line_id: l.id,
              stock_actual: Number(l.stock_actual) || 0,
              is_checked: !!l.is_checked
            });
          });
        }
      }
    }

    setStatus("");
    render();
  }

  async function ensureDraftRun(requestId) {
    const existing = draftRunByRequest.get(requestId);
    if (existing) return existing;

    const { data, error } = await client
      .from("inventory_check_runs")
      .insert({ request_id: requestId, started_by: sessionRef.user.id, status: "DRAFT" })
      .select("id")
      .single();

    if (error) throw error;

    draftRunByRequest.set(requestId, data.id);
    return data.id;
  }

  async function saveLine(runId, skuId, patch) {
    const key = `${runId}:${skuId}`;
    const cur = lineByKey.get(key);

    if (cur?.line_id) {
      const { data, error } = await client
        .from("inventory_check_lines")
        .update(patch)
        .eq("id", cur.line_id)
        .select("id,run_id,sku_id,stock_actual,is_checked")
        .single();

      if (error) throw error;

      lineByKey.set(key, {
        line_id: data.id,
        stock_actual: Number(data.stock_actual) || 0,
        is_checked: !!data.is_checked
      });

      return data;
    } else {
      const payload = Object.assign({ run_id: runId, sku_id: skuId }, patch);
      const { data, error } = await client
        .from("inventory_check_lines")
        .insert(payload)
        .select("id,run_id,sku_id,stock_actual,is_checked")
        .single();

      if (error) throw error;

      lineByKey.set(key, {
        line_id: data.id,
        stock_actual: Number(data.stock_actual) || 0,
        is_checked: !!data.is_checked
      });

      return data;
    }
  }

  async function submitRun(runId) {
    // Assuming this RPC exists as per user request
    const { error } = await client.rpc("submit_inventory_check_run", { p_run_id: runId });
    if (error) throw error;
  }

  // =========================
  // Render
  // =========================
  function render() {
    const rows = getFiltered();

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No hay solicitudes abiertas.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";

    rows.forEach(r => {
      const sku = r.sku || {};
      const stockTeorico = Number(stockSystemBySku.get(r.sku_id) ?? 0) || 0;

      const runId = draftRunByRequest.get(r.request_id);
      const line = runId ? lineByKey.get(`${runId}:${r.sku_id}`) : null;

      const tr = document.createElement("tr");
      tr.className = "list-row";

      const tdName = document.createElement("td");
      tdName.className = "cell-pl";
      tdName.innerHTML = `
        <div class="row-title">${escapeHtml(sku.name || "-")}</div>
        <div class="row-sub-text">COD: ${escapeHtml(sku.external_id || "-")}</div>
      `;

      const tdTheo = document.createElement("td");
      tdTheo.className = "text-center";
      tdTheo.innerHTML = `<span class="row-sub-text">${escapeHtml(String(stockTeorico))}</span>`;

      const tdReal = document.createElement("td");
      tdReal.className = "text-center";
      const inReal = document.createElement("input");
      inReal.type = "number";
      inReal.min = "0";
      inReal.step = "0.01";
      inReal.className = "table-input table-input--narrow";
      inReal.value = String(line ? line.stock_actual : stockTeorico);
      tdReal.appendChild(inReal);

      const tdChk = document.createElement("td");
      tdChk.className = "text-center";
      const lbl = document.createElement("label");
      lbl.className = "toolbar-check";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = !!(line && line.is_checked);
      lbl.appendChild(chk);
      tdChk.appendChild(lbl);

      const tdSend = document.createElement("td");
      tdSend.className = "text-center cell-pr";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-primary";
      btn.textContent = "Enviar";
      tdSend.appendChild(btn);

      btn.addEventListener("click", async () => {
        try {
          btn.disabled = true;

          const run = await ensureDraftRun(r.request_id);
          const n = Math.max(0, Number(String(inReal.value || "0").replace(",", ".")) || 0);

          await saveLine(run, r.sku_id, { stock_actual: n, is_checked: !!chk.checked });

          const cur = lineByKey.get(`${run}:${r.sku_id}`);
          if (!cur?.is_checked) {
            setStatus("Marcá CHECK antes de enviar.");
            btn.disabled = false;
            return;
          }

          setStatus("Enviando...");
          await submitRun(run);

          setStatus("Enviado.");
          await loadRequests();
        } catch (e) {
          console.error(e);
          setStatus("Error al enviar: " + (e.message || e));
          btn.disabled = false;
        }
      });

      inReal.addEventListener("change", async () => {
        try {
          inReal.disabled = true;
          setStatus("Guardando...");
          const run = await ensureDraftRun(r.request_id);
          const n = Math.max(0, Number(String(inReal.value || "0").replace(",", ".")) || 0);
          await saveLine(run, r.sku_id, { stock_actual: n });
          setStatus("");
        } catch (e) {
          console.error(e);
          setStatus("Error al guardar stock real.");
        } finally {
          inReal.disabled = false;
        }
      });

      chk.addEventListener("change", async () => {
        try {
          chk.disabled = true;
          setStatus("Guardando...");
          const run = await ensureDraftRun(r.request_id);
          await saveLine(run, r.sku_id, { is_checked: !!chk.checked });
          setStatus("");
        } catch (e) {
          console.error(e);
          setStatus("Error al guardar check.");
        } finally {
          chk.disabled = false;
        }
      });

      tr.append(tdName, tdTheo, tdReal, tdChk, tdSend);
      tbody.appendChild(tr);
    });
  }

  function attachTabs() {
    document.querySelectorAll("#categoryTabs .tab-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        document.querySelectorAll("#categoryTabs .tab-btn").forEach(b => b.classList.remove("active"));
        e.currentTarget.classList.add("active");
        currentCategory = e.currentTarget.dataset.cat || "ALL";
        render();
      });
    });
  }

  if (btnBack) {
    btnBack.onclick = () => window.location.href = "logistica-index.html";
  }

  (async function init() {
    try {
      sessionRef = await requireOperativo();
      if (!sessionRef) return;

      attachTabs();
      await loadRequests();
    } catch (e) {
      console.error(e);
      // In case of error (e.g. auth), we might need to redirect, but usually requireOperativo does it.
    }
  })();

})();
