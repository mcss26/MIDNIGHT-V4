/* /js/pages/master-checklist.js */

(function() {
  const T_DEFS = "checklist_item_defs";
  
  // =========================
  // State
  // =========================
  let allItems = [];
  let currentScope = "ALL";
  let searchTerm = "";
  let showInactive = false;

  // =========================
  // UI Refs
  // =========================
  const tbody = document.getElementById("tbody");
  const scopeTabs = document.getElementById("scopeTabs");
  const searchInput = document.getElementById("searchInput");
  const inactiveCheck = document.getElementById("showInactive");
  const btnNew = document.getElementById("btnNew");
  const statusLine = document.getElementById("statusLine");

  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modalTitle");
  const form = document.getElementById("form");
  const fId = document.getElementById("fId");
  const fScope = document.getElementById("fScope");
  const fTitle = document.getElementById("fTitle");
  const fDesc = document.getElementById("fDesc");
  const fOrder = document.getElementById("fOrder");
  const fActive = document.getElementById("fActive");
  const btnCancel = document.getElementById("btnCancel");
  const btnSave = document.getElementById("btnSave");

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

  // =========================
  // Logic
  // =========================
  async function loadItems() {
    const client = window.supabaseClient;
    try {
      setStatus("Cargando ítems...");
      const { data, error } = await client.from(T_DEFS).select("*").order("sort_order", { ascending: true });
      if (error) throw error;
      allItems = data || [];
      renderTable();
      setStatus("");
    } catch (e) {
      console.error(e);
      setStatus("Error al cargar checklist", true);
    }
  }

  function renderTable() {
    const filtered = allItems.filter(i => {
      const matchScope = currentScope === "ALL" || i.scope === currentScope;
      const matchInactive = showInactive || i.is_active;
      const matchSearch = !searchTerm || 
        i.title.toLowerCase().includes(searchTerm) || 
        (i.description && i.description.toLowerCase().includes(searchTerm));
      return matchScope && matchInactive && matchSearch;
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No hay ítems definidos.</td></tr>`;
      return;
    }

    const editIcon = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    `;

    tbody.innerHTML = filtered.map(i => `
      <tr class="list-row ${!i.is_active ? "is-inactive" : ""}">
        <td class="text-center cell-pl">
          <span class="mono" style="font-size:11px; opacity:0.6;">#${i.sort_order ?? 0}</span>
        </td>
        <td>
          <div class="row-title">${escapeHtml(i.title)}</div>
          ${i.description ? `<div class="row-sub">${escapeHtml(i.description)}</div>` : ""}
        </td>
        <td class="text-center">
          <span class="tag tag-gray">${i.scope}</span>
        </td>
        <td class="text-center">
          <span class="tag ${i.is_active ? "tag-green" : "tag-gray"}">${i.is_active ? "ACTIVO" : "INACTIVO"}</span>
        </td>
        <td class="text-right cell-pr">
          <button class="btn-action-edit" onclick="editItem('${i.id}')" title="Editar">
            ${editIcon}
          </button>
        </td>
      </tr>
    `).join("");
  }

  // =========================
  // Modal & CRUD
  // =========================
  function openModal(item = null) {
    if (item) {
      modalTitle.textContent = "EDITAR ÍTEM";
      fId.value = item.id;
      fScope.value = item.scope;
      fTitle.value = item.title;
      fDesc.value = item.description || "";
      fOrder.value = item.sort_order ?? 100;
      fActive.checked = item.is_active;
    } else {
      modalTitle.textContent = "NUEVO ÍTEM";
      form.reset();
      fId.value = "";
      fOrder.value = 100;
      fActive.checked = true;
    }
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }

  window.editItem = (id) => {
    const item = allItems.find(i => i.id === id);
    if (item) openModal(item);
  };

  btnSave.addEventListener("click", async () => {
    const client = window.supabaseClient;
    const id = fId.value;
    
    const payload = {
      scope: fScope.value,
      title: fTitle.value.trim(),
      description: fDesc.value.trim() || null,
      sort_order: parseInt(fOrder.value) || 0,
      is_active: fActive.checked
    };

    if (!payload.title) return setStatus("Título requerido", true);

    try {
      setStatus("Guardando...");
      let error;
      if (id) {
        ({ error } = await client.from(T_DEFS).update(payload).eq("id", id));
      } else {
        ({ error } = await client.from(T_DEFS).insert(payload));
      }
      if (error) throw error;
      
      closeModal();
      await loadItems();
      setStatus("Guardado con éxito");
    } catch (e) {
      console.error(e);
      setStatus("Error al guardar ítem", true);
    }
  });

  // =========================
  // Listeners
  // =========================
  scopeTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    currentScope = btn.dataset.scope;
    
    scopeTabs.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    
    renderTable();
  });

  searchInput.addEventListener("input", (e) => {
    searchTerm = e.target.value.toLowerCase().trim();
    renderTable();
  });

  inactiveCheck.addEventListener("change", (e) => {
    showInactive = e.target.checked;
    renderTable();
  });

  btnNew.addEventListener("click", () => openModal());
  btnCancel.addEventListener("click", closeModal);
  document.getElementById("btnBack").addEventListener("click", () => window.location.href = "master-index.html");

  // =========================
  // Boot
  // =========================
  (async function init() {
    await requireAdmin();
    loadItems();
  })();

})();
