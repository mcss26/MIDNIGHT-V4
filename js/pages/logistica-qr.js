/* /js/pages/logistica-qr.js */

(function() {
    const supabaseClient = window.supabaseClient;

    const el = (id) => document.getElementById(id);

    async function requireLogistica() {
        if (!supabaseClient) {
            window.location.replace("../auth/login.html");
            return null;
        }

        const { data: sessData } = await supabaseClient.auth.getSession();
        const session = sessData?.session;

        if (!session?.user?.id) {
            window.location.replace("../auth/login.html");
            return null;
        }

        const { data: prof, error: profErr } = await supabaseClient
            .from("profiles")
            .select("role")
            .eq("id", session.user.id)
            .single();

        if (profErr || !prof?.role || !["LOGISTICA","OPERATIVO","STAFF","ADMIN"].includes(prof.role.toUpperCase())) {
            try { await supabaseClient.auth.signOut(); } catch {}
            window.location.replace("../auth/login.html");
            return null;
        }

        return session;
    }

    const PREVIEW_LIMIT = 50;
    const PREVIEW_QR_PX = 160;

    let sessionRef = null;

    // Toggle sequential options visibility
    el("mode").addEventListener("change", (e) => {
        el("seqOptions").style.display = e.target.value === "seq" ? "block" : "none";
    });

    function padNum(n, digits) {
        return String(n).padStart(digits, "0");
    }

    function buildPayloads() {
        const base = (el("baseText").value || "").trim();
        const mode = el("mode").value;
        const qtyCount = el("qty").value;
        const qty = Math.max(1, Math.min(500, parseInt(qtyCount || "1", 10)));

        const seqStart = parseInt(el("seqStart").value || "1", 10);
        const seqDigits = Math.max(
            1,
            Math.min(12, parseInt(el("seqDigits").value || "6", 10))
        );
        const sep = el("seqSep").value || "-";

        const out = [];

        for (let i = 0; i < qty; i++) {
            if (mode === "same") {
                out.push(base || " ");
            } else if (mode === "seq") {
                const num = seqStart + i;
                out.push((base || "") + sep + padNum(num, seqDigits));
            } else if (mode === "uuid") {
                const uid = crypto.randomUUID();
                out.push(base ? base + sep + uid : uid);
            }
        }
        return out;
    }

    function applyPrintVars() {
        const paper = el("paper").value;
        const qrMm = el("qrSize").value;
        const gapMm = el("gap").value;

        document.documentElement.style.setProperty("--paper-mm", paper + "mm");
        document.documentElement.style.setProperty("--qr-mm", qrMm + "mm");
        document.documentElement.style.setProperty("--gap-mm", gapMm + "mm");
    }

    function renderPreview(payloads) {
        const box = el("previewArea");
        box.innerHTML = "";

        payloads.slice(0, PREVIEW_LIMIT).forEach((text) => {
            const card = document.createElement("div");
            card.className = "preview-card";

            const qrDiv = document.createElement("div");
            qrDiv.className = "preview-card-qr";

            const caption = document.createElement("div");
            caption.className = "preview-card-caption";
            caption.textContent = text;

            card.appendChild(qrDiv);
            card.appendChild(caption);
            box.appendChild(card);

            new QRCode(qrDiv, {
                text,
                width: PREVIEW_QR_PX,
                height: PREVIEW_QR_PX,
                correctLevel: QRCode.CorrectLevel.M,
            });
        });

        const meta = el("previewMeta");
        if (meta) {
            meta.textContent = `${payloads.length} códigos generados${
                payloads.length > PREVIEW_LIMIT ? ` (mostrando ${PREVIEW_LIMIT})` : ""
            }`;
        }
    }

    function renderPrintTickets(payloads) {
        applyPrintVars();

        const printArea = el("printArea");
        printArea.innerHTML = "";

        const title = (el("titleText").value || "").trim();
        const qrMm = parseFloat(el("qrSize").value) || 35;
        const qrPx = Math.round(qrMm * 3.78); // mm to px approx (96dpi / 25.4)

        payloads.forEach((text) => {
            const ticket = document.createElement("div");
            ticket.className = "ticket";

            const inner = document.createElement("div");
            inner.className = "ticket-inner";

            if (title) {
                const h = document.createElement("div");
                h.className = "t-title";
                h.textContent = title;
                inner.appendChild(h);
            }

            const qrNode = document.createElement("div");
            qrNode.className = "t-qr";
            inner.appendChild(qrNode);

            const code = document.createElement("div");
            code.className = "t-code";
            code.textContent = text;
            inner.appendChild(code);

            ticket.appendChild(inner);

            const feed = document.createElement("div");
            feed.className = "t-feed";
            ticket.appendChild(feed);

            printArea.appendChild(ticket);

            new QRCode(qrNode, {
                text,
                width: qrPx,
                height: qrPx,
                correctLevel: QRCode.CorrectLevel.M,
            });
        });
    }

    function buildAll() {
        const payloads = buildPayloads();
        renderPreview(payloads);
        renderPrintTickets(payloads);
        return payloads;
    }

    async function saveToDatabase(payloads, batchName) {
        if (!sessionRef) throw new Error("No hay sesión activa.");

        // 1. Create Batch
        const { data: batch, error: bError } = await supabaseClient
            .from("qr_batches")
            .insert({
                name: batchName,
                created_by: sessionRef.user.id
            })
            .select()
            .single();

        if (bError) throw bError;

        // 2. Insert Codes
        const codesToInsert = payloads.map(code => ({
            batch_id: batch.id,
            code: code,
            status: 'PENDIENTE'
        }));

        const { error: cError } = await supabaseClient
            .from("qr_codes")
            .insert(codesToInsert);

        if (cError) throw cError;

        return batch;
    }

    el("btnBack").addEventListener("click", () => window.location.href = "logistica-index.html");
    el("btnPreview").addEventListener("click", buildAll);
    el("btnPrint").addEventListener("click", async () => {
        const payloads = buildAll();
        const batchName = (el("batchName").value || "Lote sin nombre").trim();
        
        const btn = el("btnPrint");
        const originalHtml = btn.innerHTML;
        
        try {
            btn.disabled = true;
            btn.innerHTML = "Guardando...";
            
            await saveToDatabase(payloads, batchName);
            
            btn.innerHTML = "Imprimiendo...";
            // Wait for QR codes to render
            setTimeout(() => {
                window.print();
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }, 500);
            
        } catch (err) {
            console.error(err);
            alert("Error al guardar en la base de datos: " + err.message);
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    });

    el("btnClear").addEventListener("click", () => {
        el("previewArea").innerHTML = "";
        el("printArea").innerHTML = "";
        const meta = el("previewMeta");
        if (meta) meta.textContent = "Listo para generar";
    });

    // Initial state
    el("mode").dispatchEvent(new Event("change"));

    // macOS Shortcuts
    window.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            buildAll();
        }
    });

    (async function init() {
        try {
            sessionRef = await requireLogistica();
            if (!sessionRef) return;
        } catch (e) {
            console.error(e);
        }
    })();

})();
