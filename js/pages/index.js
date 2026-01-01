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
