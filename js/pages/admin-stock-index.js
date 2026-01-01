/* /js/pages/admin-stock-index.js */

(function() {
  const client = window.supabaseClient;

  // UI Refs
  const btnBack = document.getElementById("btnBack");
  const badgeChecks = document.getElementById("badgeChecks");
  const badgeSolicitudes = document.getElementById("badgeSolicitudes");
  const badgeMoves = document.getElementById("badgeMoves");

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

  function setBadge(el, n) {
    const num = Number(n) || 0;
    if (!el) return;
    if (num > 0) {
      el.textContent = String(num);
      el.classList.remove("is-hidden");
    } else {
      el.textContent = "0";
      el.classList.add("is-hidden");
    }
  }

  async function loadBadgeChecks() {
    // checks abiertos (admin solicitó / operativo aún no completó)
    const res = await client
      .from("inventory_check_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["OPEN", "IN_PROGRESS"]);
    setBadge(badgeChecks, res.count || 0);
  }

  async function loadBadgeSolicitudes() {
    // pedidos de reposición pendientes de acción del admin
    const res = await client
      .from("inventory_purchase_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["SUBMITTED", "PARTIAL_ACTION"]);
    setBadge(badgeSolicitudes, res.count || 0);
  }

  async function loadBadgeMovimientos() {
    const res = await client
      .from("inventory_movements")
      .select("id", { count: "exact", head: true })
      .eq("status", "PENDING");
    setBadge(badgeMoves, res.count || 0);
  }

  async function loadBadges() {
    try {
      await Promise.all([
        loadBadgeChecks(),
        loadBadgeSolicitudes(),
        loadBadgeMovimientos()
      ]);
    } catch (e) {
      console.error("Error al cargar badges:", e);
    }
  }

  // Listeners
  if (btnBack) {
    btnBack.onclick = () => window.location.href = "admin-index.html";
  }

  // Init
  (async function init() {
    try {
      const session = await requireAdmin();
      if (!session) return;
      await loadBadges();
    } catch (e) {
      console.error(e);
      window.location.replace("../auth/login.html");
    }
  })();
})();
