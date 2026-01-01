/* /js/pages/master-sku.js */

(function() {
    // Sync with Anti-g Project Schema: Singular table and localized names
    const T_SKU = "inventory_sku";

    document.getElementById("btnBack").addEventListener("click", () => {
      window.location.href = "master-index.html";
    });

    async function requireAdmin() {
      if (!window.supabaseClient) {
        window.location.replace("../auth/login.html");
        return null;
      }

      const { data: sessData } = await window.supabaseClient.auth.getSession();
      const session = sessData?.session;

      if (!session?.user?.id) {
        window.location.replace("../auth/login.html");
        return null;
      }

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

    const tbody = document.querySelector("#skuTable tbody");
    const statusEl = document.getElementById("skusStatus");
    const searchInput = document.getElementById("searchSkus");
    const showInactiveCheckbox = document.getElementById("showInactive");
    const newSkuBtn = document.getElementById("newSkuBtn");

    let currentCategory = "ALL";
    const KNOWN_CATEGORIES = ["BEBIDAS","INSUMOS BARRA","LIMPIEZA","LIBRERIA","MANTENIMIENTO"];

    const modal = document.getElementById("skuModal");
    const modalTitle = document.getElementById("modalTitle");
    const modalSubtitle = document.getElementById("modalSubtitle");
    const toggleActiveBtn = document.getElementById("toggleActiveBtn");
    const cancelModalBtn = document.getElementById("cancelModalBtn");
    const saveSkuBtn = document.getElementById("saveSkuBtn");

    const skuIdEl = document.getElementById("skuId");
    const skuNameEl = document.getElementById("skuName");
    const skuExternalIdEl = document.getElementById("skuExternalId");
    const skuCategoryEl = document.getElementById("skuCategory");
    const skuUnitTypeEl = document.getElementById("skuUnitType");
    const skuVolumeEl = document.getElementById("skuVolume");
    const skuPreferredSupplierEl = document.getElementById("skuPreferredSupplier");
    const skuStockIdealEl = document.getElementById("skuStockIdeal");
    const skuPackSizeEl = document.getElementById("skuPackSize");
    const skuCostUnitEl = document.getElementById("skuCostUnit");
    const skuCostPackEl = document.getElementById("skuCostPack");
    const skuIsActiveEl = document.getElementById("skuIsActive");

    let allSkus = [];
    let supplierNameById = new Map();

    let openSkuId = null;
    let openDetailsRow = null;

    function escapeHtml(str) {
      return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function parseNum(v) {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(String(v).replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }

    function calcPackCost(packSize, costUnit, packCost) {
      const explicit = parseNum(packCost);
      if (explicit !== null) return explicit;

      const ps = parseNum(packSize);
      const cu = parseNum(costUnit);
      if (ps !== null && cu !== null && ps >= 1) return ps * cu;
      return null;
    }

    function openModal() {
      modal.style.display = "flex";
      modal.setAttribute("aria-hidden", "false");
    }

    function closeModal() {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      skuIdEl.value = "";
      toggleActiveBtn.style.display = "none";
    }

    function closeDetails() {
      if (openSkuId) {
        const prevRow = tbody.querySelector(`tr.list-row[data-id="${openSkuId}"]`);
        if (prevRow) prevRow.classList.remove("is-selected");
      }
      openSkuId = null;

      if (openDetailsRow && openDetailsRow.parentNode) {
        openDetailsRow.parentNode.removeChild(openDetailsRow);
      }
      openDetailsRow = null;
    }

    function toggleDetailsFor(id, rowEl) {
      if (openSkuId === id) {
        closeDetails();
        return;
      }

      closeDetails();
      openSkuId = id;
      rowEl.classList.add("is-selected");

      const sku = allSkus.find(x => x.id === id);
      if (!sku) return;

      const supplierName = sku.preferred_supplier_id
        ? (supplierNameById.get(sku.preferred_supplier_id) || "—")
        : "—";

      openDetailsRow = document.createElement("tr");
      openDetailsRow.className = "details-row";

      const td = document.createElement("td");
      td.colSpan = 5;

      const estadoTag = `<span class="tag ${sku.is_active === false ? "tag-red" : "tag-green"}">
        ${sku.is_active === false ? "INACTIVO" : "ACTIVO"}
      </span>`;

      td.innerHTML = `
        <div class="details-wrap">
          <div class="details-grid">
            <div class="kv"><div class="k">Categoría</div><div class="v">${escapeHtml(sku.categoria || "—")}</div></div>
            <div class="kv"><div class="k">Unidad base</div><div class="v">${escapeHtml(sku.unidad_medida || "—")}</div></div>
            <div class="kv"><div class="k">Volumen por unidad</div><div class="v">${sku.volume_ml ? escapeHtml(String(sku.volume_ml) + " ml") : "—"}</div></div>
            <div class="kv"><div class="k">Proveedor</div><div class="v">${escapeHtml(supplierName)}</div></div>
          </div>

          <div class="details-actions">
            <div class="left">${estadoTag}</div>
            <button type="button" class="btn-secondary" data-action="edit">Editar</button>
            <button type="button" class="${sku.is_active === false ? "btn-secondary" : "btn-danger"}" data-action="toggle">
              ${sku.is_active === false ? "Reactivar" : "Inactivar"}
            </button>
          </div>
        </div>
      `;

      openDetailsRow.appendChild(td);
      rowEl.insertAdjacentElement("afterend", openDetailsRow);

      openDetailsRow.querySelector('[data-action="edit"]').addEventListener("click", (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        openEditModal(id);
      });

      openDetailsRow.querySelector('[data-action="toggle"]').addEventListener("click", async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        await setSkuActive(id, sku.is_active === false);
      });
    }

    async function loadSuppliersActive() {
      const { data, error } = await window.supabaseClient
        .from("suppliers")
        .select("id,nombre,is_active")
        .eq("is_active", true)
        .order("nombre", { ascending: true });

      if (error) throw error;

      supplierNameById.clear();
      (data || []).forEach(s => supplierNameById.set(s.id, s.nombre || "—"));

      skuPreferredSupplierEl.innerHTML = '<option value="">Sin asignar</option>';
      (data || []).forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.nombre || "—";
        skuPreferredSupplierEl.appendChild(opt);
      });
    }

    async function loadData() {
      statusEl.textContent = "Cargando SKUs...";

      try {
        await loadSuppliersActive();

        // Fetch from inventory_sku (Anti-g project schema)
        const { data, error } = await window.supabaseClient
            .from(T_SKU)
            .select("id, nombre, sku, categoria, unidad_medida, volume_ml, pack_size, cost_price, pack_cost, preferred_supplier_id, is_active, stock_ideal")
            .order("nombre", { ascending: true });

        if (error) throw error;

        allSkus = data || [];

        statusEl.textContent = "";
        renderTable();
      } catch (err) {
        console.error(err);
        statusEl.textContent = "Error al cargar datos.";
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:40px;">Error al cargar.</td></tr>`;
      }
    }

    function getFiltered() {
      const term = (searchInput.value || "").toLowerCase().trim();
      const showInactive = showInactiveCheckbox.checked;

      return allSkus.filter(sku => {
        if (!showInactive && sku.is_active === false) return false;

        if (currentCategory !== "ALL") {
          const cat = (sku.categoria || "").trim();

          if (currentCategory === "OTROS") {
            if (KNOWN_CATEGORIES.includes(cat)) return false;
          } else {
            if (cat !== currentCategory) return false;
          }
        }

        if (!term) return true;

        const nameOk = (sku.nombre || "").toLowerCase().includes(term);
        const codeOk = (sku.sku || "").toLowerCase().includes(term);
        return nameOk || codeOk;
      });
    }

    function renderTable() {
      closeDetails();

      const rows = getFiltered();
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:30px;">No hay resultados.</td></tr>`;
        return;
      }

      tbody.innerHTML = "";
      rows.forEach(sku => {
        const stockIdeal = sku.stock_ideal || 0;

        const packSize = sku.pack_size ?? null;
        const costUnit = sku.cost_price ?? 0;
        const packCostCalc = calcPackCost(packSize, costUnit, sku.pack_cost);

        const tr = document.createElement("tr");
        tr.className = "list-row";
        tr.tabIndex = 0;
        tr.dataset.id = sku.id;

        tr.addEventListener("click", () => toggleDetailsFor(sku.id, tr));
        tr.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            toggleDetailsFor(sku.id, tr);
          }
        });

        const tdName = document.createElement("td");
        tdName.className = "cell-pl";
        const offTag = sku.is_active === false ? ' <span class="tag tag-red">OFF</span>' : '';
        tdName.innerHTML = `
          <div class="row-title">${escapeHtml(sku.nombre || "-")}${offTag}</div>
          <div class="row-sub-text">COD: ${escapeHtml(sku.sku || "-")}</div>
        `;

        const tdStock = document.createElement("td");
        tdStock.className = "text-center";
        tdStock.innerHTML = `
          <input
            type="number"
            class="table-input table-input--narrow"
            value="${Number(stockIdeal) || 0}"
            min="0"
            step="0.01"
            data-inline="stock_ideal"
          />
        `;

        const tdPack = document.createElement("td");
        tdPack.className = "text-center";
        tdPack.innerHTML = `
          <input
            type="number"
            class="table-input table-input--narrow"
            value="${packSize ?? ""}"
            min="1"
            step="1"
            placeholder="-"
            data-inline="pack_size"
          />
        `;

        const tdCostU = document.createElement("td");
        tdCostU.className = "text-right";
        tdCostU.innerHTML = `
          <input
            type="number"
            class="table-input table-input--narrow"
            value="${costUnit ?? 0}"
            min="0"
            step="0.01"
            data-inline="cost_price"
          />
        `;

        const tdCostP = document.createElement("td");
        tdCostP.className = "text-right cell-pr";
        tdCostP.innerHTML = `
          <input
            type="number"
            class="table-input table-input--narrow"
            value="${sku.pack_cost ?? ""}"
            min="0"
            step="0.01"
            placeholder="${packCostCalc !== null ? escapeHtml(String(packCostCalc.toFixed(2))) : "-"}"
            data-inline="pack_cost"
          />
        `;

        tr.append(tdName, tdStock, tdPack, tdCostU, tdCostP);
        tbody.appendChild(tr);

        tr.querySelectorAll('input[data-inline]').forEach(inp => {
          inp.addEventListener("click", (ev) => ev.stopPropagation());
          inp.addEventListener("keydown", (ev) => ev.stopPropagation());

          inp.addEventListener("change", async (ev) => {
            ev.stopPropagation();
            const field = inp.getAttribute("data-inline");
            await updateInline(sku.id, field, inp.value);
          });
        });
      });
    }

    async function updateInline(skuId, field, value) {
      try {
        if (field === "stock_ideal") {
          const num = parseNum(value) ?? 0;
          const { error } = await window.supabaseClient.from(T_SKU).update({ stock_ideal: num }).eq("id", skuId);
          if (error) throw error;

          const target = allSkus.find(x => x.id === skuId);
          if (target) target.stock_ideal = num;
          return;
        }

        if (field === "pack_size") {
          const n = value === "" ? null : (parseInt(value, 10) || null);
          const { error } = await window.supabaseClient.from(T_SKU).update({ pack_size: n }).eq("id", skuId);
          if (error) throw error;

          const target = allSkus.find(x => x.id === skuId);
          if (target) target.pack_size = n;
          renderTable();
          return;
        }

        if (field === "cost_price") {
          const n = parseNum(value) ?? 0;
          const { error } = await window.supabaseClient.from(T_SKU).update({ cost_price: n }).eq("id", skuId);
          if (error) throw error;

          const target = allSkus.find(x => x.id === skuId);
          if (target) target.cost_price = n;
          renderTable();
          return;
        }

        if (field === "pack_cost") {
          const n = value === "" ? null : (parseNum(value) ?? null);
          const { error } = await window.supabaseClient.from(T_SKU).update({ pack_cost: n }).eq("id", skuId);
          if (error) throw error;

          const target = allSkus.find(x => x.id === skuId);
          if (target) target.pack_cost = n;
          renderTable();
          return;
        }
      } catch (e) {
        console.error(e);
        alert("Error al guardar cambio.");
        await loadData();
      }
    }

    async function setSkuActive(id, makeActive) {
      const sku = allSkus.find(x => x.id === id);
      if (!sku) return;

      const label = makeActive ? "reactivar" : "inactivar";
      const ok = confirm(`¿${label.toUpperCase()} SKU "${sku.nombre}"?`);
      if (!ok) return;

      try {
        const { error } = await window.supabaseClient
          .from(T_SKU)
          .update({ is_active: !!makeActive })
          .eq("id", id);

        if (error) throw error;

        closeModal();
        await loadData();
      } catch (e) {
        console.error(e);
        alert("No se pudo actualizar el estado.");
      }
    }

    function openCreateModal() {
      skuIdEl.value = "";
      modalTitle.textContent = "NUEVO SKU";
      modalSubtitle.textContent = "Crear nuevo SKU.";
      toggleActiveBtn.style.display = "none";

      skuNameEl.value = "";
      skuExternalIdEl.value = "";
      skuCategoryEl.value = "";
      skuUnitTypeEl.value = "";
      skuVolumeEl.value = "";
      skuPreferredSupplierEl.value = "";
      skuStockIdealEl.value = "0";
      skuPackSizeEl.value = "";
      skuCostUnitEl.value = "0";
      skuCostPackEl.value = "";
      skuIsActiveEl.checked = true;

      openModal();
    }

    function openEditModal(id) {
      const sku = allSkus.find(x => x.id === id);
      if (!sku) return;

      skuIdEl.value = sku.id;
      modalTitle.textContent = "EDITAR SKU";
      modalSubtitle.textContent = "Editar SKU existente.";

      skuNameEl.value = sku.nombre || "";
      skuExternalIdEl.value = sku.sku || "";
      skuCategoryEl.value = sku.categoria || "";
      skuUnitTypeEl.value = sku.unidad_medida || "";
      skuVolumeEl.value = sku.volume_ml ?? "";
      skuPreferredSupplierEl.value = sku.preferred_supplier_id || "";
      skuStockIdealEl.value = String(sku.stock_ideal || 0);
      skuPackSizeEl.value = sku.pack_size ?? "";
      skuCostUnitEl.value = sku.cost_price ?? 0;
      skuCostPackEl.value = sku.pack_cost ?? "";
      skuIsActiveEl.checked = sku.is_active !== false;

      toggleActiveBtn.style.display = "inline-flex";
      if (sku.is_active === false) {
        toggleActiveBtn.className = "btn-secondary";
        toggleActiveBtn.textContent = "Reactivar";
      } else {
        toggleActiveBtn.className = "btn-danger";
        toggleActiveBtn.textContent = "Inactivar";
      }

      openModal();
    }

    async function handleSaveSku() {
      const id = skuIdEl.value || null;

      const nombre = (skuNameEl.value || "").trim().toUpperCase();
      if (!nombre) return alert("El nombre es obligatorio.");

      const sku = (skuExternalIdEl.value || "").trim() || null;
      const categoria = skuCategoryEl.value || null;
      const unidad_medida = skuUnitTypeEl.value || null;

      const volume_ml = skuVolumeEl.value === "" ? null : (parseInt(skuVolumeEl.value, 10) || null);
      const preferred_supplier_id = skuPreferredSupplierEl.value || null;

      const stock_ideal = parseNum(skuStockIdealEl.value) ?? 0;

      const pack_size = skuPackSizeEl.value === "" ? null : (parseInt(skuPackSizeEl.value, 10) || null);
      if (pack_size !== null && pack_size < 1) return alert("Unidades por pack debe ser >= 1.");

      const cost_price = parseNum(skuCostUnitEl.value) ?? 0;
      const pack_cost = skuCostPackEl.value === "" ? null : (parseNum(skuCostPackEl.value) ?? null);

      const is_active = !!skuIsActiveEl.checked;

      const payload = {
        nombre,
        sku,
        categoria,
        unidad_medida,
        volume_ml,
        preferred_supplier_id,
        pack_size,
        cost_price,
        pack_cost,
        is_active,
        stock_ideal
      };

      try {
        saveSkuBtn.disabled = true;
        saveSkuBtn.textContent = "Guardando...";

        let error;
        if (!id) {
          ({ error } = await window.supabaseClient.from(T_SKU).insert(payload));
        } else {
          ({ error } = await window.supabaseClient.from(T_SKU).update(payload).eq("id", id));
        }

        if (error) throw error;

        closeModal();
        await loadData();
      } catch (e) {
        console.error(e);
        alert("Error al guardar: " + (e?.message || "desconocido"));
      } finally {
        saveSkuBtn.disabled = false;
        saveSkuBtn.textContent = "Guardar";
      }
    }

    function attachListeners() {
      newSkuBtn.addEventListener("click", openCreateModal);

      cancelModalBtn.addEventListener("click", closeModal);
      saveSkuBtn.addEventListener("click", handleSaveSku);

      toggleActiveBtn.addEventListener("click", async () => {
        const id = skuIdEl.value;
        if (!id) return;
        const sku = allSkus.find(x => x.id === id);
        if (!sku) return;
        await setSkuActive(id, sku.is_active === false);
      });

      searchInput.addEventListener("input", renderTable);
      showInactiveCheckbox.addEventListener("change", renderTable);

      document.querySelectorAll("#categoryTabs .tab-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          document.querySelectorAll("#categoryTabs .tab-btn").forEach(b => b.classList.remove("active"));
          e.currentTarget.classList.add("active");
          currentCategory = e.currentTarget.dataset.cat || "ALL";
          renderTable();
        });
      });

      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") {
          if (modal.style.display === "flex") closeModal();
          else closeDetails();
        }
      });

      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) closeModal();
      });
    }

    (async function init() {
      try {
        await requireAdmin();
        attachListeners();
        await loadData();
      } catch (e) {
        console.error(e);
        try { if (window.supabaseClient) await window.supabaseClient.auth.signOut(); } catch {}
        window.location.replace("../auth/login.html");
      }
    })();

})();
