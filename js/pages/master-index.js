    document.getElementById("btnBack").addEventListener("click", () => {
      window.location.href = "../index.html";
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

    (async function init() {
      try {
        const session = await requireAdmin();
        if (!session) return;
      } catch (e) {
        console.error(e);
        window.location.replace("../auth/login.html");
      }
    })();
