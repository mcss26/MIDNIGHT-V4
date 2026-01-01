/* /js/pages/admin-pagos.js */

(function() {
  const client = window.supabaseClient;

  // =========================
  // Role Guard
  // =========================
  async function requireAdmin() {
    if (!client) { window.location.replace("../auth/login.html"); return null; }

    const { data: sessData } = await client.auth.getSession();
    const session = sessData?.session;
    if (!session?.user?.id) { window.location.replace("../auth/login.html"); return null; }

    const { data: prof, error: profErr } = await client
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (profErr || !["ADMIN"].includes(prof?.role?.toUpperCase())) {
      try { await client.auth.signOut(); } catch {}
      window.location.replace("../auth/login.html");
      return null;
    }
    return session;
  }

  // =========================
  // UI Helpers
  // =========================
  const statusLine = document.getElementById("statusLine");
  function setStatus(msg, bad = false) {
    if (!statusLine) return;
    statusLine.textContent = msg || "";
    statusLine.classList.toggle("is-bad", !!bad);
  }

  function hide(el) { if (el) el.classList.add("is-hidden"); }
  function show(el) { if (el) el.classList.remove("is-hidden"); }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function ymd(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseYmdLocal(ymdStr) {
    if (!ymdStr) return null;
    const m = String(ymdStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    return new Date(y, mo - 1, d);
  }

  function isOverdueYmd(dueYmd) {
    const due = parseYmdLocal(dueYmd);
    if (!due) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due.getTime() < today.getTime();
  }

  function isoWeekKey(dateObj) {
    const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    const year = d.getUTCFullYear();
    return `${year}-W${String(weekNo).padStart(2, "0")}`;
  }

  function openModal(el) {
    if (!el) return;
    el.style.display = "flex";
    el.setAttribute("aria-hidden", "false");
  }
  function closeModal(el) {
    if (!el) return;
    el.style.display = "none";
    el.setAttribute("aria-hidden", "true");
  }

  // =========================
  // State
  // =========================
  let selectedDay = null;
  let suppliers = [];
  let currentTab = "TODOS";

  // Dashboard Summary State
  let monthRefMini = new Date();
  monthRefMini.setDate(1);
  let serviceDayByDateMini = new Map();
  const WEEKDAYS_MINI = ["L","M","X","J","V","S","D"];

  // Dashboard UI Refs
  const calMonthMiniEl = document.getElementById("calMonthMini");
  const calWeekdaysMiniEl = document.getElementById("calWeekdaysMini");
  const calGridMiniEl = document.getElementById("calGridMini");
  const notifListDash = document.getElementById("notifListDash");
  const notifUpdatedDash = document.getElementById("notifUpdatedDash");
  const notifErrorDash = document.getElementById("notifErrorDash");

  // =========================
  // Tabs Navigation
  // =========================
  const panels = {
    TODOS: document.getElementById("panelCalendario"),
    PEDIDOS: document.getElementById("panelPedidos"),
    APERTURA: document.getElementById("panelApertura"),
    RECURRENTES: document.getElementById("panelRecurrentes"),
    EXTRAS: document.getElementById("panelExtras"),
    CONFIG: document.getElementById("panelConfig")
  };

  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll("#mainTabs .tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    Object.keys(panels).forEach(k => {
      if (k === tab) show(panels[k]); else hide(panels[k]);
    });

    if (tab === "TODOS") { loadPendingQueue(); loadRecentDone(); }
    else if (tab === "PEDIDOS") loadPedidos();
    else if (tab === "APERTURA") loadOpeningDefsAndRender();
    else if (tab === "RECURRENTES") loadRulesAndRender();
    else if (tab === "EXTRAS") loadExtras();
  }

  document.querySelectorAll("#mainTabs .tab-btn").forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  // =========================
  // Dashboard Summary Logic
  // =========================
  async function loadMonthServiceDaysMini(){
    try {
      const y = monthRefMini.getFullYear();
      const m = monthRefMini.getMonth();
      const start = ymd(new Date(y, m, 1));
      const end = ymd(new Date(y, m + 1, 0));

      const { data, error } = await client
        .from("service_days")
        .select("service_date")
        .gte("service_date", start)
        .lte("service_date", end);

      if (error) throw error;
      serviceDayByDateMini = new Map((data || []).map(r => [r.service_date, true]));
    } catch (e) {
      console.error("Error loading service days mini:", e);
    }
  }

  function renderCalendarMini(){
    if (!calMonthMiniEl || !calGridMiniEl) return;
    calMonthMiniEl.textContent = calMonthMiniEl.textContent = 
      monthRefMini.toLocaleString("es-AR", { month: "long" }).toUpperCase() + " " + monthRefMini.getFullYear();
    calGridMiniEl.innerHTML = "";

    const y = monthRefMini.getFullYear();
    const m = monthRefMini.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const daysInMonth = last.getDate();
    const startOffset = (first.getDay() + 6) % 7; 
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    const todayKey = ymd(new Date());

    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startOffset + 1;
      const cell = document.createElement("div");
      cell.className = "cal-mini-day";

      if (dayNum < 1 || dayNum > daysInMonth) {
        cell.classList.add("is-empty");
      } else {
        const key = ymd(new Date(y, m, dayNum));
        cell.textContent = dayNum;
        if (key === todayKey) cell.classList.add("is-today");
        
        if (serviceDayByDateMini.has(key)) {
          cell.classList.add("is-planned");
          const dot = document.createElement("span");
          dot.className = "cal-mini-dot";
          cell.appendChild(dot);
        }
      }
      calGridMiniEl.appendChild(cell);
    }
  }

  async function refreshDashboardResults() {
    try {
      notifUpdatedDash.textContent = "Actualizando...";
      
      const { data: pagos, error } = await client
        .from("finance_payments")
        .select("id, due_date")
        .eq("status", "PENDING");

      if (error) throw error;

      const now = new Date();
      const todayStr = ymd(now);
      
      // Calculate end of this week (Sunday)
      const endOfWeek = new Date(now);
      const day = now.getDay(); // 0 is Sunday, 1 is Monday...
      const diff = (day === 0 ? 0 : 7 - day); // days until Sunday
      endOfWeek.setDate(now.getDate() + diff);
      const endOfWeekStr = ymd(endOfWeek);

      // Calculate end of this month
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const endOfMonthStr = ymd(endOfMonth);

      let atrasados = 0;
      let estaSemana = 0;
      let esteMes = 0;

      (pagos || []).forEach(p => {
        if (!p.due_date) return;
        if (p.due_date < todayStr) {
          atrasados++;
        } else {
          if (p.due_date <= endOfWeekStr) estaSemana++;
          if (p.due_date <= endOfMonthStr) esteMes++;
        }
      });

      renderNotifsDash({ atrasados, estaSemana, esteMes });
    } catch (e) {
      console.error(e);
      if (notifUpdatedDash) notifUpdatedDash.textContent = "Error";
      if (notifErrorDash) notifErrorDash.classList.remove("is-hidden");
    }
  }

  function renderNotifsDash({ atrasados, estaSemana, esteMes }) {
    const items = [
      { label: "PAGOS ATRASADOS", count: atrasados },
      { label: "PAGOS ESTA SEMANA", count: estaSemana },
      { label: "PAGOS ESTE MES", count: esteMes }
    ];
    notifListDash.innerHTML = "";
    items.forEach(it => {
      const li = document.createElement("li");
      li.className = "notif-item";
      li.innerHTML = `<div class="notif-left"><span class="notif-text">${it.label}</span></div><span class="notif-value">${String(it.count)}</span>`;
      notifListDash.appendChild(li);
    });
    notifUpdatedDash.textContent = `Actualizado: ${new Date().toLocaleTimeString("es-AR")}`;
  }


  // =========================
  // Payment Confirmation
  // =========================
  const payModal = document.getElementById("payModal");
  const payForm = {
    id: document.getElementById("payPaymentId"),
    title: document.getElementById("payTitle"),
    due: document.getElementById("payDue"),
    amount: document.getElementById("payAmount"),
    voucher: document.getElementById("payVoucher"),
    method: document.getElementById("payMethod"),
    note: document.getElementById("payNote")
  };

  function openPayModal(p) {
    payForm.id.value = p.id;
    payForm.title.textContent = `${p.title} · ${p.supplier_name}`;
    payForm.due.textContent = `Vence: ${p.due_date} · Total: $${fmtMoney(p.amount_total)}`;
    payForm.amount.value = p.amount_total;
    payForm.note.value = "";

    // Load local defaults for this type/supplier
    const k = `pay_def:${p.source_type}:${p.supplier_id || "null"}`;
    const def = JSON.parse(localStorage.getItem(k) || "{}");
    payForm.voucher.value = def.voucher || "";
    payForm.method.value = def.method || "";

    openModal(payModal);
  }

  document.getElementById("btnClosePayModal").onclick = () => closeModal(payModal);

  document.getElementById("btnConfirmPay").onclick = async () => {
    const id = payForm.id.value;
    const amount = Number(payForm.amount.value);
    const voucher = payForm.voucher.value;
    const method = payForm.method.value;
    const note = payForm.note.value;

    if (!voucher || !method || amount <= 0) return alert("Completar todos los campos.");

    try {
      setStatus("Procesando pago...");
      const { error } = await client.rpc("admin_mark_payment_done", {
        p_payment_id: id,
        p_amount: amount,
        p_voucher: voucher,
        p_method: method,
        p_note: note
      });
      if (error) throw error;

      // Save defaults
      const p = calendarPayments.find(x => x.id === id);
      if (p) {
        const k = `pay_def:${p.source_type}:${p.supplier_id || "null"}`;
        localStorage.setItem(k, JSON.stringify({ voucher, method }));
      }

      closeModal(payModal);
      showToast("Pago registrado con éxito.", id);
      loadPendingQueue();
      loadRecentDone();
    } catch (e) {
      console.error(e);
      setStatus("Error al registrar pago.", true);
    }
  };

  async function undoPayment(id) {
    if (!confirm("¿Deshacer este pago?")) return;
    try {
      setStatus("Deshaciendo pago...");
      const { error } = await client.rpc("admin_undo_payment_done", { p_payment_id: id });
      if (error) throw error;
      loadPendingQueue();
      loadRecentDone();
    } catch (e) {
      console.error(e);
      setStatus("Error al deshacer.", true);
    }
  }

  // =========================
  // Toast
  // =========================
  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toastMsg");
  let toastTimer = null;

  function showToast(msg, id) {
    toastMsg.textContent = msg;
    show(toast);
    const undoBtn = document.getElementById("toastUndoBtn");
    undoBtn.onclick = async () => {
      await undoPayment(id);
      hide(toast);
    };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hide(toast), 8000);
  }

  document.getElementById("toastCloseBtn").onclick = () => hide(toast);

  // =========================
  // Pedidos (Approved Requests) Logic
  // =========================
  const pedidosTbody = document.querySelector("#pedidosTable tbody");

  async function loadPedidos() {
    try {
      setStatus("Cargando pedidos...");
      
      // 1) Requests APPROVED or PARTIAL_ACTION
      const { data: reqs, error: reqErr } = await client
        .from("inventory_purchase_requests")
        .select("id,status,created_at")
        .in("status", ["APPROVED","PARTIAL_ACTION"])
        .order("created_at", { ascending: true });

      if (reqErr) throw reqErr;

      const reqIds = (reqs || []).map(r => r.id);
      if (!reqIds.length) {
        pedidosTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No hay pedidos aprobados.</td></tr>`;
        setStatus("");
        return;
      }

      // 2) APPROVED lines
      const { data: lines, error: linesErr } = await client
        .from("inventory_purchase_request_lines")
        .select(`
          id,request_id,sku_id,requested_packs,pack_size_snapshot,line_status,
          inventory_sku:sku_id (nombre, sku)
        `)
        .in("request_id", reqIds)
        .eq("line_status", "APPROVED");

      if (linesErr) throw linesErr;

      if (!lines?.length) {
        pedidosTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No hay líneas aprobadas.</td></tr>`;
        setStatus("");
        return;
      }

      // 3) Recibos SUBMITTED to calc remaining
      const { data: receipts, error: recErr } = await client
        .from("inventory_purchase_receipts")
        .select("id,request_id")
        .in("request_id", reqIds)
        .eq("status", "SUBMITTED");

      if (recErr) throw recErr;

      const receiptIds = (receipts || []).map(r => r.id);
      const receiptReqById = new Map((receipts || []).map(r => [r.id, r.request_id]));

      const receivedSumMap = new Map(); // req:sku -> sum(received_units)
      if (receiptIds.length) {
        const { data: rLines, error: rlErr } = await client
          .from("inventory_purchase_receipt_lines")
          .select("receipt_id,sku_id,received_units")
          .in("receipt_id", receiptIds);

        if (!rlErr) {
          (rLines || []).forEach(rl => {
            const reqId = receiptReqById.get(rl.receipt_id);
            if (!reqId) return;
            const k = `${reqId}:${rl.sku_id}`;
            receivedSumMap.set(k, (receivedSumMap.get(k) || 0) + Number(rl.received_units || 0));
          });
        }
      }

      // 4) Render
      pedidosTbody.innerHTML = "";
      let count = 0;

      lines.forEach(l => {
        const ps = Math.max(1, Number(l.pack_size_snapshot || 1));
        const expected = Number(l.requested_packs || 0) * ps;
        const received = receivedSumMap.get(`${l.request_id}:${l.sku_id}`) || 0;
        const remaining = Math.max(0, expected - received);

        if (remaining <= 0) return;
        count++;

        const tr = document.createElement("tr");
        tr.className = "list-row";
        
        const sku = l.inventory_sku || {};
        const remPacks = Math.ceil(remaining / ps);

        tr.innerHTML = `
          <td class="cell-pl">
            <div class="row-title">${escapeHtml(sku.nombre || "-")}</div>
            <div class="row-sub-text">COD: ${escapeHtml(sku.sku || "-")} — REQ: ${escapeHtml(l.request_id.slice(0,8))}</div>
          </td>
          <td class="text-center">${remPacks}</td>
          <td class="text-center">${remaining}</td>
          <td class="text-center cell-pr">
            <span class="tag tag-blue">APROBADO</span>
          </td>
        `;
        pedidosTbody.appendChild(tr);
      });

      if (count === 0) {
        pedidosTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No hay líneas pendientes de recepción.</td></tr>`;
      }

      setStatus("");
    } catch (e) {
      console.error(e);
      setStatus("Error cargando pedidos.", true);
      pedidosTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Error al cargar.</td></tr>`;
    }
  }

  // =========================
  // Queue Logic
  // =========================
  const pendingQueueTbody = document.querySelector("#pendingQueueTable tbody");
  const doneRecentTbody = document.querySelector("#doneRecentTable tbody");
  const pendingQueueWrap = document.getElementById("pendingQueueWrap");
  const doneRecentWrap = document.getElementById("doneRecentWrap");
  const queueSummary = document.getElementById("queueSummary");
  const queueSearch = document.getElementById("queueSearch");

  async function loadPendingQueue() {
    try {
      const { data, error } = await client
        .from("finance_payments")
        .select("id, source_type, title, supplier_id, due_date, amount_total, status")
        .eq("status", "PENDING")
        .order("due_date", { ascending: true })
        .limit(100);

      if (error) throw error;
      renderQueueInto(pendingQueueTbody, data || []);
    } catch (e) { console.error(e); }
  }

  async function loadRecentDone() {
    try {
      const { data, error } = await client
        .from("finance_payments")
        .select("id, source_type, title, supplier_id, due_date, amount_total, status, done_at")
        .eq("status", "DONE")
        .order("done_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      renderQueueInto(doneRecentTbody, data || [], true);
    } catch (e) { console.error(e); }
  }

  function renderQueueInto(tbody, list, isDone = false) {
    tbody.innerHTML = list.length ? "" : `<tr><td colspan="7" class="text-center text-muted">Vacio.</td></tr>`;
    list.forEach(p => {
      const tr = document.createElement("tr");
      tr.className = "list-row";
      const sup = supplierName(p.supplier_id);
      
      if (isDone) {
        tr.innerHTML = `
          <td class="cell-pl"><b>${p.title}</b><br><small>${sup}</small></td>
          <td class="text-center">${p.source_type}</td>
          <td class="text-center">${p.due_date}</td>
          <td class="text-right">$${fmtMoney(p.amount_total)}</td>
          <td class="text-center">—</td>
          <td class="text-center">—</td>
          <td class="text-center cell-pr"><button class="btn-secondary" onclick="this.dataset.id && window.undoPayment(this.dataset.id)" data-id="${p.id}">UNDO</button></td>
        `;
      } else {
        tr.innerHTML = `
          <td class="cell-pl"><b>${p.title}</b><br><small>${sup}</small></td>
          <td class="text-center">${p.source_type}</td>
          <td class="text-center">${p.due_date}</td>
          <td class="text-right">$${fmtMoney(p.amount_total)}</td>
          <td class="text-center"><span class="tag tag-yellow">PEND</span></td>
          <td class="text-center cell-pr"><button class="btn-primary" data-id="${p.id}">PAGAR</button></td>
        `;
      }
      const btn = tr.querySelector("[data-id]");
      if (btn) btn.onclick = () => openPayModal({ ...p, supplier_name: sup });
      tbody.appendChild(tr);
    });
  }

  document.getElementById("btnViewPending").onclick = () => { show(pendingQueueWrap); hide(doneRecentWrap); };
  document.getElementById("btnViewDone").onclick = () => { hide(pendingQueueWrap); show(doneRecentWrap); };
  document.getElementById("btnClearDay").onclick = () => { selectedDay = null; loadPendingQueue(); loadRecentDone(); };

  // =========================
  // Rules Management
  // =========================
  async function loadRulesAndRender() {
    try {
      const { data, error } = await client.from("finance_payment_rules").select("*").order("title", { ascending: true });
      if (error) throw error;
      renderRules(data || []);
    } catch (e) { console.error(e); }
  }

  function renderRules(rules) {
    fillRulesTbody(document.querySelector("#rulesTable tbody"), rules);
  }

  function fillRulesTbody(tbody, list) {
    tbody.innerHTML = list.length ? "" : `<tr><td colspan="6" class="text-center text-muted">Nada.</td></tr>`;
    list.forEach(r => {
      const tr = document.createElement("tr");
      tr.className = "list-row";
      tr.innerHTML = `
        <td class="cell-pl"><b>${r.title}</b></td>
        <td class="text-center">${r.rule_type}</td>
        <td class="text-right">${r.amount_mode === "FIXED" ? "$" + fmtMoney(r.fixed_amount) : "VAR"}</td>
        <td class="text-center">${supplierName(r.supplier_id)}</td>
        <td class="text-center">${r.is_active ? "SÍ" : "NO"}</td>
        <td class="text-center cell-pr"><button class="btn-secondary" data-edit="${r.id}">EDIT</button></td>
      `;
      tr.querySelector("[data-edit]").onclick = () => openRuleModal(r);
      tbody.appendChild(tr);
    });
  }

  const ruleModal = document.getElementById("ruleModal");
  function openRuleModal(r = null) {
    const f = document.getElementById("ruleForm");
    f.ruleId.value = r?.id || "";
    f.ruleTitle.value = r?.title || "";
    f.ruleType.value = r?.rule_type || "WEEKLY";
    f.ruleSupplier.value = r?.supplier_id || "";
    f.ruleAmountMode.value = r?.amount_mode || "FIXED";
    f.ruleFixedAmount.value = r?.fixed_amount || 0;
    f.ruleIsActive.value = String(r?.is_active ?? true);
    
    document.getElementById("btnDeleteRule").classList.toggle("is-hidden", !r);
    syncRuleFields();
    openModal(ruleModal);
  }

  function syncRuleFields() {
    const type = document.getElementById("ruleType").value;
    document.getElementById("weeklyWrap").classList.toggle("is-hidden", type !== "WEEKLY");
    document.getElementById("monthlyWrap").classList.toggle("is-hidden", type !== "MONTHLY");
    document.getElementById("fixedAmountWrap").classList.toggle("is-hidden", document.getElementById("ruleAmountMode").value !== "FIXED");
  }

  document.getElementById("ruleType").onchange = syncRuleFields;
  document.getElementById("ruleAmountMode").onchange = syncRuleFields;
  document.getElementById("btnCloseRuleModal").onclick = () => closeModal(ruleModal);
  document.getElementById("btnOpenRuleModal").onclick = () => openRuleModal();

  document.getElementById("btnSaveRule").onclick = async () => {
    const f = document.getElementById("ruleForm");
    const payload = {
      title: f.ruleTitle.value,
      rule_type: f.ruleType.value,
      supplier_id: f.ruleSupplier.value || null,
      amount_mode: f.ruleAmountMode.value,
      fixed_amount: Number(f.ruleFixedAmount.value),
      is_active: f.ruleIsActive.value === "true",
      weekday: f.ruleType.value === "WEEKLY" ? Number(document.getElementById("ruleWeekday").value) : null,
      day_of_month: f.ruleType.value === "MONTHLY" ? Number(document.getElementById("ruleDayOfMonth").value) : null
    };

    try {
      if (f.ruleId.value) {
        const { error } = await client.from("finance_payment_rules").update(payload).eq("id", f.ruleId.value);
        if (error) throw error;
      } else {
        const { error } = await client.from("finance_payment_rules").insert(payload);
        if (error) throw error;
      }
      closeModal(ruleModal);
      loadRulesAndRender();
    } catch (e) { alert("Error guardando regla."); }
  };

  document.getElementById("btnGenerateRules").onclick = async () => {
    if (!confirm("Generar pagos proyectados desde reglas?")) return;
    try {
      setStatus("Generando...");
      const { error } = await client.rpc("admin_generate_rule_payments");
      if (error) throw error;
      setStatus("Generados.");
      loadPendingQueue();
    } catch (e) { setStatus("Error generador.", true); }
  };

  // =========================
  // Opening Costs
  // =========================
  async function loadOpeningDefsAndRender() {
    try {
      const { data, error } = await client.from("finance_opening_cost_defs").select("*").order("sort_order", { ascending: true });
      if (error) throw error;
      const tbody = document.querySelector("#openingDefsTable tbody");
      tbody.innerHTML = data.length ? "" : `<tr><td colspan="6" class="text-center text-muted">Vacio.</td></tr>`;
      data.forEach(d => {
        const tr = document.createElement("tr");
        tr.className = "list-row";
        tr.innerHTML = `
          <td class="cell-pl"><b>${d.title}</b></td>
          <td class="text-center">${d.amount_mode}</td>
          <td class="text-right">$${fmtMoney(d.default_amount)}</td>
          <td class="text-center">${d.due_days_before}</td>
          <td class="text-center">—</td>
          <td class="text-center cell-pr"><button class="btn-secondary" data-edit="${d.id}">EDIT</button></td>
        `;
        tr.querySelector("[data-edit]").onclick = () => openOpeningModal(d);
        tbody.appendChild(tr);
      });
    } catch (e) { console.error(e); }
  }

  const openingModal = document.getElementById("openingModal");
  function openOpeningModal(d = null) {
    const f = document.getElementById("openingForm");
    f.openingId.value = d?.id || "";
    f.openingTitle.value = d?.title || "";
    f.openingSupplier.value = d?.supplier_id || "";
    f.openingAmountMode.value = d?.amount_mode || "FIXED";
    f.openingDefaultAmount.value = d?.default_amount || 0;
    f.openingDueDays.value = d?.due_days_before || 0;
    f.openingSort.value = d?.sort_order || 100;
    f.openingIsActive.checked = d ? (d.is_active !== false) : true;
    openModal(openingModal);
  }
  document.getElementById("btnCloseOpeningModal").onclick = () => closeModal(openingModal);
  document.getElementById("btnNewOpeningDef").onclick = () => openOpeningModal();

  document.getElementById("btnSaveOpening").onclick = async () => {
    const f = document.getElementById("openingForm");
    const payload = {
      title: f.openingTitle.value,
      supplier_id: f.openingSupplier.value || null,
      amount_mode: f.openingAmountMode.value,
      default_amount: Number(f.openingDefaultAmount.value),
      due_days_before: Number(f.openingDueDays.value),
      sort_order: Number(f.openingSort.value),
      is_active: f.openingIsActive.checked
    };
    try {
      if (f.openingId.value) {
        await client.from("finance_opening_cost_defs").update(payload).eq("id", f.openingId.value);
      } else {
        await client.from("finance_opening_cost_defs").insert(payload);
      }
      closeModal(openingModal);
      loadOpeningDefsAndRender();
    } catch (e) { alert("Error guardando."); }
  };

  document.getElementById("btnSyncOpeningForPreview").onclick = async () => {
    const date = document.getElementById("openingPreviewPlanDate").value;
    if (!date) return alert("Elegir fecha.");
    try {
      setStatus("Sincronizando costos...");
      const { error } = await client.rpc("admin_sync_opening_cost_payments", { p_plan_date: date });
      if (error) throw error;
      setStatus("Sincronizado.");
      loadPendingQueue();
    } catch (e) { setStatus("Error sync.", true); }
  };

  // =========================
  // Extras Management
  // =========================
  async function loadExtras() {
    try {
      const { data, error } = await client
        .from("finance_payments")
        .select("*")
        .eq("source_type", "EXTRA")
        .order("due_date", { descending: false });
      if (error) throw error;
      const tbody = document.querySelector("#extrasTable tbody");
      tbody.innerHTML = data.length ? "" : `<tr><td colspan="5" class="text-center text-muted">Nada.</td></tr>`;
      data.forEach(p => {
        const tr = document.createElement("tr");
        tr.className = "list-row";
        tr.innerHTML = `
          <td class="cell-pl"><b>${p.title}</b></td>
          <td class="text-center">${p.due_date}</td>
          <td class="text-right">$${fmtMoney(p.amount_total)}</td>
          <td class="text-center">${p.status}</td>
          <td class="text-center cell-pr"><button class="btn-secondary" data-edit="${p.id}">EDIT</button></td>
        `;
        tr.querySelector("[data-edit]").onclick = () => openExtraModal(p);
        tbody.appendChild(tr);
      });
    } catch (e) { console.error(e); }
  }

  const extraModal = document.getElementById("extraModal");
  function openExtraModal(p = null) {
    const f = document.getElementById("extraForm");
    f.extraId.value = p?.id || "";
    f.extraTitle.value = p?.title || "";
    f.extraSupplier.value = p?.supplier_id || "";
    f.extraDueDate.value = p?.due_date || ymd(new Date());
    f.extraAmount.value = p?.amount_total || 0;
    f.extraStatus.value = p?.status || "PENDING";
    openModal(extraModal);
  }
  document.getElementById("btnCloseExtraModal").onclick = () => closeModal(extraModal);
  document.getElementById("btnNewExtra").onclick = () => openExtraModal();

  document.getElementById("btnSaveExtra").onclick = async () => {
    const f = document.getElementById("extraForm");
    const payload = {
      source_type: "EXTRA",
      title: f.extraTitle.value,
      supplier_id: f.extraSupplier.value || null,
      due_date: f.extraDueDate.value,
      amount_total: Number(f.extraAmount.value),
      status: f.extraStatus.value,
      week_key: isoWeekKey(new Date(f.extraDueDate.value + "T12:00:00"))
    };
    try {
      if (f.extraId.value) {
        await client.from("finance_payments").update(payload).eq("id", f.extraId.value);
      } else {
        await client.from("finance_payments").insert(payload);
      }
      closeModal(extraModal);
      loadExtras();
      loadPendingQueue();
    } catch (e) { alert("Error guardando extra."); }
  };

  // =========================
  // Catalogs
  // =========================
  async function loadSuppliers() {
    try {
      const { data, error } = await client.from("suppliers").select("id, nombre").order("nombre", { ascending: true });
      if (error) throw error;
      suppliers = data || [];
      const opts = ["<option value=''>—</option>", ...suppliers.map(s => `<option value="${s.id}">${s.nombre}</option>`)].join("");
      ["ruleSupplier", "openingSupplier", "extraSupplier"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = opts;
      });
    } catch (e) { console.error(e); }
  }

  function supplierName(id) {
    return suppliers.find(s => s.id === id)?.nombre || "—";
  }

  // =========================
  // Back & Config
  // =========================
  document.getElementById("btnBack").onclick = () => window.location.href = "admin-index.html";
  document.getElementById("btnRefreshCalendar").onclick = () => { loadPendingQueue(); loadRecentDone(); };

  // =========================
  // Boot
  // =========================
  (async function init() {
    const session = await requireAdmin();
    if (!session) return;

    await loadSuppliers();

    // Init Dashboard Summary
    if (calWeekdaysMiniEl) {
      calWeekdaysMiniEl.innerHTML = WEEKDAYS_MINI.map(w => `<div class="cal-mini-weekday">${w}</div>`).join("");
    }
    await loadMonthServiceDaysMini();
    renderCalendarMini();
    refreshDashboardResults();

    showTab("TODOS");

    window.undoPayment = undoPayment; // For inline calls if any
  })();

})();
