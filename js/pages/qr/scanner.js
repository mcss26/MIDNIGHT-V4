// Config is loaded from ../config.js which provides window.supabaseClient
const supabaseClient = window.supabaseClient;

// DOM Elements
const el = (id) => document.getElementById(id);
const loginOverlay = el("loginOverlay");
const statusCard = el("statusCard");
const statusTitle = el("statusTitle");
const statusMsg = el("statusMsg");
const historyList = el("historyList");
const checkinCount = el("checkinCount");
const btnDashboard = el("btnDashboard");

// Global State
let currentUser = null;
let currentProfile = null;
let html5QrCode = null;
let isProcessing = false;

// Initialization
async function init() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        handleAuthSuccess(session.user);
    } else {
        window.location.href = "../auth/login.html";
    }
}

// Authentication


el("btnLogout").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "../auth/login.html";
});

async function handleAuthSuccess(user) {
    currentUser = user;
    
    // Get Profile and check roles
    const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    if (error || !profile || !['ADMIN', 'OPERATIVO'].includes(profile.role)) {
        alert("No tienes permisos para acceder a esta aplicación.");
        await supabaseClient.auth.signOut();
        window.location.href = "../auth/login.html";
        return;
    }

    currentProfile = profile;
    el("userName").textContent = profile.full_name || "Staff";
    el("userRole").textContent = profile.role;
    
    if (profile.role === 'ADMIN') {
        btnDashboard.classList.remove("hidden");
    }
    
    startScanner();
    loadHistory();
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
    isProcessing = true;
    showStatus("idle", "Validando...", code);
    
    try {
        // 1. Check if code exists and its status
        const { data: qrcode, error: fetchError } = await supabaseClient
            .from("qr_codes")
            .select("*, qr_batches(name)")
            .eq("code", code)
            .single();

        if (fetchError || !qrcode) {
            handleResult(false, "Código Inválido", "No existe en el sistema.", code, null);
            return;
        }

        if (qrcode.status === 'ACREDITADO') {
            handleResult(false, "Ya Utilizado", `Acreditado el ${new Date(qrcode.accredited_at).toLocaleString()}`, code, qrcode.id);
            return;
        }

        if (qrcode.status === 'ANULADO') {
            handleResult(false, "Anulado", "Este código fue cancelado.", code, qrcode.id);
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

        handleResult(true, "Acceso Permitido", qrcode.qr_batches?.name || "Lote General", code, qrcode.id);

    } catch (err) {
        console.error(err);
        handleResult(false, "Error de Sistema", "Reintentá en unos segundos.", code, null);
    } finally {
        setTimeout(() => { isProcessing = false; }, 2000); // Cooldown
    }
}

async function handleResult(success, title, msg, code, codeId) {
    showStatus(success ? "success" : "error", title, msg);
    
    // Play sound
    const s = el(success ? "soundSuccess" : "soundError");
    if (s) { s.currentTime = 0; s.play().catch(e => {}); }

    // Log checkin
    if (codeId) {
        await supabaseClient.from("qr_checkins").insert({
            code_id: codeId,
            operator_id: currentUser.id,
            success: success,
            message: title + ": " + msg
        });
    }

    addToHistory(success, title, code);
}

function showStatus(type, title, msg) {
    statusCard.className = `status-card ${type}`;
    statusTitle.textContent = title;
    statusMsg.textContent = msg;
    
    if (type !== 'idle') {
        setTimeout(() => {
            if (!isProcessing) {
                statusCard.className = "status-card idle";
                statusTitle.textContent = "Listo para escanear";
                statusMsg.textContent = "Apuntá al código QR del cliente.";
            }
        }, 3500);
    }
}

// Manual Input
el("btnManualInput").addEventListener("click", () => {
    el("manualInputBox").classList.toggle("hidden");
});

el("btnCheckManual").addEventListener("click", () => {
    const code = el("manualCode").value.trim();
    if (code) validateCode(code);
});

// History Logic
async function loadHistory() {
    const { data, error } = await supabaseClient
        .from("qr_checkins")
        .select("*, qr_codes(code)")
        .order("created_at", { ascending: false })
        .limit(10);

    if (!error && data) {
        historyList.innerHTML = "";
        data.forEach(item => {
            addToHistory(item.success, item.message.split(":")[0], item.qr_codes?.code, false);
        });
        checkinCount.textContent = data.length;
    }
}

function addToHistory(success, title, code, prepend = true) {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = `
        <div class="h-info">
            <span class="h-code">${code || 'Desconocido'}</span>
            <span class="h-time">${new Date().toLocaleTimeString()}</span>
        </div>
        <span class="h-status ${success ? 'ok' : 'no'}">${title}</span>
    `;
    
    if (prepend) {
        historyList.prepend(item);
        if (historyList.children.length > 10) historyList.lastElementChild.remove();
        checkinCount.textContent = parseInt(checkinCount.textContent) + 1;
    } else {
        historyList.appendChild(item);
    }
}

init();
