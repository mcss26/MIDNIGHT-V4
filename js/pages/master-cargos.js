/* /js/pages/master-cargos.js */

(function() {
  const T_ROLES = "staff_roles";
  
  // =========================
  // State
  // =========================
  let allRoles = [];
  let areas = [];
  let currentArea = "ALL";
  let showInactive = false;
  let searchTerm = "";

  // =========================
  // UI Refs
  // =========================
  const rolesTbody = document.querySelector("#rolesTable tbody");
  const areaTabs = document.getElementById("areaTabs");
  const statusLine = document.getElementById("statusLine");
  const searchInput = document.getElementById("searchRole");
  const inactiveCheck = document.getElementById("showInactive");
  const newRoleBtn = document.getElementById("newRoleBtn");

  const modal = document.getElementById("roleModal");
  const modalTitle = document.getElementById("roleModalTitle");
  const roleForm = document.getElementById("roleForm");
  const rId = document.getElementById("rId");
  const rName = document.getElementById("rName");
  const rArea = document.getElementById("rArea");
  const rPay = document.getElementById("rPay");
  const rIsActive = document.getElementById("rIsActive");
  const cancelBtn = document.getElementById("cancelRoleBtn");
  const saveBtn = document.getElementById("saveRoleBtn");

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
  async function loadRoles() {
    const client = window.supabaseClient;
    try {
      setStatus("Cargando cargos...");
      // Anti-g project uses role_name instead of name
      const { data, error } = await client.from(T_ROLES).select("*").order("role_name", { ascending: true });
      if (error) throw error;
      allRoles = data || [];
      
      // Update areas for tabs
      const uniqueAreas = [...new Set(allRoles.map(r => r.area))].filter(Boolean).sort();
      areas = ["ALL", ...uniqueAreas];
      
      renderTabs();
      renderTable();
      updateAreaDropdown();
      setStatus("");
    } catch (e) {
      console.error(e);
      setStatus("Error al cargar cargos", true);
    }
  }

  function renderTabs() {
    areaTabs.innerHTML = areas.map(a => `
      <button type="button" class="tab-btn ${a === currentArea ? "active" : ""}" data-area="${a}">
        ${a === "ALL" ? "TODOS" : a.toUpperCase()}
      </button>
    `).join("");
  }

  function updateAreaDropdown() {
    const currentVal = rArea.value;
    const options = areas.filter(a => a !== "ALL");
    rArea.innerHTML = options.map(a => `<option value="${a}">${a}</option>`).join("") + 
                      `<option value="NEW">+ NUEVA ÁREA</option>`;
    if (options.includes(currentVal)) rArea.value = currentVal;
  }

  function renderTable() {
    const filtered = allRoles.filter(r => {
      const matchArea = currentArea === "ALL" || r.area === currentArea;
      const matchInactive = showInactive || r.is_active;
      const matchSearch = !searchTerm || 
        (r.role_name || "").toLowerCase().includes(searchTerm) || 
        (r.area && r.area.toLowerCase().includes(searchTerm));
      return matchArea && matchInactive && matchSearch;
    });

    if (!filtered.length) {
      rolesTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No se encontraron cargos.</td></tr>`;
      return;
    }

    const editIcon = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    `;

    rolesTbody.innerHTML = filtered.map(r => `
      <tr class="list-row ${!r.is_active ? "is-inactive" : ""}">
        <td class="cell-pl">
          <div class="row-title">${escapeHtml(r.role_name || "SIN NOMBRE")}</div>
        </td>
        <td class="text-center">
          <span class="tag tag-gray">${escapeHtml(r.area || "S/A")}</span>
        </td>
        <td class="text-right">
          $${Number(r.base_pay || 0).toLocaleString()}
        </td>
        <td class="text-center">
          <span class="tag ${r.is_active ? "tag-green" : "tag-gray"}">${r.is_active ? "ACTIVO" : "INACTIVO"}</span>
        </td>
        <td class="text-center cell-pr">
          <button class="btn-action-edit" onclick="editRole('${r.id}')" title="Editar">
            ${editIcon}
          </button>
        </td>
      </tr>
    `).join("");
  }

  // =========================
  // Modal & CRUD
  // =========================
  function openModal(role = null) {
    if (role) {
      modalTitle.textContent = "EDITAR CARGO";
      rId.value = role.id;
      rName.value = role.role_name;
      rArea.value = role.area;
      rPay.value = role.base_pay;
      rIsActive.checked = role.is_active;
    } else {
      modalTitle.textContent = "NUEVO CARGO";
      roleForm.reset();
      rId.value = "";
      rIsActive.checked = true;
    }
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }

  window.editRole = (id) => {
    const role = allRoles.find(r => r.id === id);
    if (role) openModal(role);
  };

  saveBtn.addEventListener("click", async () => {
    const client = window.supabaseClient;
    const id = rId.value;
    
    let area = rArea.value;
    if (area === "NEW") {
      const newArea = prompt("Nombre de la nueva área:");
      if (!newArea) return;
      area = newArea.toUpperCase();
    }

    const payload = {
      role_name: rName.value.trim().toUpperCase(),
      area: area,
      base_pay: Number(rPay.value) || 0,
      is_active: rIsActive.checked
    };

    if (!payload.role_name) return setStatus("Nombre requerido", true);

    try {
      setStatus("Guardando...");
      let error;
      if (id) {
        ({ error } = await client.from(T_ROLES).update(payload).eq("id", id));
      } else {
        ({ error } = await client.from(T_ROLES).insert(payload));
      }
      if (error) throw error;
      
      closeModal();
      await loadRoles();
      setStatus("Guardado con éxito");
    } catch (e) {
      console.error(e);
      setStatus("Error al guardar cargo", true);
    }
  });

  // =========================
  // Listeners
  // =========================
  areaTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    currentArea = btn.dataset.area;
    renderTabs();
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

  newRoleBtn.addEventListener("click", () => openModal());
  cancelBtn.addEventListener("click", closeModal);
  document.getElementById("btnBack").addEventListener("click", () => window.location.href = "master-index.html");

  // =========================
  // Boot
  // =========================
  (async function init() {
    await requireAdmin();
    loadRoles();
  })();

})();
