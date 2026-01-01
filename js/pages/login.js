    const client = window.supabaseClient;

    const routes = {
      admin: "../index.html",
      operativo: "../operativo/operativo-index.html",
      staff: "../staff/staff-index.html",
      logistica: "../logistica/logistica-index.html",
    };

    const $ = (id) => document.getElementById(id);

    function setMsg(text, kind) {
      const el = $("msg");
      el.textContent = text || "";
      el.className = "msg" + (kind ? (" " + kind) : "");
    }

    async function getMyRole(userId) {
      const { data, error } = await client
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (error) throw error;
      if (!data?.role) throw new Error("Este usuario no tiene role en profiles.");
      return data.role;
    }

    async function redirectByRole(role) {
      const normalizedRole = role.toLowerCase();
      const target = routes[normalizedRole];
      if (!target) throw new Error("Rol inválido: " + role);
      window.location.replace(target);
    }

    async function maybeRedirectIfAlreadyLogged() {
      if (!client) return;

      const { data } = await client.auth.getSession();
      const session = data?.session;
      if (!session?.user?.id) return;

      const role = await getMyRole(session.user.id);
      await redirectByRole(role);
    }

    // Si ya está logueado, redirigir
    maybeRedirectIfAlreadyLogged().catch(() => {});

    $("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      setMsg("");
      $("btn").disabled = true;

      try {
        if (!client) throw new Error("No se inicializó Supabase (revisá config.js).");

        const email = $("email").value.trim();
        const password = $("password").value;

        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const userId = data?.user?.id;
        if (!userId) throw new Error("No se pudo obtener el usuario.");

        const role = await getMyRole(userId);
        setMsg("OK, redirigiendo…", "ok");
        await redirectByRole(role);
      } catch (err) {
        setMsg(err?.message || "Error de login", "err");
      } finally {
        $("btn").disabled = false;
      }
    });
