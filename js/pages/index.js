    const client = window.supabaseClient;

    async function checkAccess() {
      if (!client) {
        window.location.replace("./auth/login.html");
        return;
      }

      const { data: sessData } = await client.auth.getSession();
      if (!sessData?.session) {
        window.location.replace("./auth/login.html");
        return;
      }

      const { data: prof, error } = await client
        .from("profiles")
        .select("role")
        .eq("id", sessData.session.user.id)
        .single();

      if (error || !prof) {
        window.location.replace("./auth/login.html");
        return;
      }

      const role = prof.role.toUpperCase();
      
      // Si es LOGISTICA, no entra al portal, va directo a su dashboard
      if (role === "LOGISTICA") {
        window.location.replace("./logistica/logistica-index.html");
        return;
      }
      
      // Otros roles (Operativo/Staff) tal vez también deban ser redirigidos si el portal es solo Admin
      if (role === "OPERATIVO") {
        window.location.replace("./operativo/operativo-index.html");
        return;
      }
      if (role === "STAFF") {
        window.location.replace("./staff/staff-index.html");
        return;
      }

      // Si llegamos acá es ADMIN o similar, mostramos el portal
      document.body.classList.remove("is-hidden");
    }

    checkAccess();

    document.getElementById("btnBack").addEventListener("click", () => {
      window.location.href = "./auth/login.html";
    });

    const calMonthEl = document.getElementById("calMonth");
    const calWeekdaysEl = document.getElementById("calWeekdays");
    const calGridEl = document.getElementById("calGrid");

    const WEEKDAYS = ["L","M","X","J","V","S","D"]; // lunes-first

    function renderWeekdays() {
      calWeekdaysEl.innerHTML = "";
      WEEKDAYS.forEach(ch => {
        const d = document.createElement("div");
        d.className = "cal-mini-weekday";
        d.textContent = ch;
        calWeekdaysEl.appendChild(d);
      });
    }

    function monthLabel(date) {
      return date.toLocaleString("es-AR", { month: "long" }).toUpperCase();
    }

    function renderCalendarMini() {
      if (!calMonthEl || !calGridEl || !calWeekdaysEl) return;

      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth(); // 0-11

      calMonthEl.textContent = monthLabel(now);

      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0);
      const daysInMonth = last.getDate();

      // JS getDay(): domingo=0 ... sábado=6  -> queremos lunes=0
      const startOffset = (first.getDay() + 6) % 7;

      const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

      calGridEl.innerHTML = "";

      for (let i = 0; i < totalCells; i++) {
        const dayNum = i - startOffset + 1;

        const cell = document.createElement("div");
        cell.className = "cal-mini-day";

        if (dayNum < 1 || dayNum > daysInMonth) {
          cell.classList.add("is-empty");
          cell.textContent = "";
        } else {
          cell.textContent = String(dayNum);

          const isToday =
            dayNum === now.getDate() &&
            m === now.getMonth() &&
            y === now.getFullYear();

          if (isToday) cell.classList.add("is-today");
        }

        calGridEl.appendChild(cell);
      }
    }

    renderWeekdays();
    renderCalendarMini();
