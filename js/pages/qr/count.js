// Config is loaded from ../config.js which provides window.supabaseClient
const supabaseClient = window.supabaseClient;

const el = (id) => document.getElementById(id);

async function init() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (!session) {
        window.location.href = '../auth/login.html';
        return;
    }

    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

    if (!profile || profile.role !== 'ADMIN') {
        alert("Acceso restringido a Administradores.");
        window.location.href = '../auth/login.html';
        return;
    }

    loadData();
}

async function loadData() {
    try {
        // Fetch All Batches
        const { data: batches, error: bError } = await supabaseClient
            .from('qr_batches')
            .select('*')
            .order('created_at', { ascending: false });

        if (bError) throw bError;

        // Fetch Stats per Batch
        const { data: codes, error: cError } = await supabaseClient
            .from('qr_codes')
            .select('batch_id, status');

        if (cError) throw cError;

        renderStats(batches, codes);

    } catch (err) {
        console.error("Error loading stats:", err);
    }
}

function renderStats(batches, codes) {
    const batchList = el('batchList');
    batchList.innerHTML = "";

    let totalGlobal = codes.length;
    let totalScanned = codes.filter(c => c.status === 'ACREDITADO').length;

    // Main Progress
    const percentGlobal = totalGlobal > 0 ? Math.round((totalScanned / totalGlobal) * 100) : 0;
    el('mainProgressBar').style.width = `${percentGlobal}%`;
    el('progressPercent').textContent = `${percentGlobal}%`;
    el('progressRatio').textContent = `${totalScanned} / ${totalGlobal}`;
    el('totalScanned').textContent = totalScanned;

    // Per Batch stats
    batches.forEach(batch => {
        const batchCodes = codes.filter(c => c.batch_id === batch.id);
        const bTotal = batchCodes.length;
        const bScanned = batchCodes.filter(c => c.status === 'ACREDITADO').length;
        const bPercent = bTotal > 0 ? Math.round((bScanned / bTotal) * 100) : 0;

        const card = document.createElement('div');
        card.className = "batch-card";
        card.innerHTML = `
            <h4>${batch.name || 'Lote sin nombre'}</h4>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${bPercent}%"></div>
            </div>
            <div class="batch-meta">
                <span>${bPercent}% completado</span>
                <span>${bScanned} / ${bTotal}</span>
            </div>
        `;
        batchList.appendChild(card);
    });

    if (batches.length === 0) {
        batchList.innerHTML = '<p class="empty-msg">No hay lotes generados.</p>';
    }
}

el('btnRefresh').addEventListener('click', loadData);

init();
