/* /js/pages/operativo-stock-pedido.js */

(function() {
    const client = window.supabaseClient;
    
    // =========================
    // Auth
    // =========================
    document.getElementById("btnBack").addEventListener("click", () => {
      window.location.href = "operativo-index.html";
    });

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

      if (profErr || !prof?.role || !["OPERATIVO","STAFF","ADMIN"].includes(prof.role.toUpperCase())) {
        try { await client.auth.signOut(); } catch {}
        window.location.replace("../auth/login.html");
        return null;
      }

      return session;
    }

    // =========================
    // State
    // =========================
    const statusEl = document.getElementById("statusLine");
    const solicitarTbody = document.querySelector("#solicitarTable tbody");
    const confirmarTbody = document.querySelector("#confirmarTable tbody");
    const pendientesTbody = document.querySelector("#pendientesTable tbody");
    const btnConfirmAll = document.getElementById("btnConfirmAll");

    const panels = {
      SOLICITAR: document.getElementById("panelSolicitar"),
      CONFIRMAR: document.getElementById("panelConfirmar"),
      PENDIENTES: document.getElementById("panelPendientes")
    };

    let sessionRef = null;
    let currentTab = "SOLICITAR";

    let items = []; // { id,name,external_id,pack_size,stock_actual,stock_ideal }

    // Draft: sku_id -> packs
    let draft = new Map();

    function setStatus(msg) { statusEl.textContent = msg || ""; }

    function escapeHtml(str) {
      return String(str ?? "")
        .replaceAll("&","&amp;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;")
        .replaceAll('"',"&quot;")
        .replaceAll("'","&#039;");
    }

    function asNum(v, fallback = 0) {
      const n = Number(String(v ?? "").replace(",", "."));
      return Number.isFinite(n) ? n : fallback;
    }

    function fmtDate(iso) {
      try { return new Date(iso).toLocaleString("es-AR"); } catch { return String(iso || ""); }
    }

    function getPackSize(x) {
      const ps = parseInt(x?.pack_size, 10);
      return Number.isFinite(ps) && ps >= 1 ? ps : 1;
    }

    function calcMissingUnits(x) {
      const ideal = asNum(x.stock_ideal, 0);
      const actual = asNum(x.stock_actual, 0);
      return Math.max(0, ideal - actual);
    }

    function calcPriorityKey(x) {
      const ideal = asNum(x.stock_ideal, 0);
      const actual = asNum(x.stock_actual, 0);

      const eps = 0.000001;
      if (ideal <= eps) return 3;               // sin ideal al final
      if (actual + eps < ideal) return 0;       // debajo
      if (Math.abs(actual - ideal) <= eps) return 1; // igual
      return 2;                                 // arriba
    }

    function sortByPriority(a, b) {
      const ga = calcPriorityKey(a);
      const gb = calcPriorityKey(b);
      if (ga !== gb) return ga - gb;

      // prioridad: "debajo del ideal" primero, más crítico primero
      if (ga === 0) {
        const da = asNum(a.stock_actual, 0) - asNum(a.stock_ideal, 0); // negativo
        const db = asNum(b.stock_actual, 0) - asNum(b.stock_ideal, 0);
        if (da !== db) return da - db; // más negativo primero
      }

      return String(a.name || "").localeCompare(String(b.name || ""), "es");
    }

    // =========================
    // Local draft storage
    // =========================
    function draftKey() {
      const uid = sessionRef?.user?.id || "anon";
      return `midnight_op_stock_pedido_draft_v1:${uid}`;
    }

    function loadDraft() {
      try {
        const raw = localStorage.getItem(draftKey());
        if (!raw) return;
        const obj = JSON.parse(raw);
        const m = new Map();
        Object.keys(obj || {}).forEach(skuId => {
          const packs = parseInt(obj[skuId], 10);
          if (Number.isFinite(packs) && packs > 0) m.set(skuId, packs);
        });
        draft = m;
      } catch {}
    }

    function saveDraft() {
      try {
        const obj = {};
        draft.forEach((packs, skuId) => { obj[skuId] = packs; });
        localStorage.setItem(draftKey(), JSON.stringify(obj));
      } catch {}
    }

    // =========================
    // Tabs
    // =========================
    function showTab(tab) {
      currentTab = tab;

      document.querySelectorAll("#mainTabs .tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelector(`#mainTabs .tab-btn[data-tab="${tab}"]`)?.classList.add("active");

      Object.keys(panels).forEach(k => {
        panels[k].style.display = (k === tab) ? "" : "none";
      });

      if (tab === "SOLICITAR") renderSolicitar();
      if (tab === "CONFIRMAR") renderConfirmar();
      if (tab === "PENDIENTES") loadPendientes();
    }

    // =========================
    // Load data for solicitar
    // =========================
    async function loadItems() {
      try {
        setStatus("Cargando stock...");

      const { data: skus, error: skErr } = await client
        .from("inventory_sku")
        .select("id,name:nombre,external_id:sku,pack_size,is_active,stock_ideal,pack_cost")
        .eq("is_active", true)
        .order("nombre", { ascending: true });

      if (skErr) throw skErr;

      const ids = (skus || []).map(s => s.id);

      // Fetch only current stock (ideal is now in SKU table)
      const { data: resCur, error: curErr } = await client
        .from("inventory_stock_current")
        .select("sku_id,stock_actual")
        .in("sku_id", ids);
        
      if (curErr) console.warn("Error fetching current stock", curErr);

      const curBy = new Map();
      (resCur || []).forEach(r => curBy.set(r.sku_id, asNum(r.stock_actual, 0)));

      items = (skus || []).map(s => ({
        id: s.id,
        name: s.name,                 // aliased from nombre
        external_id: s.external_id,   // aliased from sku
        pack_size: s.pack_size,
        pack_cost: asNum(s.pack_cost, 0),
        stock_actual: curBy.get(s.id) ?? 0,
        stock_ideal: asNum(s.stock_ideal, 0)
      })).sort(sortByPriority);

      setStatus("");
      renderSolicitar();
      renderConfirmar();
    } catch (e) {
      console.error(e);
      setStatus("Error: " + (e.message || e));
      solicitarTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Error al cargar stock: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  // =========================
  // Render: SOLICITAR
  // =========================
    function statusTagFor(x) {
      const ideal = asNum(x.stock_ideal, 0);
      const actual = asNum(x.stock_actual, 0);
      const eps = 0.000001;

      if (ideal <= eps) return `<span class="tag tag-yellow">SIN IDEAL</span>`;
      if (actual + eps < ideal) return `<span class="tag tag-red">BAJO</span>`;
      if (Math.abs(actual - ideal) <= eps) return `<span class="tag tag-green">OK</span>`;
      return `<span class="tag tag-yellow">ALTO</span>`;
    }

    function renderSolicitar() {
      if (!items.length) {
        solicitarTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No hay items.</td></tr>`;
        return;
      }

      solicitarTbody.innerHTML = "";

      items.forEach(x => {
        const tr = document.createElement("tr");
        tr.className = "list-row";

        const tdName = document.createElement("td");
        tdName.className = "cell-pl";
        tdName.innerHTML = `
          <div class="row-title">${escapeHtml(x.name || "-")}</div>
          <div class="row-sub-text">${statusTagFor(x)} COD: ${escapeHtml(x.external_id || "-")}</div>
        `;

        const tdAct = document.createElement("td");
        tdAct.className = "text-center";
        tdAct.innerHTML = `<span class="row-sub-text">${escapeHtml(String(asNum(x.stock_actual, 0)))}</span>`;

        const tdIdeal = document.createElement("td");
        tdIdeal.className = "text-center";
        tdIdeal.innerHTML = `<span class="row-sub-text">${escapeHtml(String(asNum(x.stock_ideal, 0)))}</span>`;

        const tdBtn = document.createElement("td");
        tdBtn.className = "text-center cell-pr";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-primary";
        btn.textContent = "Solicitar";

        const missing = calcMissingUnits(x);
        if (missing <= 0) {
          btn.className = "btn-secondary";
          btn.textContent = "OK";
          btn.disabled = true;
        }

        btn.addEventListener("click", () => {
          const packSize = getPackSize(x);
          const miss = calcMissingUnits(x);
          const packs = Math.ceil(miss / packSize);

          if (packs <= 0) return;

          const prev = draft.get(x.id) || 0;
          draft.set(x.id, Math.max(prev, packs));
          saveDraft();
          // User feedback
          btn.textContent = "Agregado";
          setTimeout(() => btn.textContent = "Solicitar", 1000);
        });

        tdBtn.appendChild(btn);

        tr.append(tdName, tdAct, tdIdeal, tdBtn);
        solicitarTbody.appendChild(tr);
      });
    }

    // =========================
    // Render: CONFIRMAR
    // =========================
    function getDraftLines() {
      const map = new Map(items.map(x => [x.id, x]));
      const out = [];
      draft.forEach((packs, skuId) => {
        const item = map.get(skuId);
        if (!item) return;
        out.push({ item, packs: parseInt(packs, 10) || 0 });
      });
      return out.filter(x => x.packs > 0);
    }

    function renderConfirmar() {
      const lines = getDraftLines();

      if (!lines.length) {
        confirmarTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay nada para confirmar.</td></tr>`;
        btnConfirmAll.disabled = true;
        return;
      }

      btnConfirmAll.disabled = false;
      confirmarTbody.innerHTML = "";

      lines.forEach(({ item, packs }) => {
        const tr = document.createElement("tr");
        tr.className = "list-row";

        const packSize = getPackSize(item);
        const units = packs * packSize;
        const stockActual = asNum(item.stock_actual, 0);
        const stockTotal = stockActual + units;

        const tdName = document.createElement("td");
        tdName.className = "cell-pl";
        tdName.innerHTML = `
          <div class="row-title">${escapeHtml(item.name || "-")}</div>
          <div class="row-sub-text">PACK: ${escapeHtml(String(packSize))} u — COD: ${escapeHtml(item.external_id || "-")}</div>
        `;

        const tdPacks = document.createElement("td");
        tdPacks.className = "text-center";
        const inPacks = document.createElement("input");
        inPacks.type = "number";
        inPacks.min = "0";
        inPacks.step = "1";
        inPacks.className = "table-input table-input--narrow";
        inPacks.value = String(packs);
        tdPacks.appendChild(inPacks);

        const tdUnits = document.createElement("td");
        tdUnits.className = "text-center";
        tdUnits.innerHTML = `<span class="row-sub-text">${escapeHtml(String(units))}</span>`;

        const tdAct = document.createElement("td");
        tdAct.className = "text-center";
        tdAct.innerHTML = `<span class="row-sub-text">${escapeHtml(String(stockActual))}</span>`;

        const tdTotal = document.createElement("td");
        tdTotal.className = "text-center";
        tdTotal.innerHTML = `<span class="row-sub-text">${escapeHtml(String(stockTotal))}</span>`;

        const tdRemove = document.createElement("td");
        tdRemove.className = "text-center cell-pr";
        const btnRemove = document.createElement("button");
        btnRemove.type = "button";
        btnRemove.className = "btn-danger";
        btnRemove.textContent = "Quitar";
        tdRemove.appendChild(btnRemove);

        inPacks.addEventListener("change", () => {
          const n = Math.max(0, parseInt(inPacks.value, 10) || 0);
          if (n <= 0) draft.delete(item.id);
          else draft.set(item.id, n);
          saveDraft();
          renderConfirmar();
        });

        btnRemove.addEventListener("click", () => {
          draft.delete(item.id);
          saveDraft();
          renderConfirmar();
        });

        tr.append(tdName, tdPacks, tdUnits, tdAct, tdTotal, tdRemove);
        confirmarTbody.appendChild(tr);
      });
    }

    // =========================
    // Confirmar -> enviar a Admin
    // Using inventory_purchase_requests / lines
    // =========================
    async function submitPedidoToAdmin() {
      const lines = getDraftLines();
      if (!lines.length) return;

      try {
        btnConfirmAll.disabled = true;
        setStatus("Enviando pedido...");

        // 1) crear request
        const { data: req, error: reqErr } = await client
          .from("inventory_purchase_requests")
          .insert({
            created_by: sessionRef.user.id,
            status: "SUBMITTED"
            // Note: inventory_purchase_requests usually has 'requested_by'
          })
          .select("id")
          .single();

        if (reqErr) throw reqErr;

        // 2) crear líneas
        const payloadLines = lines.map(({ item, packs }) => {
          const packCost = asNum(item.pack_cost, 0);
          return {
            request_id: req.id,
            sku_id: item.id,
            requested_packs: packs,
            line_cost: packs * packCost,
            status: "SUBMITTED"
          };
        });

        const { error: lErr } = await client.from("inventory_purchase_request_lines").insert(payloadLines);
        if (lErr) throw lErr;

        // limpiar draft
        draft.clear();
        saveDraft();
        renderConfirmar();

        setStatus("Pedido enviado.");
        showTab("PENDIENTES");
      } catch (e) {
        console.error(e);
        setStatus("Error al enviar: " + e.message);
        btnConfirmAll.disabled = false;
      }
    }

    btnConfirmAll.addEventListener("click", submitPedidoToAdmin);

    // =========================
    // Pendientes
    // =========================
    async function loadPendientes() {
      try {
        pendientesTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Cargando...</td></tr>`;
        setStatus("");

        const { data: reqs, error: rErr } = await client
          .from("inventory_purchase_requests")
          .select("id,status,created_at")
          .eq("created_by", sessionRef.user.id)
          .order("created_at", { ascending: false });

        if (rErr) throw rErr;

        if (!reqs?.length) {
          pendientesTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No hay pedidos.</td></tr>`;
          return;
        }

        // contar items por request
        const ids = reqs.map(r => r.id);
        const { data: lines, error: lErr } = await client
          .from("inventory_purchase_request_lines")
          .select("request_id")
          .in("request_id", ids);

        const countBy = new Map();
        (lines || []).forEach(l => countBy.set(l.request_id, (countBy.get(l.request_id) || 0) + 1));

        pendientesTbody.innerHTML = "";
        reqs.forEach(r => {
          const tr = document.createElement("tr");
          tr.className = "list-row";

          const estado = String(r.status || "—");
          let tag = `<span class="tag tag-yellow">${escapeHtml(estado)}</span>`;
          if (estado === "APPROVED") tag = `<span class="tag tag-green">APROBADO</span>`;
          if (estado === "REJECTED") tag = `<span class="tag tag-red">RECHAZADO</span>`;

          tr.innerHTML = `
            <td class="cell-pl">
              <div class="row-title">${escapeHtml(fmtDate(r.created_at))}</div>
              <div class="row-sub-text">ID: ${escapeHtml(r.id.slice(0,8))}</div>
            </td>
            <td class="text-center">${escapeHtml(String(countBy.get(r.id) || 0))}</td>
            <td class="text-center">${tag}</td>
            <td class="text-center cell-pr"></td>
          `;
          
          // Detalle logic could go here if needed, simplified for now
          // const td = tr.querySelector("td.cell-pr"); ...
          
          pendientesTbody.appendChild(tr);
        });
      } catch (e) {
        console.error(e);
        pendientesTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Error cargando historico: ${escapeHtml(e.message)}</td></tr>`;
      }
    }

    // =========================
    // Boot
    // =========================
    function attachTabs() {
      document.querySelectorAll("#mainTabs .tab-btn").forEach(btn => {
        btn.addEventListener("click", (e) => showTab(e.currentTarget.dataset.tab));
      });
    }

    (async function init() {
      try {
        sessionRef = await requireOperativo();
        if (!sessionRef) return;

        attachTabs();
        loadDraft();
        await loadItems();
        showTab("SOLICITAR");
      } catch (e) {
        console.error(e);
        // requireOperativo handles redirects
      }
    })();
})();
