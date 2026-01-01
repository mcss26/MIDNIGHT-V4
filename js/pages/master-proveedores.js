/* /js/pages/master-proveedores.js */

(function() {
    // ========= Header / Auth guard =========
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

    // ========= Proveedores =========
    const tableBody = document.querySelector("#suppliersTable tbody");
    const statusEl = document.getElementById("suppliersStatus");
    const searchInput = document.getElementById("searchSuppliers");
    const showInactiveCheckbox = document.getElementById("showInactive");
    const newSupplierBtn = document.getElementById("newSupplierBtn");

    const modal = document.getElementById("supplierModal");
    const modalSubtitle = document.getElementById("supplierModalSubtitle");
    const cancelModalBtn = document.getElementById("cancelModalBtn");
    const saveSupplierBtn = document.getElementById("saveSupplierBtn");

    const sNombre = document.getElementById("sNombre");
    const sRazonSocial = document.getElementById("sRazonSocial");
    const sCuit = document.getElementById("sCuit");
    const sEmail = document.getElementById("sEmail");
    const sContacto = document.getElementById("sContacto");
    const sTelContacto = document.getElementById("sTelContacto");
    const sBanco = document.getElementById("sBanco");
    const sAlias = document.getElementById("sAlias");
    const sCbu = document.getElementById("sCbu");
    const sIsActive = document.getElementById("sIsActive");

    let allSuppliers = [];
    let editingSupplierId = null;

    // details state
    let openSupplierId = null;
    let openDetailsRow = null;

    function onlyDigits(value, maxLen) {
      const cleaned = (value || "").replace(/\D/g, "");
      return maxLen ? cleaned.slice(0, maxLen) : cleaned;
    }

    function openModal() {
      modal.style.display = "flex";
      modal.setAttribute("aria-hidden", "false");
    }

    function closeModal() {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      editingSupplierId = null;
    }

    function setStatus(msg) {
      statusEl.textContent = msg || "";
    }

    function escapeHtml(str) {
      return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function attachListeners() {
      newSupplierBtn.addEventListener("click", openCreateModal);
      cancelModalBtn.addEventListener("click", closeModal);
      saveSupplierBtn.addEventListener("click", handleSaveSupplier);

      let t = null;
      searchInput.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(applyFiltersAndRender, 120);
      });
      showInactiveCheckbox.addEventListener("change", applyFiltersAndRender);

      sCuit.addEventListener("input", () => { sCuit.value = onlyDigits(sCuit.value, 11); });
      sCbu.addEventListener("input", () => { sCbu.value = onlyDigits(sCbu.value, 22); });

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

    async function loadSuppliers() {
      setStatus("Cargando proveedores...");
      try {
        const { data, error } = await window.supabaseClient
          .from("suppliers")
          .select("id,is_active,nombre,razon_social,cuit,email,contacto,tel_contacto,banco,alias,cbu")
          .order("nombre", { ascending: true });

        if (error) throw error;

        allSuppliers = data || [];
        applyFiltersAndRender();
      } catch (err) {
        console.error(err);
        setStatus("Error al cargar proveedores.");
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Error al cargar.</td></tr>`;
      }
    }

    function applyFiltersAndRender() {
      closeDetails();

      const term = (searchInput.value || "").toLowerCase().trim();
      const showInactive = !!showInactiveCheckbox.checked;

      const filtered = allSuppliers.filter((s) => {
        if (!showInactive && s.is_active === false) return false;
        if (!term) return true;

        return (
          (s.nombre || "").toLowerCase().includes(term) ||
          (s.razon_social || "").toLowerCase().includes(term) ||
          (s.cuit || "").toLowerCase().includes(term) ||
          (s.email || "").toLowerCase().includes(term) ||
          (s.contacto || "").toLowerCase().includes(term) ||
          (s.tel_contacto || "").toLowerCase().includes(term) ||
          (s.banco || "").toLowerCase().includes(term) ||
          (s.alias || "").toLowerCase().includes(term) ||
          (s.cbu || "").toLowerCase().includes(term)
        );
      });

      renderTable(filtered);

      if (!filtered.length) setStatus("No hay resultados.");
      else setStatus(`Mostrando ${filtered.length} de ${allSuppliers.length}`);
    }

    function renderTable(rows) {
      if (!rows.length) {
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Sin proveedores.</td></tr>`;
        return;
      }

      tableBody.innerHTML = "";
      rows.forEach((s) => {
        const tr = document.createElement("tr");
        tr.className = "list-row";
        tr.tabIndex = 0;
        tr.dataset.id = s.id;

        const open = () => toggleDetailsFor(s.id, tr);
        tr.addEventListener("click", open);
        tr.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); }
        });

        const offTag = (s.is_active === false) ? ` <span class="tag tag-red">OFF</span>` : "";

        tr.innerHTML = `
          <td class="cell-pl">
            <div class="row-title">${escapeHtml(s.nombre || "-")}${offTag}</div>
            <div class="row-sub-text">${escapeHtml(s.contacto || "—")}</div>
          </td>
          <td>${escapeHtml(s.razon_social || "-")}</td>
          <td class="text-center">${escapeHtml(s.cuit || "-")}</td>
          <td>${escapeHtml(s.banco || "-")}</td>
          <td>${escapeHtml(s.alias || "-")}</td>
          <td class="cell-pr">${escapeHtml(s.cbu || "-")}</td>
        `;

        tableBody.appendChild(tr);
      });
    }

    function toggleDetailsFor(id, rowEl) {
      if (openSupplierId === id) {
        closeDetails();
        return;
      }

      closeDetails();

      openSupplierId = id;
      rowEl.classList.add("is-selected");

      const s = allSuppliers.find(x => x.id === id);
      if (!s) return;

      openDetailsRow = document.createElement("tr");
      openDetailsRow.className = "details-row";

      const td = document.createElement("td");
      td.colSpan = 6;

      const estadoTag = `<span class="tag ${s.is_active === false ? "tag-red" : "tag-green"}">${s.is_active === false ? "INACTIVO" : "ACTIVO"}</span>`;

      td.innerHTML = `
        <div class="details-wrap">
          <div class="details-grid">
            <div class="kv"><div class="k">Email</div><div class="v">${escapeHtml(s.email || "—")}</div></div>
            <div class="kv"><div class="k">Contacto</div><div class="v">${escapeHtml(s.contacto || "—")}</div></div>
            <div class="kv"><div class="k">Teléfono</div><div class="v">${escapeHtml(s.tel_contacto || "—")}</div></div>
            <div class="kv"><div class="k">Razón social</div><div class="v">${escapeHtml(s.razon_social || "—")}</div></div>
            <div class="kv"><div class="k">CUIT</div><div class="v">${escapeHtml(s.cuit || "—")}</div></div>
            <div class="kv"><div class="k">Banco</div><div class="v">${escapeHtml(s.banco || "—")}</div></div>
            <div class="kv"><div class="k">Alias</div><div class="v">${escapeHtml(s.alias || "—")}</div></div>
            <div class="kv"><div class="k">CBU</div><div class="v">${escapeHtml(s.cbu || "—")}</div></div>
          </div>

          <div class="details-actions">
            <div class="left">${estadoTag}</div>
            <button type="button" class="btn-secondary" data-action="edit">Editar</button>
            <button type="button" class="${s.is_active === false ? "btn-secondary" : "btn-danger"}" data-action="toggle">
              ${s.is_active === false ? "Reactivar" : "Inactivar"}
            </button>
          </div>
        </div>
      `;

      openDetailsRow.appendChild(td);
      rowEl.insertAdjacentElement("afterend", openDetailsRow);

      const editBtn = openDetailsRow.querySelector('[data-action="edit"]');
      const toggleBtn = openDetailsRow.querySelector('[data-action="toggle"]');

      editBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        openEditModal(id);
      });

      toggleBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        await setSupplierActive(id, s.is_active === false);
      });
    }

    function closeDetails() {
      if (openSupplierId) {
        const prevRow = tableBody.querySelector(`tr.list-row[data-id="${openSupplierId}"]`);
        if (prevRow) prevRow.classList.remove("is-selected");
      }
      openSupplierId = null;

      if (openDetailsRow && openDetailsRow.parentNode) {
        openDetailsRow.parentNode.removeChild(openDetailsRow);
      }
      openDetailsRow = null;
    }

    async function setSupplierActive(id, makeActive) {
      const s = allSuppliers.find(x => x.id === id);
      if (!s) return;

      const label = makeActive ? "Reactivar" : "Inactivar";
      const ok = confirm(`¿${label} proveedor "${s.nombre}"?`);
      if (!ok) return;

      try {
        const { error } = await window.supabaseClient.from("suppliers").update({ is_active: !!makeActive }).eq("id", id);
        if (error) throw error;

        closeModal();
        await loadSuppliers();
      } catch (err) {
        console.error(err);
        alert("No se pudo actualizar el estado.");
      }
    }

    function openCreateModal() {
      editingSupplierId = null;
      modalSubtitle.textContent = "Crear nuevo proveedor.";

      sNombre.value = "";
      sRazonSocial.value = "";
      sCuit.value = "";
      sEmail.value = "";
      sContacto.value = "";
      sTelContacto.value = "";
      sBanco.value = "";
      sAlias.value = "";
      sCbu.value = "";
      sIsActive.checked = true;

      openModal();
    }

    function openEditModal(id) {
      const s = allSuppliers.find((x) => x.id === id);
      if (!s) return;

      editingSupplierId = id;
      modalSubtitle.textContent = "Editar proveedor.";

      sNombre.value = s.nombre || "";
      sRazonSocial.value = s.razon_social || "";
      sCuit.value = onlyDigits(s.cuit || "", 11);
      sEmail.value = s.email || "";
      sContacto.value = s.contacto || "";
      sTelContacto.value = s.tel_contacto || "";
      sBanco.value = s.banco || "";
      sAlias.value = s.alias || "";
      sCbu.value = onlyDigits(s.cbu || "", 22);
      sIsActive.checked = (s.is_active !== false);

      openModal();
    }

    async function handleSaveSupplier() {
      const nombre = (sNombre.value || "").trim();
      if (!nombre) { alert("El nombre es obligatorio."); return; }

      const cuit = onlyDigits(sCuit.value, 11);
      if (cuit && cuit.length !== 11) { alert("CUIT inválido: deben ser 11 dígitos."); return; }

      const cbu = onlyDigits(sCbu.value, 22);
      if (cbu && cbu.length !== 22) { alert("CBU inválido: deben ser 22 dígitos."); return; }

      const payload = {
        nombre,
        razon_social: (sRazonSocial.value || "").trim() || null,
        cuit: cuit || null,
        email: (sEmail.value || "").trim() || null,
        contacto: (sContacto.value || "").trim() || null,
        tel_contacto: (sTelContacto.value || "").trim() || null,
        banco: (sBanco.value || "").trim() || null,
        alias: (sAlias.value || "").trim() || null,
        cbu: cbu || null,
        is_active: !!sIsActive.checked
      };

      try {
        saveSupplierBtn.disabled = true;
        saveSupplierBtn.textContent = "Guardando...";

        if (!editingSupplierId) {
          const { error } = await window.supabaseClient.from("suppliers").insert(payload);
          if (error) throw error;
        } else {
          const { error } = await window.supabaseClient.from("suppliers").update(payload).eq("id", editingSupplierId);
          if (error) throw error;
        }

        closeModal();
        await loadSuppliers();
      } catch (err) {
        console.error(err);
        alert("No se pudo guardar el proveedor.");
      } finally {
        saveSupplierBtn.disabled = false;
        saveSupplierBtn.textContent = "Guardar";
      }
    }

    // ========= Boot =========
    (async function init() {
      try {
        await requireAdmin();
        attachListeners();
        await loadSuppliers();
      } catch (e) {
        console.error(e);
        try { if (window.supabaseClient) await window.supabaseClient.auth.signOut(); } catch {}
        window.location.replace("../auth/login.html");
      }
    })();
})();
