/* /js/pages/logistica-index.js */

(function() {
  const client = window.supabaseClient;

  // =========================
  // State
  // =========================
  let auth = null;
  let selectedDateKey = null;
  let monthRef = new Date();
  monthRef.setDate(1);

  let serviceDayByDate = new Map();
  const WEEKDAYS = ["L","M","X","J","V","S","D"];

  // =========================
  // UI Refs
  // =========================
  const calMonthEl = document.getElementById("calMonth");
  const calWeekdaysEl = document.getElementById("calWeekdays");
  const calGridEl = document.getElementById("calGrid");

  const btnBack = document.getElementById("btnBack");

  const notifList = document.getElementById("notifList");
  const notifUpdated = document.getElementById("notifUpdated");
  const notifError = document.getElementById("notifError");

  // =========================
  // Auth
  // =========================
  async function requireLogistica() {
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

    if (profErr || !["LOGISTICA", "LOGÍSTICA", "ADMIN"].includes(prof?.role?.toUpperCase())) {
      try { await client.auth.signOut(); } catch {}
      window.location.replace("../auth/login.html");
      return null;
    }

    return { session, role: prof.role.toUpperCase() };
  }

  // =========================
  // Helpers
  // =========================
  function ymd(d){
    return d.toISOString().split('T')[0];
  }

  function monthLabel(date) {
    return date.toLocaleString("es-AR", { month: "long" }).toUpperCase() + " " + date.getFullYear();
  }

  // =========================
  // Data Logic
  // =========================
  async function loadMonthServiceDays(){
    const y = monthRef.getFullYear();
    const m = monthRef.getMonth();
    const start = ymd(new Date(y, m, 1));
    const end = ymd(new Date(y, m + 1, 0));

    const { data, error } = await client
      .from("service_days")
      .select("service_date")
      .gte("service_date", start)
      .lte("service_date", end);

    if (error) throw error;
    serviceDayByDate = new Map((data || []).map(r => [r.service_date, true]));
  }

  // =========================
  // Calendar Rendering
  // =========================
  function renderCalendarMini(){
    calMonthEl.textContent = monthLabel(monthRef);
    calGridEl.innerHTML = "";

    const y = monthRef.getFullYear();
    const m = monthRef.getMonth();
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
        if (key === selectedDateKey) cell.classList.add("is-selected");
        
        if (serviceDayByDate.has(key)) {
          cell.classList.add("is-planned");
          const dot = document.createElement("span");
          dot.className = "cal-mini-dot";
          cell.appendChild(dot);
        }

        cell.onclick = () => {
          selectedDateKey = key;
          renderCalendarMini();
        };
      }
      calGridEl.appendChild(cell);
    }
  }

  // =========================
  // Notifications
  // =========================
  async function refreshNotifications() {
    notifUpdated.textContent = "Actualizando...";
    try {
      // 1. Checks
      const { count: checks } = await client.from("inventory_check_requests").select("id", { count: "exact", head: true }).in("status", ["OPEN", "IN_PROGRESS"]);
      
      // 2. Low Stock
      const { data: stock } = await client.from("v_admin_stock").select("sku_id").filter("stock_actual", "lt", "stock_ideal");
      const below = (stock || []).length;

      // 3. Pending Repos
      const { count: repos } = await client.from("inventory_purchase_requests").select("id", { count: "exact", head: true }).in("status", ["APPROVED", "PARTIAL_ACTION"]);

      renderNotifs({ checks: checks || 0, repos: repos || 0, below: below || 0 });
    } catch (e) {
      console.error(e);
      if (notifError) notifError.classList.remove("is-hidden");
    }
  }

  function renderNotifs({ checks, repos, below }) {
    const items = [
      { label: "CHECKS PENDIENTES", count: checks },
      { label: "REPOSICIONES PENDIENTES", count: repos },
      { label: "INSUMOS BAJO IDEAL", count: below }
    ];

    notifList.innerHTML = "";
    items.forEach(it => {
      const li = document.createElement("li");
      li.className = "notif-item";
      li.innerHTML = `
        <div class="notif-left"><span class="notif-text">${it.label}</span></div>
        <span class="notif-value">${it.count}</span>
      `;
      notifList.appendChild(li);
    });
    notifUpdated.textContent = "Actualizado: " + new Date().toLocaleTimeString();
  }

  // =========================
  // Listeners
  // =========================
  btnBack.onclick = () => {
    if (auth?.role === "ADMIN") {
      window.location.href = "../index.html";
    } else {
      window.location.href = "../auth/login.html";
    }
  };

  // =========================
  // Boot
  // =========================
  (async function init() {
    auth = await requireLogistica();
    if (!auth) return;

    if (calWeekdaysEl) {
      calWeekdaysEl.innerHTML = WEEKDAYS.map(w => `<div class="cal-mini-weekday">${w}</div>`).join("");
    }

    try {
      await loadMonthServiceDays();
      selectedDateKey = ymd(new Date());
      renderCalendarMini();
    } catch (e) {
      console.error("Scale calendar error:", e);
    }

    await refreshNotifications();
  })();

})();
