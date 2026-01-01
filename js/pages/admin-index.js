/* /js/pages/admin-index.js */

(function() {
  const client = window.supabaseClient;

  // =========================
  // State
  // =========================
  let sessionRef = null;
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

  const notifList = document.getElementById("notifList");
  const notifUpdated = document.getElementById("notifUpdated");
  const notifError = document.getElementById("notifError");
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
    try {
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
    } catch (e) {
      console.error("Error loading service days:", e);
    }
  }

  async function countSolicitudesPendientes() {
    try {
      const res = await client
        .from("inventory_purchase_requests")
        .select("id", { count: "exact", head: true })
        .in("status", ["SUBMITTED", "PARTIAL_ACTION"]);
      return res.count || 0;
    } catch (e) { return 0; }
  }

  async function countMovimientosPendientes() {
    try {
      const res = await client
        .from("inventory_movements")
        .select("id", { count: "exact", head: true })
        .eq("status", "PENDING");
      return res.count || 0;
    } catch (e) { return 0; }
  }

  async function countPagosPendientes() {
    try {
      const res = await client
        .from("finance_payments")
        .select("id", { count: "exact", head: true })
        .eq("status", "PENDING");
      return res.count || 0;
    } catch (e) { return 0; }
  }

  // =========================
  // Calendar Rendering
  // =========================
  function renderCalendarMini(){
    if (!calMonthEl || !calGridEl) return;
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
  // Notifications Rendering
  // =========================
  function renderNotifs({ solicitudes, movimientos, pagos }) {
    const items = [
      { label: "SOLICITUDES PENDIENTES", count: solicitudes },
      { label: "MOVIMIENTOS PENDIENTES", count: movimientos },
      { label: "PAGOS PENDIENTES", count: pagos }
    ];

    notifList.innerHTML = "";
    items.forEach(it => {
      const li = document.createElement("li");
      li.className = "notif-item";
      li.innerHTML = `
        <div class="notif-left"><span class="notif-text">${it.label}</span></div>
        <span class="notif-value">${String(it.count)}</span>
      `;
      notifList.appendChild(li);
    });

    notifUpdated.textContent = `Actualizado: ${new Date().toLocaleTimeString("es-AR")}`;
  }

  // =========================
  // Listeners
  // =========================
  if (btnBack) {
    btnBack.onclick = () => window.location.href = "../index.html";
  }

  // =========================
  // Init
  // =========================
  (async function init() {
    try {
      sessionRef = await requireAdmin();
      if (!sessionRef) return;

      if (calWeekdaysEl) {
        calWeekdaysEl.innerHTML = WEEKDAYS.map(w => `<div class="cal-mini-weekday">${w}</div>`).join("");
      }

      notifError.classList.add("is-hidden");
      notifUpdated.textContent = "Actualizando...";

      await loadMonthServiceDays();
      selectedDateKey = ymd(new Date());
      renderCalendarMini();

      const [solicitudes, movimientos, pagos] = await Promise.all([
        countSolicitudesPendientes(),
        countMovimientosPendientes(),
        countPagosPendientes()
      ]);

      renderNotifs({ solicitudes, movimientos, pagos });
    } catch (e) {
      console.error(e);
      if (notifUpdated) notifUpdated.textContent = "Error de sincronización";
      if (notifError) {
        notifError.classList.remove("is-hidden");
        notifError.textContent = "No se pudieron cargar las alertas de administración.";
      }
    }
  })();
})();
