/* /js/pages/staff-acreditador.js */

(function() {
    const supabaseClient = window.supabaseClient;
    const el = (id) => document.getElementById(id);

    // Global State
    let currentUser = null;
    let html5QrCode = null;
    let isProcessing = false;

    const statusCard = el("statusCard");
    const statusTitle = el("statusTitle");
    const statusMsg = el("statusMsg");
    const historyList = el("historyList");
    const checkinCount = el("checkinCount");

    async function checkAccess() {
        if (!supabaseClient) {
            window.location.replace("../auth/login.html");
            return null;
        }

        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session?.user?.id) {
            window.location.replace("../auth/login.html");
            return null;
        }

        const { data: profile, error } = await supabaseClient
            .from("profiles")
            .select("id, full_name, role")
            .eq("id", session.user.id)
            .single();

        if (error || !profile || !['STAFF', 'ADMIN', 'OPERATIVO', 'LOGISTICA'].includes(profile.role.toUpperCase())) {
            window.location.replace("../auth/login.html");
            return null;
        }

        currentUser = profile;
        el("userName").textContent = profile.full_name || "Staff";
        return session;
    }

    // Scanner Logic
    function startScanner() {
        html5QrCode = new Html5Qrcode("reader");
        const config = { fps: 10, qrbox: { width: 250, height: 250 } };

        html5QrCode.start(
            { facingMode: "environment" }, 
            config, 
            (decodedText) => {
                if (!isProcessing) validateCode(decodedText);
            },
            (errorMessage) => { /* quiet noise */ }
        ).catch(err => {
            console.error("Scanner failed", err);
            showStatus("error", "Error de Cámara", "No se pudo acceder a la cámara.");
        });
    }

    // Validation Logic
    async function validateCode(code) {
        if (isProcessing) return;
        isProcessing = true;
        
        showStatus("idle", "Validando...", code);
        
        try {
            // 1. Check if code exists
            const { data: qrcode, error: fetchError } = await supabaseClient
                .from("qr_codes")
                .select("*, qr_batches(name)")
                .eq("code", code)
                .single();

            if (fetchError || !qrcode) {
                await logCheckin(null, false, "Inválido: No existe", code);
                handleResult(false, "Código Inválido", "No existe en el sistema.", code);
                return;
            }

            if (qrcode.status === 'ACREDITADO') {
                await logCheckin(qrcode.id, false, "Ya Utilizado", code);
                handleResult(false, "Ya Utilizado", `Acreditado el ${new Date(qrcode.accredited_at).toLocaleString()}`, code);
                return;
            }

            if (qrcode.status === 'ANULADO') {
                await logCheckin(qrcode.id, false, "Anulado", code);
                handleResult(false, "Anulado", "Este código fue cancelado.", code);
                return;
            }

            // 2. Acreditación
            const { error: updateError } = await supabaseClient
                .from("qr_codes")
                .update({ 
                    status: 'ACREDITADO', 
                    accredited_at: new Date().toISOString(),
                    accredited_by: currentUser.id 
                })
                .eq("id", qrcode.id);

            if (updateError) throw updateError;

            await logCheckin(qrcode.id, true, "OK: " + (qrcode.qr_batches?.name || "Lote General"), code);
            handleResult(true, "Acceso Permitido", qrcode.qr_batches?.name || "Lote General", code);

        } catch (err) {
            console.error(err);
            handleResult(false, "Error de Sistema", "Reintentá en unos segundos.", code);
        } finally {
            setTimeout(() => { isProcessing = false; }, 2500); // Cooldown for visual feedback
        }
    }

    async function logCheckin(codeId, success, message, codeText) {
        try {
            await supabaseClient.from("qr_checkins").insert({
                code_id: codeId,
                operator_id: currentUser.id,
                success: success,
                message: message
            });
        } catch (e) {
            console.error("Error logging checkin:", e);
        }
    }

    function handleResult(success, title, msg, code) {
        showStatus(success ? "success" : "error", title, msg);
        
        // Play sound
        const sound = el(success ? "soundSuccess" : "soundError");
        if (sound) { sound.currentTime = 0; sound.play().catch(e => {}); }

        addToHistory(success, title, code);
    }

    function showStatus(type, title, msg) {
        statusCard.className = `status-card ${type}`;
        statusTitle.textContent = title;
        statusMsg.textContent = msg;
        
        // Reset to idle after a few seconds if not still "validating"
        if (type !== 'idle') {
            setTimeout(() => {
                if (!isProcessing) {
                    statusCard.className = "status-card idle";
                    statusTitle.textContent = "Listo para escanear";
                    statusMsg.textContent = "Apuntá al código QR del cliente.";
                }
            }, 3000);
        }
    }

    function addToHistory(success, title, code) {
        const item = document.createElement("div");
        item.className = "history-item";
        item.innerHTML = `
            <div class="h-info">
                <span class="h-code">${code || '---'}</span>
                <span class="h-time">${new Date().toLocaleTimeString()}</span>
            </div>
            <span class="h-status ${success ? 'ok' : 'no'}">${title}</span>
        `;
        
        historyList.prepend(item);
        if (historyList.children.length > 10) historyList.lastElementChild.remove();
        
        const currentTotal = parseInt(checkinCount.textContent || "0");
        checkinCount.textContent = currentTotal + 1;
    }

    // Manual Input
    el("btnManualInput").addEventListener("click", () => {
        el("manualInputBox").classList.toggle("hidden");
    });

    el("btnCheckManual").addEventListener("click", () => {
        const code = el("manualCode").value.trim();
        if (code) {
            validateCode(code);
            el("manualCode").value = "";
        }
    });

    el("btnBack").addEventListener("click", () => {
        window.location.href = "staff-index.html";
    });

    // Init
    (async function init() {
        const session = await checkAccess();
        if (session) {
            startScanner();
            // Optional: load recent checkins from DB for this operator?
        }
    })();

})();
