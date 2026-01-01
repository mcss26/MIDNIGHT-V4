/* /js/pages/master-analisis.js */

(function() {
    // =========================
    // Header / Auth guard
    // =========================
    document.getElementById("btnBack").addEventListener("click", () => {
      window.location.href = "master-index.html";
    });

    async function requireAdmin() {
      if (!window.supabaseClient) { window.location.replace("../auth/login.html"); return null; }

      const { data: sessData } = await window.supabaseClient.auth.getSession();
      const session = sessData?.session;
      if (!session?.user?.id) { window.location.replace("../auth/login.html"); return null; }

      const { data: prof, error: profErr } = await window.supabaseClient
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (profErr || prof?.role?.toUpperCase() !== "ADMIN") {
        try { await window.supabaseClient.auth.signOut(); } catch {}
        window.location.replace("../auth/login.html");
        return null;
      }

      return session;
    }

    // =========================
    // Tabs
    // =========================
    const tabBtnImports = document.getElementById("tabBtnImports");
    const tabBtnStock = document.getElementById("tabBtnStock");
    const panelImports = document.getElementById("panelImports");
    const panelStock = document.getElementById("panelStock");

    function setActiveTab(tab) {
      const isImports = tab === "imports";
      panelImports.hidden = !isImports;
      panelStock.hidden = isImports;

      tabBtnImports.classList.toggle("active", isImports);
      tabBtnStock.classList.toggle("active", !isImports);
    }

    tabBtnImports.addEventListener("click", () => setActiveTab("imports"));
    tabBtnStock.addEventListener("click", () => setActiveTab("stock"));

    // =========================
    // IMPORT TAB - UI refs
    // =========================
    const statusLineImports = document.getElementById("statusLineImports");
    const importLabel = document.getElementById("importLabel");
    const btnNewImport = document.getElementById("btnNewImport");
    const btnUploadConsumo = document.getElementById("btnUploadConsumo");
    const btnUploadRecaud = document.getElementById("btnUploadRecaud");
    const btnFinalize = document.getElementById("btnFinalize");
    const fileConsumo = document.getElementById("fileConsumo");
    const fileRecaud = document.getElementById("fileRecaud");

    const step1 = document.getElementById("step1");
    const step2 = document.getElementById("step2");
    const step3 = document.getElementById("step3");
    const step4 = document.getElementById("step4");

    const currentBox = document.getElementById("currentBox");
    const curImportId = document.getElementById("curImportId");
    const curImportLabel = document.getElementById("curImportLabel");
    const curHasConsumo = document.getElementById("curHasConsumo");
    const curHasRecaud = document.getElementById("curHasRecaud");
    const curStatusTag = document.getElementById("curStatusTag");

    const importsTbody = document.querySelector("#importsTable tbody");

    // =========================
    // STOCK TAB - UI refs
    // =========================
    const statusLineStock = document.getElementById("statusLineStock");
    const readyImportsTbody = document.querySelector("#readyImportsTable tbody");
    const resultsTbody = document.querySelector("#resultsTable tbody");

    const btnSelectLast1 = document.getElementById("btnSelectLast1");
    const btnSelectLast3 = document.getElementById("btnSelectLast3");
    const btnSelectLast5 = document.getElementById("btnSelectLast5");
    const btnClearSelection = document.getElementById("btnClearSelection");

    const chkIncludeZero = document.getElementById("chkIncludeZero");
    const btnCalcAll = document.getElementById("btnCalcAll");
    const btnSendStockIdeal = document.getElementById("btnSendStockIdeal");

    const sumSelectedImports = document.getElementById("sumSelectedImports");
    const sumValidNights = document.getElementById("sumValidNights");
    const sumRowsRead = document.getElementById("sumRowsRead");
    const sumUnmapped = document.getElementById("sumUnmapped");
    const sumSkusComputed = document.getElementById("sumSkusComputed");
    const sumSkusTotal = document.getElementById("sumSkusTotal");

    const resultsFilter = document.getElementById("resultsFilter");
    const btnPrevPage = document.getElementById("btnPrevPage");
    const btnNextPage = document.getElementById("btnNextPage");
    const pageInfo = document.getElementById("pageInfo");

    // =========================
    // State
    // =========================
    // Import tab
    let currentImport = null; // {id,label,status}
    let currentFiles = { CONSUMO: null, RECAUDACION: null };

    // Stock tab
    let readyImports = []; // [{id,label,created_at}]
    let selectedImportIds = new Set();
    let consumoFileByImport = new Map(); // import_id -> file_id (CONSUMO)

    let skusAll = []; // [{id,name,external_id}]
    let skuByExternalId = new Map(); // external_id -> {id,name,external_id}
    let skuById = new Map(); // sku_id -> {id,name,external_id}
    let stockIdealBySkuId = new Map(); // sku_id -> stock_ideal

    let lastComputedRows = []; // [{sku_id, sku_name, external_id, total, d}]
    let lastMeta = { validNights: 0, rowsRead: 0, unmapped: 0 };

    // paging/filter
    let pageSize = 50;
    let currentPage = 1;

    // =========================
    // Helpers (shared)
    // =========================
    function fmtDate(ts) {
      try {
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return "-";
        return d.toLocaleString("es-AR", { year:"2-digit", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
      } catch { return "-"; }
    }

    function parseNum(v) {
      if (v === null || v === undefined) return null;
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      const s = String(v).trim();
      if (!s) return null;
      const cleaned = s.replace(/\s+/g, "").replace(",", ".");
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    }

    async function sha256Hex(arrayBuffer) {
      const hashBuf = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const bytes = new Uint8Array(hashBuf);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    function normExternalId(v) {
      let s = String(v ?? "").trim();
      if (!s) return "";
      s = s.replace(/\.0$/g, "");
      return s;
    }

    // =========================
    // IMPORT TAB - helpers
    // =========================
    function setStatusImports(msg, isBad = false) {
      statusLineImports.textContent = msg || "";
      statusLineImports.classList.toggle("is-bad", !!isBad);
    }

    function ensureCurrentImport() {
      if (!currentImport?.id) {
        alert("Primero creá un import.");
        return false;
      }
      return true;
    }

    function syncStepsAndButtons() {
      const hasImport = !!currentImport?.id;
      const hasCons = !!currentFiles.CONSUMO;
      const hasRec  = !!currentFiles.RECAUDACION;
      const isReady = String(currentImport?.status || "").toUpperCase() === "READY";

      step1.classList.toggle("is-done", hasImport);
      step2.classList.toggle("is-done", hasCons);
      step3.classList.toggle("is-done", hasRec);
      step4.classList.toggle("is-done", isReady);

      btnUploadConsumo.disabled = !hasImport || hasCons;
      btnUploadRecaud.disabled = !hasImport || hasRec;
      btnFinalize.disabled = !hasImport || !hasCons || !hasRec || isReady;

      btnUploadConsumo.textContent = hasCons ? "Consumo cargado" : "Subir Consumo";
      btnUploadRecaud.textContent = hasRec ? "Recaudación cargada" : "Subir Recaudación";
      btnFinalize.textContent = isReady ? "Finalizado" : "Finalizar";
    }

    async function refreshCurrentFiles(importId) {
      const { data, error } = await window.supabaseClient
        .from("analysis_import_files")
        .select("id,import_id,file_type,original_filename,sha256,created_at")
        .eq("import_id", importId);

      if (error) throw error;

      currentFiles = { CONSUMO: null, RECAUDACION: null };
      (data || []).forEach(f => { currentFiles[f.file_type] = f; });

      currentBox.hidden = false;
      curImportId.textContent = currentImport.id;
      curImportLabel.textContent = currentImport.label || "-";
      curHasConsumo.textContent = currentFiles.CONSUMO ? (currentFiles.CONSUMO.original_filename || "OK") : "FALTA";
      curHasRecaud.textContent = currentFiles.RECAUDACION ? (currentFiles.RECAUDACION.original_filename || "OK") : "FALTA";

      const st = (currentImport.status || "DRAFT").toUpperCase();
      curStatusTag.textContent = st;
      curStatusTag.className = "tag " + (st === "READY" ? "tag-green" : st === "ERROR" ? "tag-red" : "tag-gray");

      syncStepsAndButtons();
    }

    function pickSheetName(workbook) {
      const names = workbook.SheetNames || [];
      return names[0] || null;
    }

    function normKey(s) {
      return String(s || "")
        .trim()
        .toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Z0-9]/g, "");
    }

    function findHeaderRow(rows, requiredKeys) {
      const req = requiredKeys.map(normKey);
      const max = Math.min(rows.length, 60);

      for (let r = 0; r < max; r++) {
        const row = rows[r] || [];
        const set = new Set(row.map(c => normKey(c)));
        const ok = req.every(k => set.has(k));
        if (ok) return r;
      }
      return -1;
    }

    function buildHeaderIndex(headerRow) {
      const idx = {};
      (headerRow || []).forEach((cell, i) => {
        const k = normKey(cell);
        if (!k) return;
        if (idx[k] === undefined) idx[k] = i;
      });
      return idx;
    }

    function getCell(row, headerIdx, keyCandidates) {
      for (const k of keyCandidates) {
        const kk = normKey(k);
        const i = headerIdx[kk];
        if (i !== undefined) return row[i];
      }
      return "";
    }

    // =========================
    // IMPORT TAB - Create import
    // =========================
    async function createImport() {
      setStatusImports("Creando import...");

      const label = (importLabel.value || "").trim() || null;

      const { data, error } = await window.supabaseClient
        .from("analysis_imports")
        .insert({ label, status: "DRAFT" })
        .select("id,label,status,created_at")
        .single();

      if (error) throw error;

      currentImport = data;
      await refreshCurrentFiles(currentImport.id);
      await loadImportsTable();

      setStatusImports("Import creado. Subí Consumo y Recaudación.");
    }

    // =========================
    // IMPORT TAB - Upload + parse
    // =========================
    async function registerFile(importId, fileType, file) {
      const buf = await file.arrayBuffer();
      const hash = await sha256Hex(buf);

      const payload = {
        import_id: importId,
        file_type: fileType,
        original_filename: file.name || (fileType + ".xlsx"),
        mime_type: file.type || null,
        byte_size: file.size || null,
        sha256: hash
      };

      const { data, error } = await window.supabaseClient
        .from("analysis_import_files")
        .insert(payload)
        .select("id,import_id,file_type,original_filename,sha256,created_at")
        .single();

      if (error) {
        const msg = (error.message || "").toLowerCase();
        if (String(error.code) === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
          if (msg.includes("sha256")) throw new Error("Este archivo ya fue cargado antes (repetido).");
          throw new Error("Este import ya tiene un archivo de ese tipo.");
        }
        throw error;
      }

      return { fileRow: data, arrayBuffer: buf };
    }

    async function parseAndInsertConsumo(importFileId, arrayBuffer) {
      const wb = XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = pickSheetName(wb);
      if (!sheetName) throw new Error("El XLSX no tiene hojas.");

      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      const hdrRowIdx = findHeaderRow(rows, ["Articulo", "Detalle", "Cantidad"]);
      if (hdrRowIdx < 0) throw new Error("No encontré encabezados de Consumo (Articulo/Detalle/Cantidad).");

      const headerIdx = buildHeaderIndex(rows[hdrRowIdx]);

      const out = [];
      for (let r = hdrRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const articulo = String(getCell(row, headerIdx, ["Articulo", "Codigo", "SKU", "ID"]) || "").trim();
        const detalle = String(getCell(row, headerIdx, ["Detalle", "ArticuloDetalle", "Insumo"]) || "").trim();

        const cantidad = parseNum(getCell(row, headerIdx, ["Cantidad", "Unidades", "QTotal"]));
        const cUnit = parseNum(getCell(row, headerIdx, ["C.Unitario", "CUnitario", "Unitario"]));
        const cTot  = parseNum(getCell(row, headerIdx, ["C.Total", "CTotal", "Total"]));

        const any = articulo || detalle || (cantidad !== null) || (cTot !== null);
        if (!any) continue;

        out.push({
          import_file_id: importFileId,
          row_num: r + 1,
          articulo: articulo || null,
          detalle: detalle || null,
          cantidad: cantidad,
          c_unitario: cUnit,
          c_total: cTot
        });
      }

      if (!out.length) throw new Error("Consumo: no encontré filas de datos.");

      const batchSize = 500;
      for (let i = 0; i < out.length; i += batchSize) {
        const batch = out.slice(i, i + batchSize);
        const { error } = await window.supabaseClient.from("analysis_consumo_raw").insert(batch);
        if (error) throw error;
      }

      return out.length;
    }

    async function parseAndInsertRecaud(importFileId, arrayBuffer) {
      const wb = XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = pickSheetName(wb);
      if (!sheetName) throw new Error("El XLSX no tiene hojas.");

      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      const hdrRowIdx = findHeaderRow(rows, ["Codigo", "Articulo", "Total Caja"]);
      if (hdrRowIdx < 0) throw new Error("No encontré encabezados de Recaudación (Codigo/Articulo/Total Caja).");

      const headerIdx = buildHeaderIndex(rows[hdrRowIdx]);

      const out = [];
      for (let r = hdrRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];

        const codigo = String(getCell(row, headerIdx, ["Codigo", "Cod", "ID"]) || "").trim();
        const articulo = String(getCell(row, headerIdx, ["Articulo", "Detalle"]) || "").trim();
        const qPaga = parseNum(getCell(row, headerIdx, ["Q Paga", "QPaga", "QPAGAS"]));
        const qSin = parseNum(getCell(row, headerIdx, ["Q Sin Cargo", "QSinCargo"]));
        const qVip = parseNum(getCell(row, headerIdx, ["Q Tarj.VIP", "QTarjVIP", "QVIP"]));
        const totalCaja = parseNum(getCell(row, headerIdx, ["Total Caja", "TotalCaja", "Importe", "Recaudacion"]));

        const any = codigo || articulo || (totalCaja !== null) || (qPaga !== null);
        if (!any) continue;

        out.push({
          import_file_id: importFileId,
          row_num: r + 1,
          codigo: codigo || null,
          articulo: articulo || null,
          q_paga: qPaga,
          q_sin_cargo: qSin,
          q_tarj_vip: qVip,
          total_caja: totalCaja
        });
      }

      if (!out.length) throw new Error("Recaudación: no encontré filas de datos.");

      const batchSize = 500;
      for (let i = 0; i < out.length; i += batchSize) {
        const batch = out.slice(i, i + batchSize);
        const { error } = await window.supabaseClient.from("analysis_recaudacion_raw").insert(batch);
        if (error) throw error;
      }

      return out.length;
    }

    async function uploadAndProcess(fileType, file) {
      if (!ensureCurrentImport()) return;

      setStatusImports(`Procesando ${fileType}...`);

      try {
        const { fileRow, arrayBuffer } = await registerFile(currentImport.id, fileType, file);

        let rowsInserted = 0;
        if (fileType === "CONSUMO") rowsInserted = await parseAndInsertConsumo(fileRow.id, arrayBuffer);
        else rowsInserted = await parseAndInsertRecaud(fileRow.id, arrayBuffer);

        setStatusImports(`${fileType} OK. Filas cargadas: ${rowsInserted}.`);
        await refreshCurrentFiles(currentImport.id);
        await loadImportsTable();
        await loadReadyImportsForStockTab();

      } catch (e) {
        console.error(e);
        setStatusImports(String(e.message || e), true);

        try {
          await window.supabaseClient.from("analysis_imports").update({ status: "ERROR" }).eq("id", currentImport.id);
          currentImport.status = "ERROR";
          await refreshCurrentFiles(currentImport.id);
          await loadImportsTable();
          await loadReadyImportsForStockTab();
        } catch {}
      }
    }

    // =========================
    // IMPORT TAB - Finalize
    // =========================
    async function finalizeImport() {
      if (!ensureCurrentImport()) return;

      await refreshCurrentFiles(currentImport.id);

      if (!currentFiles.CONSUMO || !currentFiles.RECAUDACION) {
        setStatusImports("Falta subir Consumo y/o Recaudación.", true);
        return;
      }

      setStatusImports("Finalizando...");
      const { error } = await window.supabaseClient
        .from("analysis_imports")
        .update({ status: "READY" })
        .eq("id", currentImport.id);

      if (error) { setStatusImports("No se pudo finalizar.", true); return; }

      currentImport.status = "READY";
      await refreshCurrentFiles(currentImport.id);
      await loadImportsTable();
      await loadReadyImportsForStockTab();

      setStatusImports("Import finalizado (READY).");
    }

    // =========================
    // IMPORT TAB - Imports list
    // =========================
    async function loadImportsTable() {
      const { data: imports, error } = await window.supabaseClient
        .from("analysis_imports")
        .select("id,label,status,created_at")
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) {
        importsTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted table-loading">Error al cargar.</td></tr>`;
        return;
      }

      const ids = (imports || []).map(x => x.id);
      let filesByImport = {};
      if (ids.length) {
        const { data: files, error: fe } = await window.supabaseClient
          .from("analysis_import_files")
          .select("import_id,file_type,original_filename,created_at")
          .in("import_id", ids);

        if (!fe) {
          filesByImport = {};
          (files || []).forEach(f => {
            if (!filesByImport[f.import_id]) filesByImport[f.import_id] = { CONSUMO: null, RECAUDACION: null };
            filesByImport[f.import_id][f.file_type] = f;
          });
        }
      }

      if (!imports || !imports.length) {
        importsTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted table-loading">Sin imports aún.</td></tr>`;
        return;
      }

      importsTbody.innerHTML = "";
      imports.forEach(imp => {
        const fx = filesByImport[imp.id] || { CONSUMO: null, RECAUDACION: null };
        const st = (imp.status || "DRAFT").toUpperCase();
        const stTag = st === "READY" ? "tag-green" : st === "ERROR" ? "tag-red" : "tag-gray";

        const tr = document.createElement("tr");
        tr.className = "list-row";

        tr.innerHTML = `
          <td class="cell-pl">${fmtDate(imp.created_at)}</td>
          <td>${imp.label || "-"}</td>
          <td><span class="tag ${stTag}">${st}</span></td>
          <td>${fx.CONSUMO ? (fx.CONSUMO.original_filename || "OK") : "-"}</td>
          <td>${fx.RECAUDACION ? (fx.RECAUDACION.original_filename || "OK") : "-"}</td>
          <td class="text-right cell-pr"></td>
        `;

        const tdActions = tr.querySelector("td.cell-pr");
        const btnUse = document.createElement("button");
        btnUse.type = "button";
        btnUse.className = "btn-soft";
        btnUse.textContent = "Usar";
        btnUse.addEventListener("click", async () => {
          currentImport = { id: imp.id, label: imp.label, status: imp.status };
          await refreshCurrentFiles(currentImport.id);
          setStatusImports("Import seleccionado.");
        });
        tdActions.appendChild(btnUse);

        importsTbody.appendChild(tr);
      });
    }

    // =========================
    // STOCK TAB - helpers
    // =========================
    function setStatusStock(msg, isBad = false) {
      statusLineStock.textContent = msg || "";
      statusLineStock.classList.toggle("is-bad", !!isBad);
    }

    function updateStockSummary({ selected, validNights, rowsRead, unmapped, skusComputed, skusTotal } = {}) {
      if (selected !== undefined) sumSelectedImports.textContent = String(selected);
      if (validNights !== undefined) sumValidNights.textContent = String(validNights);
      if (rowsRead !== undefined) sumRowsRead.textContent = String(rowsRead);
      if (unmapped !== undefined) sumUnmapped.textContent = String(unmapped);
      if (skusComputed !== undefined) sumSkusComputed.textContent = String(skusComputed);
      if (skusTotal !== undefined) sumSkusTotal.textContent = String(skusTotal);
    }

    function renderReadyImportsTable() {
      if (!readyImports.length) {
        readyImportsTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No hay imports READY.</td></tr>`;
        return;
      }

      readyImportsTbody.innerHTML = "";
      readyImports.forEach((imp) => {
        const tr = document.createElement("tr");
        tr.className = "list-row";

        const isChecked = selectedImportIds.has(imp.id);
        const hasConsumo = consumoFileByImport.has(imp.id);

        tr.innerHTML = `
          <td class="cell-pl"></td>
          <td>${fmtDate(imp.created_at)}</td>
          <td>${imp.label || "-"}</td>
          <td><span class="tag tag-gray">#${String(imp.id).slice(0, 8)}</span></td>
          <td>${hasConsumo ? `<span class="tag tag-green">OK</span>` : `<span class="tag tag-red">FALTA</span>`}</td>
        `;

        const tdSel = tr.children[0];
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = isChecked;
        cb.addEventListener("change", () => {
          if (cb.checked) selectedImportIds.add(imp.id);
          else selectedImportIds.delete(imp.id);

          updateStockSummary({ selected: selectedImportIds.size });
          btnSendStockIdeal.disabled = true;
        });
        tdSel.appendChild(cb);

        readyImportsTbody.appendChild(tr);
      });

      updateStockSummary({ selected: selectedImportIds.size });
    }

    async function loadSkuMapAndStockIdeals() {
      setStatusStock("Cargando SKUs y stock...");
      try {
        const { data, error } = await window.supabaseClient
          .from("inventory_sku")
          .select("id,nombre,sku,is_active,stock_ideal")
          .order("nombre", { ascending: true });

        if (error) throw error;

        skusAll = (data || []).map(s => ({
          id: s.id,
          name: s.nombre || "-",
          external_id: normExternalId(s.sku)
        }));

        skuByExternalId = new Map();
        skuById = new Map();
        stockIdealBySkuId = new Map();

        (data || []).forEach(s => {
          const normCode = normExternalId(s.sku);
          const obj = { id: s.id, name: s.nombre || "-", external_id: normCode };
          if (normCode) skuByExternalId.set(normCode, obj);
          skuById.set(s.id, obj);
          stockIdealBySkuId.set(s.id, parseNum(s.stock_ideal) ?? 0);
        });

        updateStockSummary({ skusTotal: skusAll.length });
        setStatusStock("");
      } catch (e) {
        console.error(e);
        setStatusStock("Error cargando SKUs/stock.", true);
      }
    }

    async function loadReadyImportsForStockTab() {
      setStatusStock("Cargando web imports READY...");
      try {
        const { data, error } = await window.supabaseClient
          .from("analysis_imports")
          .select("id,label,status,created_at")
          .eq("status", "READY")
          .order("created_at", { ascending: false })
          .limit(200);

        if (error) throw error;

        readyImports = data || [];

        consumoFileByImport.clear();
        if (readyImports.length) {
          const ids = readyImports.map(x => x.id);
          const { data: files, error: fe } = await window.supabaseClient
            .from("analysis_import_files")
            .select("id,import_id,file_type")
            .in("import_id", ids)
            .eq("file_type", "CONSUMO");

          if (fe) throw fe;

          (files || []).forEach(f => consumoFileByImport.set(f.import_id, f.id));
        }

        const idSet = new Set(readyImports.map(x => x.id));
        selectedImportIds = new Set(Array.from(selectedImportIds).filter(id => idSet.has(id)));

        renderReadyImportsTable();
        setStatusStock("");
      } catch (e) {
        console.error(e);
        readyImportsTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Error al cargar READY.</td></tr>`;
        setStatusStock("Error cargando imports READY.", true);
      }
    }

    function getFilteredRows() {
      const term = (resultsFilter.value || "").toLowerCase().trim();
      if (!term) return lastComputedRows;

      return lastComputedRows.filter(r => {
        const n = String(r.sku_name || "").toLowerCase();
        const c = String(r.external_id || "").toLowerCase();
        return n.includes(term) || c.includes(term);
      });
    }

    function renderResultsPage() {
      const rows = getFilteredRows();
      const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
      currentPage = Math.max(1, Math.min(currentPage, totalPages));

      const start = (currentPage - 1) * pageSize;
      const page = rows.slice(start, start + pageSize);

      pageInfo.textContent = `${currentPage}/${totalPages}`;

      if (!rows.length) {
        resultsTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Sin resultados.</td></tr>`;
        return;
      }

      resultsTbody.innerHTML = "";
      page.forEach(r => {
        const currentIdeal = stockIdealBySkuId.has(r.sku_id) ? stockIdealBySkuId.get(r.sku_id) : null;
        const curText = currentIdeal === null ? "-" : String(currentIdeal);

        const tr = document.createElement("tr");
        tr.className = "list-row";
        tr.innerHTML = `
          <td class="cell-pl"><div class="row-title">${String(r.sku_name || "-")}</div></td>
          <td><span class="row-sub-text">${String(r.external_id || "-")}</span></td>
          <td class="text-right"><span class="row-sub-text">${r.total.toFixed(2)}</span></td>
          <td class="text-right"><span class="row-sub-text">${r.d.toFixed(2)}</span></td>
          <td class="text-right"><span class="row-sub-text">${curText}</span></td>
          <td class="text-right cell-pr"><span class="row-sub-text">${r.d.toFixed(2)}</span></td>
        `;
        resultsTbody.appendChild(tr);
      });
    }

    async function calcAllStockIdeal() {
      const ids = Array.from(selectedImportIds);
      if (!ids.length) {
        setStatusStock("Seleccioná al menos 1 import READY.", true);
        return;
      }

      setStatusStock("Calculando...");
      btnSendStockIdeal.disabled = true;

      try {
        const { data: files, error: fe } = await window.supabaseClient
          .from("analysis_import_files")
          .select("id,import_id,file_type")
          .in("import_id", ids)
          .eq("file_type", "CONSUMO");

        if (fe) throw fe;

        const fileRows = (files || []);
        const validImportIds = Array.from(new Set(fileRows.map(f => f.import_id)));
        const validNights = validImportIds.length;

        if (!validNights) {
          setStatusStock("Los imports seleccionados no tienen archivo CONSUMO.", true);
          lastComputedRows = [];
          lastMeta = { validNights: 0, rowsRead: 0, unmapped: 0 };
          updateStockSummary({ validNights: 0, rowsRead: 0, unmapped: 0, skusComputed: 0 });
          renderResultsPage();
          return;
        }

        const fileIds = fileRows.map(f => f.id);

        // leer consumo raw paginado y sumar por sku
        const pageSizeDb = 1000;
        let rowsRead = 0;
        let unmapped = 0;
        const totalsBySkuId = new Map(); // sku_id -> totalCantidad

        const fileChunks = [];
        for (let i = 0; i < fileIds.length; i += 100) fileChunks.push(fileIds.slice(i, i + 100));

        for (const chunk of fileChunks) {
          let from = 0;
          while (true) {
            const to = from + pageSizeDb - 1;
            const { data, error } = await window.supabaseClient
              .from("analysis_consumo_raw")
              .select("articulo,cantidad")
              .in("import_file_id", chunk)
              .range(from, to);

            if (error) throw error;

            const batch = data || [];
            rowsRead += batch.length;

            for (const row of batch) {
              const code = normExternalId(row.articulo);
              const qty = parseNum(row.cantidad);
              if (!code) continue;
              if (qty === null || qty <= 0) continue;

              const sku = skuByExternalId.get(code);
              if (!sku) { unmapped++; continue; }

              const prev = totalsBySkuId.get(sku.id) || 0;
              totalsBySkuId.set(sku.id, prev + qty);
            }

            if (batch.length < pageSizeDb) break;
            from += pageSizeDb;
          }
        }

        const includeZero = !!chkIncludeZero.checked;

        // armar filas para TODOS (si includeZero), o solo consumidos
        const rows = [];
        if (includeZero) {
          for (const sku of skusAll) {
            const total = totalsBySkuId.get(sku.id) || 0;
            const d = total / validNights;
            rows.push({
              sku_id: sku.id,
              sku_name: sku.name,
              external_id: sku.external_id || "-",
              total: total,
              d: d
            });
          }
        } else {
          for (const [sku_id, total] of totalsBySkuId.entries()) {
            const sku = skuById.get(sku_id) || { name: "-", external_id: "-" };
            const d = total / validNights;
            rows.push({
              sku_id,
              sku_name: sku.name || "-",
              external_id: sku.external_id || "-",
              total,
              d
            });
          }
        }

        // ordenar por D desc (para que arriba estén los que más consumís)
        rows.sort((a, b) => b.d - a.d);

        lastComputedRows = rows;
        lastMeta = { validNights, rowsRead, unmapped };

        updateStockSummary({
          selected: selectedImportIds.size,
          validNights,
          rowsRead,
          unmapped,
          skusComputed: rows.length,
          skusTotal: skusAll.length
        });

        currentPage = 1;
        renderResultsPage();

        btnSendStockIdeal.disabled = rows.length === 0;
        setStatusStock("Listo.");
      } catch (e) {
        console.error(e);
        setStatusStock("Error al calcular.", true);
        btnSendStockIdeal.disabled = true;
      }
    }

    async function sendStockIdeal() {
      if (!lastComputedRows.length) return;

      setStatusStock("Enviando a inventory_sku...");
      btnSendStockIdeal.disabled = true;

      try {
        const chunkSize = 500;
        for (let i = 0; i < lastComputedRows.length; i += chunkSize) {
          const chunk = lastComputedRows.slice(i, i + chunkSize).map(r => {
            const sInfo = skuById.get(r.sku_id);
            return {
              id: r.sku_id,
              stock_ideal: Number(r.d.toFixed(2)),
              nombre: sInfo?.name || "-",
              sku: sInfo?.external_id || "-"
            };
          });

          const { error } = await window.supabaseClient
            .from("inventory_sku")
            .upsert(chunk, { onConflict: "id" });

          if (error) throw error;

          chunk.forEach(p => stockIdealBySkuId.set(p.id, p.stock_ideal));
        }

        setStatusStock("OK. Stock ideal actualizado (D en inventory_sku).");
        renderResultsPage();
      } catch (e) {
        console.error(e);
        setStatusStock("No se pudo escribir inventory_sku.", true);
      } finally {
        btnSendStockIdeal.disabled = false;
      }
    }

    function selectLastN(n) {
      selectedImportIds.clear();
      const pick = readyImports.slice(0, Math.max(0, n));
      pick.forEach(i => selectedImportIds.add(i.id));
      renderReadyImportsTable();
      btnSendStockIdeal.disabled = true;
    }

    // =========================
    // IMPORT TAB - listeners
    // =========================
    btnNewImport.addEventListener("click", async () => {
      try {
        btnNewImport.disabled = true;
        await createImport();
      } catch (e) {
        console.error(e);
        setStatusImports("No se pudo crear el import.", true);
      } finally {
        btnNewImport.disabled = false;
      }
    });

    btnUploadConsumo.addEventListener("click", () => {
      if (!ensureCurrentImport()) return;
      if (btnUploadConsumo.disabled) return;
      fileConsumo.value = "";
      fileConsumo.click();
    });

    btnUploadRecaud.addEventListener("click", () => {
      if (!ensureCurrentImport()) return;
      if (btnUploadRecaud.disabled) return;
      fileRecaud.value = "";
      fileRecaud.click();
    });

    fileConsumo.addEventListener("change", async (ev) => {
      const f = ev.target.files?.[0];
      if (!f) return;
      await uploadAndProcess("CONSUMO", f);
    });

    fileRecaud.addEventListener("change", async (ev) => {
      const f = ev.target.files?.[0];
      if (!f) return;
      await uploadAndProcess("RECAUDACION", f);
    });

    btnFinalize.addEventListener("click", async () => {
      try {
        btnFinalize.disabled = true;
        await finalizeImport();
      } finally {
        syncStepsAndButtons();
        btnFinalize.disabled = false;
      }
    });

    document.addEventListener("keydown", (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "enter") {
        if (!panelImports.hidden && currentImport?.id) finalizeImport();
      }
    });

    // =========================
    // STOCK TAB - listeners
    // =========================
    btnSelectLast1.addEventListener("click", () => selectLastN(1));
    btnSelectLast3.addEventListener("click", () => selectLastN(3));
    btnSelectLast5.addEventListener("click", () => selectLastN(5));

    btnClearSelection.addEventListener("click", () => {
      selectedImportIds.clear();
      renderReadyImportsTable();
      btnSendStockIdeal.disabled = true;
      setStatusStock("");
      updateStockSummary({ selected: 0 });
    });

    btnCalcAll.addEventListener("click", async () => {
      await calcAllStockIdeal();
    });

    btnSendStockIdeal.addEventListener("click", async () => {
      await sendStockIdeal();
    });

    resultsFilter.addEventListener("input", () => {
      currentPage = 1;
      renderResultsPage();
    });

    btnPrevPage.addEventListener("click", () => {
      currentPage = Math.max(1, currentPage - 1);
      renderResultsPage();
    });

    btnNextPage.addEventListener("click", () => {
      const rows = getFilteredRows();
      const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
      currentPage = Math.min(totalPages, currentPage + 1);
      renderResultsPage();
    });

    // =========================
    // Boot
    // =========================
    (async function init() {
      try {
        setActiveTab("imports");
        if (!window.supabaseClient) {
          window.location.replace("../auth/login.html");
          return;
        }
        await requireAdmin();

        // Import tab
        await loadImportsTable();
        syncStepsAndButtons();
        setStatusImports("Listo. Creá un import y subí los 2 XLSX.");

        // Stock tab
        updateStockSummary({ selected: 0, validNights: 0, rowsRead: 0, unmapped: 0, skusComputed: 0, skusTotal: 0 });
        await loadSkuMapAndStockIdeals();
        await loadReadyImportsForStockTab();

      } catch (e) {
        console.error(e);
        try { if (window.supabaseClient) await window.supabaseClient.auth.signOut(); } catch {}
        window.location.replace("../auth/login.html");
      }
    })();
})();
