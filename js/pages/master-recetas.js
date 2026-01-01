/* /js/pages/master-recetas.js */

(function() {
  // =========================
  // DB mapping (Anti-g project)
  // =========================
  const DB = {
    menuTable: "menu_items",
    menuCols: { id:"id", name:"name", category:"category", price:"price", is_active:"is_active" },

    ingTable: "recipe_ingredients",
    ingCols: { 
      id: "id", 
      menu_item_id: "menu_item_id", 
      sku_id: "inventory_sku_id", // Anti-g uses inventory_sku_id
      qty: "quantity"             // Anti-g uses quantity
    },

    skuTable: "inventory_sku", // Anti-g uses inventory_sku (singular)
    skuCols: {
      id: "id",
      name: "nombre",          // Anti-g uses nombre
      external_id: "sku",      // Anti-g uses sku as the external id
      cost_price: "cost_price",
      volume_ml: "volume_ml",
      unit_type: "unidad_medida", // Anti-g uses unidad_medida
      is_active: "is_active"
    }
  };

  const GLASS_ML = 400;

  // =========================
  // State
  // =========================
  let menuItems = [];
  let skuOptions = [];
  let skusById = new Map();
  let ingredients = [];
  let currentItemId = null;
  let menuSearchTerm = "";

  // =========================
  // UI Refs
  // =========================
  const statusLine = document.getElementById("statusLine");
  const menuListEl = document.getElementById("menuList");
  const countMenuEl = document.getElementById("countMenu");
  const searchMenuEl = document.getElementById("searchMenu");
  const emptyState = document.getElementById("emptyState");
  const recipePanel = document.getElementById("recipePanel");
  const viewName = document.getElementById("viewName");
  const viewMeta = document.getElementById("viewMeta");
  const viewPrice = document.getElementById("viewPrice");
  const saveStatus = document.getElementById("saveStatus");
  const pillRecipeState = document.getElementById("pillRecipeState");
  const pillActive = document.getElementById("pillActive");
  const btnNewItem = document.getElementById("btnNewItem");
  const btnEditItem = document.getElementById("btnEditItem");
  const btnToggleItem = document.getElementById("btnToggleItem");
  const kpiCost = document.getElementById("kpiCost");
  const kpiCostPct = document.getElementById("kpiCostPct");
  const kpiMargin = document.getElementById("kpiMargin");
  const kpiMarginPct = document.getElementById("kpiMarginPct");
  const volText = document.getElementById("volText");
  const volFill = document.getElementById("volFill");
  const ingCount = document.getElementById("ingCount");
  const ingTbody = document.getElementById("ingTableBody");
  const skuFilter = document.getElementById("skuFilter");
  const selSku = document.getElementById("selSku");
  const newQty = document.getElementById("newQty");
  const newUnit = document.getElementById("newUnit");
  const btnAddIng = document.getElementById("btnAddIng");

  // =========================
  // Auth & Init
  // =========================
  async function requireAdmin() {
    const client = window.supabaseClient;
    if (!client) { window.location.replace("../auth/login.html"); return null; }
    
    const { data: sessData } = await client.auth.getSession();
    const session = sessData?.session;
    if (!session) { window.location.replace("../auth/login.html"); return null; }

    const { data: prof } = await client.from("profiles").select("role").eq("id", session.user.id).single();
    if (prof?.role?.toUpperCase() !== "ADMIN") {
      try { await client.auth.signOut(); } catch {}
      window.location.replace("../auth/login.html");
      return null;
    }
    return session;
  }

  // =========================
  // Helpers
  // =========================
  function setStatus(msg, bad = false) {
    statusLine.textContent = msg || "";
    statusLine.className = "status-line" + (bad ? " is-bad" : "");
  }

  function escapeHtml(str) {
    return String(str ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  }

  function fmtMoney(v, decimals = 0) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function showRecipePanel(show) {
    emptyState.style.display = show ? "none" : "flex";
    recipePanel.className = show ? "" : "is-hidden";
  }

  function getCurrentItem() {
    return menuItems.find(x => String(x[DB.menuCols.id]) === String(currentItemId)) || null;
  }

  function getFilteredMenu() {
    const term = (menuSearchTerm || "").toLowerCase().trim();
    if (!term) return menuItems;
    return menuItems.filter(i => (i[DB.menuCols.name] || "").toLowerCase().includes(term));
  }

  function updateMenuCount() {
    countMenuEl.textContent = `${getFilteredMenu().length} items`;
  }

  // =========================
  // Rendering
  // =========================
  function renderMenuList() {
    const rows = getFilteredMenu();
    updateMenuCount();

    if (!rows.length) {
      menuListEl.innerHTML = `<div class="recipes-muted">Sin resultados.</div>`;
      return;
    }

    menuListEl.innerHTML = "";
    rows.forEach(item => {
      const id = String(item[DB.menuCols.id]);
      const name = item[DB.menuCols.name] || "-";
      const isActive = item[DB.menuCols.is_active];
      const price = Number(item[DB.menuCols.price] || 0);

      const row = document.createElement("div");
      row.className = "menu-item-row" + (String(currentItemId) === id ? " active" : "");
      
      row.innerHTML = `
        <div class="menu-item-left">
          <div class="menu-item-title">
            <span>${escapeHtml(name)}</span>
            ${isActive ? "" : `<span class="tag tag-red small">OFF</span>`}
          </div>
          <div class="menu-item-sub">$${fmtMoney(price, 0)}</div>
        </div>
        <span class="tag tag-gray">#${id.slice(0,8)}</span>
      `;

      row.onclick = () => selectItem(id);
      menuListEl.appendChild(row);
    });
  }

  function renderSkuSelect() {
    selSku.innerHTML = `<option value="">— Seleccionar insumo —</option>` +
      skuOptions.map(s => `
        <option value="${s.id}">${s[DB.skuCols.name]} (${s[DB.skuCols.external_id] || "S/S"})${s[DB.skuCols.volume_ml] ? ` · ${s[DB.skuCols.volume_ml]}ml` : ""}</option>
      `).join("");
  }

  function calcRecipe(ings) {
    let totalCost = 0;
    let totalVol = 0;

    ings.forEach(ing => {
      const sku = skusById.get(String(ing.sku_id)) || null;
      const qty = Number(ing.quantity) || 0;
      
      if (!sku) return;

      const skuCost = Number(sku[DB.skuCols.cost_price] || 0);
      const skuVol = Number(sku[DB.skuCols.volume_ml] || 0);
      const isLiquid = (sku[DB.skuCols.unit_type] || "").toLowerCase() === "ml" || skuVol > 0;

      let lineCost = 0;
      if (isLiquid && skuVol > 0) {
        lineCost = (skuCost / skuVol) * qty;
        totalVol += qty;
      } else {
        lineCost = skuCost * qty;
        if (skuVol > 0) totalVol += skuVol * qty; // If it's a "pack" (un) that has volume
      }
      totalCost += lineCost;
    });

    return { totalCost, totalVol };
  }

  function updateKPIs(costValue) {
    const price = Number(viewPrice.value || 0);
    const cost = Number(costValue || 0);
    const margin = price - cost;
    const costPct = price > 0 ? (cost / price) * 100 : 0;
    const marginPct = price > 0 ? (margin / price) * 100 : 0;

    kpiCost.textContent = `$${fmtMoney(cost, 2)}`;
    kpiCostPct.textContent = `${costPct.toFixed(1)}%`;
    kpiMargin.textContent = `$${fmtMoney(margin, 2)}`;
    kpiMarginPct.textContent = `${marginPct.toFixed(1)}%`;

    kpiMarginPct.style.color = marginPct < 30 ? "var(--accent-red)" : (marginPct > 70 ? "var(--accent-green)" : "inherit");
  }

  const deleteIcon = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>
    </svg>
  `;

  function updateVolumeBar(ml) {
    const vol = Number(ml || 0);
    const pct = Math.max(0, Math.min((vol / GLASS_ML) * 100, 100));
    volText.textContent = `${Math.round(vol)} ml`;
    volFill.style.width = `${pct}%`;
    volFill.style.background = vol > GLASS_ML ? "var(--accent-red)" : "var(--accent-green)";
  }

  function renderIngredients() {
    if (!ingredients.length) {
      ingTbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Sin ingredientes.</td></tr>`;
      pillRecipeState.className = "tag tag-gray";
      pillRecipeState.textContent = "SIN RECETA";
      ingCount.textContent = "0 insumos";
      updateKPIs(0);
      updateVolumeBar(0);
      return;
    }

    pillRecipeState.className = "tag tag-green";
    pillRecipeState.textContent = "CON RECETA";
    ingCount.textContent = `${ingredients.length} insumos`;

    const { totalCost, totalVol } = calcRecipe(ingredients);
    updateKPIs(totalCost);
    updateVolumeBar(totalVol);

    ingTbody.innerHTML = ingredients.map(ing => {
      const sku = skusById.get(String(ing.sku_id)) || null;
      const name = sku ? sku[DB.skuCols.name] : "(Insumo no encontrado)";
      const type = sku ? sku[DB.skuCols.unit_type] : "-";
      const baseCost = sku ? Number(sku[DB.skuCols.cost_price] || 0) : 0;
      const skuVol = sku ? Number(sku[DB.skuCols.volume_ml] || 0) : 0;
      
      let lineCost = 0;
      if (sku) {
        if (skuVol > 0 && (type.toLowerCase() === "ml" || skuVol > 0)) {
          lineCost = (baseCost / skuVol) * ing.quantity;
        } else {
          lineCost = baseCost * ing.quantity;
        }
      }

      return `
        <tr class="list-row">
          <td class="cell-pl">
            <div class="row-title">${escapeHtml(name)}</div>
          </td>
          <td class="text-center">${escapeHtml(type)}</td>
          <td class="text-right">$${fmtMoney(baseCost, 2)}</td>
          <td class="text-center">
            <input type="number" class="table-input" value="${ing.quantity}" onchange="updateIngQty('${ing.id}', this.value)" step="0.01" min="0">
          </td>
          <td class="text-center">${escapeHtml(type.toLowerCase() === "ml" ? "ml" : "un")}</td>
          <td class="text-right">$${fmtMoney(lineCost, 2)}</td>
          <td class="text-center cell-pr">
            <button class="btn-action-delete" onclick="deleteIng('${ing.id}')" title="Quitar">
              ${deleteIcon}
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // =========================
  // CRUD
  // =========================
  async function loadInitialData() {
    const client = window.supabaseClient;
    setStatus("Cargando...");
    try {
      const [resMenu, resSkus] = await Promise.all([
        client.from(DB.menuTable).select("*").order("name", { ascending: true }),
        client.from(DB.skuTable).select("*").eq("is_active", true).order("nombre", { ascending: true })
      ]);

      if (resMenu.error) throw resMenu.error;
      if (resSkus.error) throw resSkus.error;

      menuItems = resMenu.data || [];
      skuOptions = resSkus.data || [];
      skusById = new Map(skuOptions.map(s => [String(s.id), s]));

      renderMenuList();
      renderSkuSelect();
      setStatus("");
    } catch (e) {
      console.error(e);
      setStatus("Error al cargar maestros", true);
    }
  }

  async function loadIngredients(menuId) {
    const client = window.supabaseClient;
    try {
      const { data, error } = await client.from(DB.ingTable)
        .select(`*`)
        .eq("menu_item_id", menuId);

      if (error) throw error;
      
      ingredients = data || [];
      
      // Ensure skus for ingredients are in our map (case they were inactive)
      const missingIds = ingredients.map(ing => ing.inventory_sku_id).filter(id => !skusById.has(String(id)));
      if (missingIds.length > 0) {
        const { data: moreSkus } = await client.from(DB.skuTable).select("*").in("id", missingIds);
        if (moreSkus) moreSkus.forEach(s => skusById.set(String(s.id), s));
      }

      // Map back for code consistency if needed
      ingredients = ingredients.map(i => ({
        id: i.id,
        menu_item_id: i.menu_item_id,
        sku_id: i.inventory_sku_id,
        quantity: i.quantity
      }));

      renderIngredients();
    } catch (e) {
      console.error(e);
      setStatus("Error al cargar receta", true);
    }
  }

  async function selectItem(id) {
    currentItemId = id;
    const item = getCurrentItem();
    if (!item) return;

    showRecipePanel(true);
    viewName.textContent = item.name.toUpperCase();
    viewMeta.textContent = `ITEM #${id.slice(0,8)} · ${item.category || "SIN CATEGORÍA"}`;
    viewPrice.value = item.price;
    
    pillActive.className = "tag " + (item.is_active ? "tag-green" : "tag-red");
    pillActive.textContent = item.is_active ? "ACTIVO" : "INACTIVO";
    btnToggleItem.textContent = item.is_active ? "INACTIVAR" : "REACTIVAR";
    btnToggleItem.className = item.is_active ? "btn-secondary" : "btn-primary";

    renderMenuList();
    await loadIngredients(id);
  }

  window.updateIngQty = async (ingId, val) => {
    const client = window.supabaseClient;
    const qty = parseFloat(val);
    if (isNaN(qty) || qty < 0) return;
    try {
      const { error } = await client.from(DB.ingTable).update({ quantity: qty }).eq("id", ingId);
      if (error) throw error;
      await loadIngredients(currentItemId);
    } catch (e) { console.error(e); }
  };

  window.deleteIng = async (ingId) => {
    if (!confirm("¿Quitar ingrediente?")) return;
    const client = window.supabaseClient;
    try {
      const { error } = await client.from(DB.ingTable).delete().eq("id", ingId);
      if (error) throw error;
      await loadIngredients(currentItemId);
    } catch (e) { console.error(e); }
  };

  btnAddIng.onclick = async () => {
    const skuId = selSku.value;
    const qty = parseFloat(newQty.value);
    if (!skuId || isNaN(qty) || qty <= 0) return alert("Seleccioná insumo y cantidad.");

    const client = window.supabaseClient;
    try {
      const { error } = await client.from(DB.ingTable).insert({
        menu_item_id: currentItemId,
        inventory_sku_id: skuId,
        quantity: qty
      });
      if (error) throw error;
      newQty.value = "";
      await loadIngredients(currentItemId);
    } catch (e) { console.error(e); }
  };

  viewPrice.onchange = async () => {
    const client = window.supabaseClient;
    const price = parseFloat(viewPrice.value) || 0;
    try {
      saveStatus.textContent = "Guardando...";
      const { error } = await client.from(DB.menuTable).update({ price }).eq("id", currentItemId);
      if (error) throw error;
      saveStatus.textContent = "Guardado.";
      setTimeout(() => saveStatus.textContent = "—", 2000);
      const item = getCurrentItem();
      if (item) item.price = price;
      renderMenuList();
      renderIngredients(); // Update KPIs
    } catch (e) { saveStatus.textContent = "Error."; }
  };

  btnNewItem.onclick = async () => {
    const name = prompt("Nombre del nuevo producto:");
    if (!name) return;
    const category = prompt("Categoría:");
    const client = window.supabaseClient;
    try {
      const { data, error } = await client.from(DB.menuTable).insert({
        name: name.toUpperCase(),
        category: category?.toUpperCase(),
        price: 0,
        is_active: true
      }).select().single();
      if (error) throw error;
      await loadInitialData();
      selectItem(data.id);
    } catch (e) { console.error(e); }
  };

  btnEditItem.onclick = async () => {
    const item = getCurrentItem();
    if (!item) return;
    const name = prompt("Nombre:", item.name);
    if (name === null) return;
    const category = prompt("Categoría:", item.category);
    if (category === null) return;
    const client = window.supabaseClient;
    try {
      const { error } = await client.from(DB.menuTable).update({
        name: name.toUpperCase(),
        category: category.toUpperCase()
      }).eq("id", item.id);
      if (error) throw error;
      await loadInitialData();
      selectItem(item.id);
    } catch (e) { console.error(e); }
  };

  btnToggleItem.onclick = async () => {
    const item = getCurrentItem();
    if (!item) return;
    const client = window.supabaseClient;
    try {
      const { error } = await client.from(DB.menuTable).update({ is_active: !item.is_active }).eq("id", item.id);
      if (error) throw error;
      await loadInitialData();
      selectItem(item.id);
    } catch (e) { console.error(e); }
  };

  // =========================
  // Listeners
  // =========================
  searchMenuEl.oninput = () => renderMenuList();
  skuFilter.oninput = () => {
    const term = skuFilter.value.toLowerCase();
    const options = Array.from(selSku.options);
    const match = options.find(o => o.text.toLowerCase().includes(term));
    if (match) selSku.value = match.value;
  };

  document.getElementById("btnBack").onclick = () => window.location.href = "master-index.html";

  // =========================
  // Boot
  // =========================
  (async function init() {
    await requireAdmin();
    loadInitialData();
    showRecipePanel(false);
  })();

})();
