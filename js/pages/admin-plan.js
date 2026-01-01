/* /js/pages/admin-plan.js */

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

  function fmtMoney(v, decimals = 0) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function ymd(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseYMD(key) {
    const [y, m, d] = String(key).split("-").map(x => parseInt(x, 10));
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function formatDateHuman(key) {
    const d = parseYMD(key);
    return d.toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
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

  function asInt(v) {
    const n = parseInt(String(v ?? "").trim(), 10);
    return Number.isFinite(n) ? n : 0;
  }

  // =========================
  // State
  // =========================
  let sessionUserId = null;
  let roles = [];
  let rolesById = new Map();
  let openingDefs = [];

  const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
  let calMonthView = new Date(); calMonthView.setDate(1);
  let plannedByDate = new Map();

  let editorMode = "CAL"; 
  let selectedDateKey = null;
  let selectedServiceDay = null;
  let currentModifyDay = null;

  let staffQty = new Map();   
  let openingAmt = new Map(); 

  // =========================
  // UI Refs
  // =========================
  const panels = {
    CALENDARIO: document.getElementById("panelCalendario"),
    MODIFICAR: document.getElementById("panelModificar")
  };
  const calTitleEl = document.getElementById("calTitle");
  const calMonthEl = document.getElementById("calMonth");
  const calWeekdaysEl = document.getElementById("calWeekdays");
  const calGridEl = document.getElementById("calGrid");
  const dateActionsTbody = document.getElementById("dateActionsTbody");

  // Editorial groups
  function editorRefs(mode) {
    if (mode === "MOD") {
      return {
        wrap: document.getElementById("planEditorWrapMod"),
        staffTotalText: document.getElementById("staffTotalTextMod"),
        staffMetaText: document.getElementById("staffMetaTextMod"),
        staffSummaryGrid: document.getElementById("staffSummaryGridMod"),
        openingTotalText: document.getElementById("openingTotalTextMod"),
        openingMetaText: document.getElementById("openingMetaTextMod"),
        openingCostsTbody: document.getElementById("openingCostsTbodyMod"),
        budgetTotalText: document.getElementById("budgetTotalTextMod"),
        budgetMetaText: document.getElementById("budgetMetaTextMod"),
        notesEl: document.getElementById("planNotesMod")
      };
    }
    return {
      wrap: document.getElementById("planEditorWrapCal"),
      staffTotalText: document.getElementById("staffTotalTextCal"),
      staffMetaText: document.getElementById("staffMetaTextCal"),
      staffSummaryGrid: document.getElementById("staffSummaryGridCal"),
      openingTotalText: document.getElementById("openingTotalTextCal"),
      openingMetaText: document.getElementById("openingMetaTextCal"),
      openingCostsTbody: document.getElementById("openingCostsTbodyCal"),
      budgetTotalText: document.getElementById("budgetTotalTextCal"),
      budgetMetaText: document.getElementById("budgetMetaTextCal"),
      notesEl: document.getElementById("planNotesCal")
    };
  }

  // =========================
  // Tabs Navigation
  // =========================
  function showTab(tab) {
    document.querySelectorAll("#mainTabs .tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    Object.keys(panels).forEach(k => {
      if (k === tab) show(panels[k]); else hide(panels[k]);
    });

    if (tab === "CALENDARIO") { renderDateActions(); renderCalendarMini(); }
    if (tab === "MODIFICAR") loadPlannedDaysList();
  }

  document.querySelectorAll("#mainTabs .tab-btn").forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  // =========================
  // Data Loading
  // =========================
  async function loadRoles() {
    const { data, error } = await client.from("staff_roles").select("id,role_name,base_pay,is_active,category").order("role_name");
    if (error) throw error;
    roles = (data || []).filter(r => r.is_active !== false);
    rolesById = new Map(roles.map(r => [String(r.id), r]));
  }

  async function loadOpeningDefs() {
    const { data, error } = await client.from("finance_opening_cost_defs").select("*").eq("is_active", true).order("sort_order");
    if (error) throw error;
    openingDefs = data || [];
  }

  async function loadMonthPlans() {
    const start = new Date(calMonthView.getFullYear(), calMonthView.getMonth(), 1);
    const end = new Date(calMonthView.getFullYear(), calMonthView.getMonth() + 1, 0);
    const { data, error } = await client.from("service_days").select("*").gte("service_date", ymd(start)).lte("service_date", ymd(end));
    if (error) throw error;
    plannedByDate = new Map((data || []).map(r => [String(r.service_date), r]));
  }

  // =========================
  // Calendar (Mini) Logic
  // =========================
  function renderWeekdays() {
    calWeekdaysEl.innerHTML = "";
    WEEKDAYS.forEach(ch => {
      const d = document.createElement("div");
      d.className = "cal-mini-weekday";
      d.textContent = ch;
      calWeekdaysEl.appendChild(d);
    });
  }

  function renderCalendarMini() {
    const mLabel = calMonthView.toLocaleString("es-AR", { month: "long" }).toUpperCase();
    calTitleEl.textContent = `${mLabel} ${calMonthView.getFullYear()}`;
    calMonthEl.textContent = mLabel;

    const y = calMonthView.getFullYear(), m = calMonthView.getMonth();
    const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = last.getDate();
    const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
    const todayKey = ymd(new Date());

    calGridEl.innerHTML = "";
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - offset + 1;
      const cell = document.createElement("div");
      cell.className = "cal-mini-day";

      if (dayNum < 1 || dayNum > daysInMonth) {
        cell.classList.add("is-empty");
      } else {
        const key = ymd(new Date(y, m, dayNum));
        const plan = plannedByDate.get(key);
        cell.textContent = dayNum;
        if (key === todayKey) cell.classList.add("is-today");
        if (plan) cell.classList.add(plan.event_status === "CLOSED" ? "tag-green" : "tag-red");
        if (selectedDateKey === key) cell.classList.add("tag-gray");

        cell.onclick = () => {
          selectedDateKey = key;
          selectedServiceDay = plan || null;
          resetCalendarEditor();
          renderCalendarMini();
          renderDateActions();
        };
      }
      calGridEl.appendChild(cell);
    }
  }

  function resetCalendarEditor() {
    editorMode = "CAL";
    hide(document.getElementById("planEditorWrapCal"));
    staffQty = new Map();
    openingAmt = new Map();
    document.getElementById("planNotesCal").value = "";
  }

  function renderDateActions() {
    if (!selectedDateKey) {
      dateActionsTbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Seleccioná una fecha.</td></tr>`;
      return;
    }
    const plan = selectedServiceDay;
    const statusTxt = plan ? `PLAN: ${plan.plan_status} · EVENTO: ${plan.event_status}` : "SIN PLAN";
    dateActionsTbody.innerHTML = `
      <tr class="list-row">
        <td class="cell-pl"><b>${formatDateHuman(selectedDateKey).toUpperCase()}</b><br><small>${selectedDateKey}</small></td>
        <td class="text-center"><span class="tag ${plan ? "tag-red" : "tag-gray"}">${statusTxt}</span></td>
        <td class="text-right cell-pr"><button class="btn-primary" id="btnPlanify">${plan ? "VER / EDITAR" : "PLANIFICAR"}</button></td>
      </tr>
    `;
    document.getElementById("btnPlanify").onclick = () => {
      if (selectedServiceDay) { openModifyForDate(selectedDateKey); showTab("MODIFICAR"); }
      else openPlannerForDate(selectedDateKey);
    };
  }

  // =========================
  // Editor Logic
  // =========================
  async function openPlannerForDate(dateKey) {
    editorMode = "CAL";
    staffQty = new Map();
    openingAmt = new Map();
    openingDefs.forEach(d => openingAmt.set(String(d.id), Number(d.default_amount || 0)));
    show(document.getElementById("planEditorWrapCal"));
    renderOpeningCostsTo(editorRefs("CAL"));
    renderTotalsAll();
  }

  function renderTotalsAll() {
    ["CAL", "MOD"].forEach(m => {
      const refs = editorRefs(m);
      if (!refs.wrap) return;

      // Staff summary
      let sTotal = 0, sPeople = 0, sRoles = 0;
      const chosen = [];
      staffQty.forEach((q, rid) => {
        const r = rolesById.get(rid);
        if (r && q > 0) {
          sTotal += r.base_pay * q; sPeople += q; sRoles++;
          chosen.push({ name: r.role_name, q, total: r.base_pay * q });
        }
      });
      refs.staffTotalText.textContent = `$${fmtMoney(sTotal)}`;
      refs.staffMetaText.textContent = `${sRoles} cargos · ${sPeople} personas`;

      refs.staffSummaryGrid.innerHTML = chosen.length ? "" : '<div class="kv"><div class="k">Detalle</div><div class="v">Sin dotación.</div></div>';
      chosen.slice(0, 8).forEach(x => {
        refs.staffSummaryGrid.innerHTML += `<div class="kv"><div class="k">${x.name}</div><div class="v">${x.q} · $${fmtMoney(x.total)}</div></div>`;
      });

      // Opening totals
      let oTotal = 0, oItems = 0;
      openingAmt.forEach(v => { oTotal += v; oItems++; });
      refs.openingTotalText.textContent = `$${fmtMoney(oTotal)}`;
      refs.openingMetaText.textContent = `${oItems} items`;

      // Grand total
      refs.budgetTotalText.textContent = `$${fmtMoney(sTotal + oTotal)}`;
    });
  }

  function renderOpeningCostsTo(refs) {
    const tbody = refs.openingCostsTbody;
    tbody.innerHTML = openingDefs.length ? "" : '<tr><td colspan="3" class="center text-muted">No hay costos.</td></tr>';
    openingDefs.forEach(d => {
      const id = String(d.id);
      const val = openingAmt.get(id) || 0;
      const tr = document.createElement("tr");
      tr.className = "list-row";
      tr.innerHTML = `
        <td class="cell-pl"><b>${d.title}</b><br><small>${d.amount_mode}</small></td>
        <td class="text-center"><span class="tag ${d.amount_mode === 'VARIABLE' ? 'tag-yellow' : 'tag-gray'}">${d.amount_mode}</span></td>
        <td class="text-right cell-pr">
          <input type="number" class="table-input" value="${val}" ${d.amount_mode === 'FIXED' ? 'disabled' : ''} />
        </td>
      `;
      tr.querySelector("input").onchange = (e) => {
        openingAmt.set(id, Number(e.target.value) || 0);
        renderTotalsAll();
      };
      tbody.appendChild(tr);
    });
  }

  // =========================
  // Staff Modal
  // =========================
  const staffModal = document.getElementById("staffModal");
  function openStaffModal() {
    renderStaffModal();
    openModal(staffModal);
  }

  function renderStaffModal() {
    const term = (document.getElementById("staffSearch").value || "").toLowerCase();
    const tbody = document.getElementById("staffModalTbody");
    tbody.innerHTML = "";
    roles.filter(r => r.role_name.toLowerCase().includes(term)).forEach(r => {
      const id = String(r.id);
      const q = staffQty.get(id) || 0;
      const tr = document.createElement("tr");
      tr.className = "list-row";
      tr.innerHTML = `
        <td class="cell-pl"><b>${r.role_name}</b><br><small>${r.category || ""}</small></td>
        <td class="text-right">$${fmtMoney(r.base_pay)}</td>
        <td class="text-center"><input type="number" class="table-input" value="${q}" style="width:50px" /></td>
        <td class="text-right cell-pr">$${fmtMoney(r.base_pay * q)}</td>
      `;
      tr.querySelector("input").oninput = (e) => {
        const newQ = Math.max(0, asInt(e.target.value));
        if (newQ > 0) staffQty.set(id, newQ); else staffQty.delete(id);
        tr.children[3].textContent = `$${fmtMoney(r.base_pay * newQ)}`;
      };
      tbody.appendChild(tr);
    });
  }

  document.getElementById("btnStaffApply").onclick = () => { closeModal(staffModal); renderTotalsAll(); };
  document.getElementById("btnStaffCancel").onclick = () => closeModal(staffModal);
  document.getElementById("staffSearch").oninput = renderStaffModal;

  // =========================
  // Persistence
  // =========================
  async function savePlan(date) {
    if (!date) return;
    const staffArr = []; staffQty.forEach((qty, role_id) => staffArr.push({ role_id, qty }));
    const openingArr = []; openingAmt.forEach((amount, opening_cost_def_id) => openingArr.push({ opening_cost_def_id, amount }));
    const notes = (editorMode === "MOD" ? document.getElementById("planNotesMod").value : document.getElementById("planNotesCal").value).trim();
    
    let total = 0;
    staffArr.forEach(x => total += rolesById.get(x.role_id).base_pay * x.qty);
    openingArr.forEach(x => total += x.amount);

    try {
      setStatus("Guardando...");
      const { data, error } = await client.rpc("admin_plan_upsert", {
        p_service_date: date,
        p_staff: staffArr,
        p_opening_costs: openingArr,
        p_notes: notes || null,
        p_total_cost: total
      });
      if (error) throw error;
      setStatus("Guardado.");
      await loadMonthPlans();
      renderCalendarMini();
      if (editorMode === "CAL") { showTab("MODIFICAR"); await openModifyForDate(date); }
      else await loadPlannedDaysList();
    } catch (e) { console.error(e); setStatus("Error al guardar.", true); }
  }

  // =========================
  // Modify Tab
  // =========================
  async function loadPlannedDaysList() {
    const { data, error } = await client.from("service_days").select("*").order("service_date", { ascending: false }).limit(50);
    if (error) return;
    const tbody = document.querySelector("#plansTable tbody");
    tbody.innerHTML = data.length ? "" : '<tr><td colspan="5" class="center text-muted">No hay planes.</td></tr>';
    data.forEach(r => {
      const tr = document.createElement("tr");
      tr.className = "list-row";
      tr.innerHTML = `
        <td class="cell-pl"><b>${formatDateHuman(r.service_date).toUpperCase()}</b></td>
        <td class="text-center"><span class="tag tag-gray">${r.plan_status}</span></td>
        <td class="text-center"><span class="tag ${r.event_status === 'CLOSED' ? 'tag-green' : 'tag-gray'}">${r.event_status}</span></td>
        <td class="text-right">$${fmtMoney(r.total_cost_snapshot)}</td>
        <td class="text-center cell-pr"><button class="btn-secondary">ABRIR</button></td>
      `;
      tr.onclick = () => openModifyForDate(r.service_date);
      tbody.appendChild(tr);
    });
  }

  async function openModifyForDate(date) {
    currentModifyDay = date;
    editorMode = "MOD";
    const { data: day } = await client.from("service_days").select("*").eq("service_date", date).single();
    if (!day) return;

    show(document.getElementById("modifyEditorWrap"));
    document.getElementById("modifyTitle").textContent = formatDateHuman(date).toUpperCase();
    document.getElementById("planNotesMod").value = day.notes || "";

    // Load detailed breakdown
    staffQty = new Map();
    const { data: staff } = await client.from("service_day_staff").select("role_id,qty").eq("service_day_id", day.id);
    staff?.forEach(s => staffQty.set(s.role_id, s.qty));

    openingAmt = new Map();
    const { data: inst } = await client.from("finance_opening_cost_instances").select("opening_cost_def_id,payment_id").eq("plan_date", date);
    if (inst?.length) {
      const pids = inst.map(i => i.payment_id);
      const { data: pays } = await client.from("finance_payments").select("id,opening_cost_def_id,amount_total").in("id", pids);
      pays?.forEach(p => openingAmt.set(p.opening_cost_def_id, Number(p.amount_total)));
    }

    renderOpeningCostsTo(editorRefs("MOD"));
    renderTotalsAll();
    
    document.getElementById("btnMarkOpen").disabled = day.event_status !== "PLANNED";
    document.getElementById("btnCloseEvent").disabled = day.event_status === "CLOSED";
  }

  // =========================
  // Event Actions
  // =========================
  async function updateEventStatus(status) {
    if (!currentModifyDay) return;
    try {
      const { error } = await client.from("service_days").update({ 
        event_status: status,
        closed_at: status === 'CLOSED' ? new Date().toISOString() : null,
        closed_by: status === 'CLOSED' ? sessionUserId : null
      }).eq("service_date", currentModifyDay);
      if (error) throw error;
      await openModifyForDate(currentModifyDay);
      await loadMonthPlans();
      renderCalendarMini();
    } catch (e) { alert("Error al actualizar evento."); }
  }

  // =========================
  // Listeners
  // =========================
  document.getElementById("btnBack").onclick = () => window.location.href = "admin-index.html";
  document.getElementById("calPrev").onclick = () => { calMonthView.setMonth(calMonthView.getMonth() - 1); loadMonthPlans().then(renderCalendarMini); };
  document.getElementById("calNext").onclick = () => { calMonthView.setMonth(calMonthView.getMonth() + 1); loadMonthPlans().then(renderCalendarMini); };
  document.getElementById("calToday").onclick = () => { calMonthView = new Date(); calMonthView.setDate(1); loadMonthPlans().then(renderCalendarMini); };
  
  document.getElementById("btnEditStaffCal").onclick = () => openStaffModal();
  document.getElementById("btnEditStaffMod").onclick = () => openStaffModal();
  document.getElementById("btnSavePlanCal").onclick = () => savePlan(selectedDateKey);
  document.getElementById("btnSavePlanMod").onclick = () => savePlan(currentModifyDay);
  
  document.getElementById("btnMarkOpen").onclick = () => updateEventStatus("OPEN");
  document.getElementById("btnCloseEvent").onclick = () => updateEventStatus("CLOSED");
  document.getElementById("btnRefreshPlans").onclick = () => loadPlannedDaysList();

  // Master Data Links
  ["btnGoCargosCal", "btnGoCargosMod"].forEach(id => document.getElementById(id).onclick = () => window.location.href = "../master/master-cargos.html");
  ["btnGoPagosCal", "btnGoPagosMod"].forEach(id => document.getElementById(id).onclick = () => window.location.href = "admin-pagos.html");
  ["btnGoChecklistCal", "btnGoChecklistMod"].forEach(id => document.getElementById(id).onclick = () => window.location.href = "../master/master-checklist.html");

  // =========================
  // Init
  // =========================
  (async function init() {
    const session = await requireAdmin();
    if (!session) return;
    sessionUserId = session.user.id;

    await Promise.all([loadRoles(), loadOpeningDefs(), loadMonthPlans()]);
    renderWeekdays();
    renderCalendarMini();
    renderDateActions();
    showTab("CALENDARIO");
  })();

})();
