/* /js/pages/logistica-reposicion.js */

(function() {
    const client = window.supabaseClient;

    document.getElementById("btnBack").addEventListener("click", () => {
      window.location.href = "logistica-index.html";
    });

    async function requireLogistica() {
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

      if (profErr || !prof?.role || !["LOGISTICA","OPERATIVO","STAFF","ADMIN"].includes(prof.role.toUpperCase())) {
        try { await client.auth.signOut(); } catch {}
        window.location.replace("../auth/login.html");
        return null;
      }

      return session;
    }

    const statusEl = document.getElementById("statusLine");
    const tbody = document.querySelector("#repTable tbody");

    let sessionRef = null;

    // UI lines:
    // { line_id, request_id, sku_id, name, external_id, pack_size, expected_units, expected_packs, stock_actual }
    let pendingLines = [];

    function setStatus(msg){ statusEl.textContent = msg || ""; }

    function escapeHtml(str) {
      return String(str ?? "")
        .replaceAll("&","&amp;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;")
        .replaceAll('"',"&quot;")
        .replaceAll("'","&#039;");
    }

    function num(v, fallback = 0) {
      const n = Number(String(v ?? "").replace(",", "."));
      return Number.isFinite(n) ? n : fallback;
    }

    function int(v, fallback = 0) {
      const n = parseInt(String(v ?? ""), 10);
      return Number.isFinite(n) ? n : fallback;
    }

    function keyReqSku(requestId, skuId) {
      return `${requestId}:${skuId}`;
    }

    async function loadReposiciones() {
      setStatus("Cargando reposiciones...");

      try {
        // 1) Requests que tienen líneas aprobadas
        const { data: reqs, error: reqErr } = await client
          .from("inventory_purchase_requests")
          .select("id,status,created_at")
          .in("status", ["APPROVED","PARTIAL_ACTION"])
          .order("created_at", { ascending: true });

        if (reqErr) throw reqErr;

        const reqIds = (reqs || []).map(r => r.id);
        if (!reqIds.length) {
          pendingLines = [];
          setStatus("");
          render();
          return;
        }

        // 2) Líneas aprobadas (lo que se espera recibir)
        // Adjusting columns for Anti-g project schema: inventory_sku (singular), nombre, sku
        const { data: lines, error: linesErr } = await client
          .from("inventory_purchase_request_lines")
          .select(`
            id,request_id,sku_id,requested_packs,status,
            inventory_sku:sku_id (id, nombre, sku, pack_size)
          `)
          .in("request_id", reqIds)
          .eq("status", "APPROVED");

        if (linesErr) throw linesErr;

        if (!lines?.length) {
          pendingLines = [];
          setStatus("");
          render();
          return;
        }

        const skuIds = [...new Set(lines.map(l => l.sku_id))];

        // 3) Stock actual para preparar movimiento
        const stockBySku = new Map();
        if (skuIds.length) {
          const { data: cur, error: curErr } = await client
            .from("inventory_stock_current")
            .select("sku_id,stock_actual")
            .in("sku_id", skuIds);

          if (!curErr) (cur || []).forEach(r => stockBySku.set(r.sku_id, num(r.stock_actual, 0)));
        }

        // 4) Recibos SUBMITTED ya cargados
        const { data: receipts, error: recErr } = await client
          .from("inventory_purchase_receipts")
          .select("id,request_id,status")
          .in("request_id", reqIds)
          .eq("status", "SUBMITTED");

        if (recErr) throw recErr;

        const receiptIds = (receipts || []).map(r => r.id);
        const receiptReqById = new Map((receipts || []).map(r => [r.id, r.request_id]));

        const receivedByReqSku = new Map(); // request:sku -> sum(received_units)
        if (receiptIds.length) {
          const { data: rLines, error: rLinesErr } = await client
            .from("inventory_purchase_receipt_lines")
            .select("receipt_id,sku_id,received_units")
            .in("receipt_id", receiptIds);

          if (rLinesErr) throw rLinesErr;

          (rLines || []).forEach(rl => {
            const reqId = receiptReqById.get(rl.receipt_id);
            if (!reqId) return;
            const k = keyReqSku(reqId, rl.sku_id);
            const prev = receivedByReqSku.get(k) || 0;
            receivedByReqSku.set(k, prev + num(rl.received_units, 0));
          });
        }

        // 5) Armar lista pendiente (remaining units > 0)
        pendingLines = (lines || []).map(l => {
          const sku = l.inventory_sku || {};
          const ps = Math.max(1, int(sku.pack_size, 1));
          const packs = Math.max(0, int(l.requested_packs, 0));
          const expected = packs * ps;

          const receivedSum = receivedByReqSku.get(keyReqSku(l.request_id, l.sku_id)) || 0;
          const remaining = Math.max(0, expected - receivedSum);

          const remainingPacks = Math.ceil(remaining / ps);

          return {
            line_id: l.id,
            request_id: l.request_id,
            sku_id: l.sku_id,
            name: sku.nombre || "-",
            external_id: sku.sku || "-",
            pack_size: ps,
            expected_units: remaining,
            expected_packs: remainingPacks,
            stock_actual: stockBySku.get(l.sku_id) ?? 0
          };
        }).filter(x => x.expected_units > 0);

        setStatus("");
        render();
      } catch (e) {
        console.error(e);
        setStatus("Error: " + (e.message || "Error al cargar reposiciones."));
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Error al cargar.</td></tr>`;
      }
    }

    async function createReceiptAndMovement(line, diffUnits) {
      const expectedUnits = num(line.expected_units, 0);
      const diff = num(diffUnits, 0);
      const receivedUnits = Math.max(0, expectedUnits + diff);

      if (receivedUnits <= 0) {
        alert("La recepción no puede ser 0.");
        return false;
      }

      if (receivedUnits !== expectedUnits) {
        const ok = confirm(`Confirmar recepción con diferencia.\nEsperado: ${expectedUnits}\nRecibido: ${receivedUnits}`);
        if (!ok) return false;
      }

      // 1) Crear receipt SUBMITTED
      const { data: receipt, error: recErr } = await client
        .from("inventory_purchase_receipts")
        .insert({
          request_id: line.request_id,
          received_by: sessionRef.user.id,
          status: "SUBMITTED"
        })
        .select("id")
        .single();

      if (recErr) throw recErr;

      // 2) Crear receipt_line
      const { error: rlErr } = await client
        .from("inventory_purchase_receipt_lines")
        .insert({
          receipt_id: receipt.id,
          sku_id: line.sku_id,
          expected_packs: Math.max(0, int(line.expected_packs, 0)),
          expected_units: expectedUnits,
          received_units: receivedUnits
        });

      if (rlErr) throw rlErr;

      // 3) Crear movimiento pendiente para admin-movimientos
      const observed = num(line.stock_actual, 0);
      const target = observed + receivedUnits;

      const note =
        `PURCHASE_RECEIPT|REQ:${line.request_id}|LINE:${line.line_id}` +
        `|RECEIPT:${receipt.id}|EXPECTED:${expectedUnits}|DIFF:${diff}|RECEIVED:${receivedUnits}`;

      const { error: mErr } = await client
        .from("inventory_movements")
        .insert({
          sku_id: line.sku_id,
          observed_stock: observed,
          ajustar: receivedUnits,
          target_stock: target,
          status: "PENDING",
          note,
          created_by: sessionRef.user.id
        });

      if (mErr) throw mErr;

      return true;
    }

    function render() {
      if (!pendingLines.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No hay reposiciones pendientes.</td></tr>`;
        return;
      }

      tbody.innerHTML = "";

      pendingLines.forEach(line => {
        const tr = document.createElement("tr");
        tr.className = "list-row";

        const tdName = document.createElement("td");
        tdName.className = "cell-pl";
        tdName.innerHTML = `
          <div class="row-title">${escapeHtml(line.name)}</div>
          <div class="row-sub-text">COD: ${escapeHtml(line.external_id)} — REQ: ${escapeHtml(line.request_id.slice(0,8))}</div>
        `;

        const tdPacks = document.createElement("td");
        tdPacks.className = "text-center";
        tdPacks.innerHTML = `<span class="row-sub-text">${escapeHtml(String(line.expected_packs || 0))}</span>`;

        const tdUnits = document.createElement("td");
        tdUnits.className = "text-center";
        tdUnits.innerHTML = `<span class="row-sub-text">${escapeHtml(String(line.expected_units || 0))}</span>`;

        const tdDiff = document.createElement("td");
        tdDiff.className = "text-center";
        const inDiff = document.createElement("input");
        inDiff.type = "number";
        inDiff.step = "1";
        inDiff.className = "table-input table-input--narrow";
        inDiff.value = "0";
        tdDiff.appendChild(inDiff);

        const tdCheck = document.createElement("td");
        tdCheck.className = "text-center cell-pr";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-primary";
        btn.textContent = "Check";
        tdCheck.appendChild(btn);

        btn.addEventListener("click", async () => {
          try {
            btn.disabled = true;
            inDiff.disabled = true;
            setStatus("Enviando a Movimientos...");

            const ok = await createReceiptAndMovement(line, inDiff.value);
            if (!ok) {
              btn.disabled = false;
              inDiff.disabled = false;
              setStatus("");
              return;
            }

            pendingLines = pendingLines.filter(x => x.line_id !== line.line_id);
            render();
            setStatus("Enviado.");
          } catch (e) {
            console.error(e);
            setStatus("Error: " + e.message);
            btn.disabled = false;
            inDiff.disabled = false;
          }
        });

        tr.append(tdName, tdPacks, tdUnits, tdDiff, tdCheck);
        tbody.appendChild(tr);
      });
    }

    (async function init() {
      try {
        sessionRef = await requireLogistica();
        if (!sessionRef) return;

        await loadReposiciones();
      } catch (e) {
        console.error(e);
        // requireLogistica handles redirects
      }
    })();
})();
