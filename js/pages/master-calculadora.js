/* /js/pages/master-calculadora.js */

(function() {
  const T_CHANNELS = "pricing_channels";
  const T_PARAMS = "pricing_params";
  const T_RUNS = "pricing_runs";

  // =========================
  // State
  // =========================
  let currentParams = null;
  let allChannels = [];
  let historyDataset = [];
  let lastResult = null; // Store last calculation for saving

  // =========================
  // UI Refs
  // =========================
  const tabsNav = document.getElementById("tabsNav");
  const tabPanels = document.querySelectorAll(".tab-panel");
  
  // Calc
  const selChannel = document.getElementById("selChannel");
  const inCostNet = document.getElementById("inCostNet");
  const inInputsNet = document.getElementById("inInputsNet");
  const inMarginTarget = document.getElementById("inMarginTarget");
  const btnCalc = document.getElementById("btnCalc");
  const btnReset = document.getElementById("btnReset");
  const calcMsg = document.getElementById("calcMsg");

  // Results
  const outPriceFinal = document.getElementById("outPriceFinal");
  const outNetSale = document.getElementById("outNetSale");
  const outMargin = document.getElementById("outMargin");
  const outChannel = document.getElementById("outChannel");
  const outTotalCost = document.getElementById("outTotalCost");
  const outChannelFees = document.getElementById("outChannelFees");
  const outLocalTaxes = document.getElementById("outLocalTaxes");
  const outProfitBeforeGan = document.getElementById("outProfitBeforeGan");
  const outGanTax = document.getElementById("outGanTax");
  const outProfitAfter = document.getElementById("outProfitAfter");
  const outNetReceived = document.getElementById("outNetReceived");
  const outParamsLine = document.getElementById("outParamsLine");
  const btnCopyJson = document.getElementById("btnCopyJson");
  const btnSaveRun = document.getElementById("btnSaveRun");

  // History / Config
  const historyBody = document.getElementById("historyBody");
  const channelsBody = document.getElementById("channelsBody");
  const paramsBox = document.getElementById("paramsBox");

  // Modals
  const paramsModal = document.getElementById("paramsModal");
  const channelModal = document.getElementById("channelModal");
  const jsonModal = document.getElementById("jsonModal");

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
  function fmt(val, currency = true) {
    if (val === null || val === undefined || isNaN(val)) return "—";
    const num = Number(val);
    return currency 
      ? "$" + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : num.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + "%";
  }

  function setStatus(msg, bad = false) {
    calcMsg.textContent = msg || "";
    calcMsg.style.display = msg ? "block" : "none";
    calcMsg.className = "status-line" + (bad ? " is-bad" : "");
  }

  // =========================
  // Data Loading
  // =========================
  async function loadInitialData() {
    const client = window.supabaseClient;
    try {
      // 1. Params
      const { data: pData } = await client.from(T_PARAMS).select("*").eq("active", true).order("created_at", { ascending: false }).limit(1);
      currentParams = pData?.[0] || null;
      renderParams();

      // 2. Channels
      const { data: cData } = await client.from(T_CHANNELS).select("*").order("name", { ascending: true });
      allChannels = cData || [];
      renderChannels();
      updateChannelSelect();

      // 3. History
      loadHistory();
    } catch (e) {
      console.error(e);
    }
  }

  async function loadHistory() {
    const client = window.supabaseClient;
    const { data } = await client.from(T_RUNS).select("*").order("created_at", { ascending: false }).limit(20);
    historyDataset = data || [];
    renderHistory();
  }

  // =========================
  // Rendering
  // =========================
  function renderParams() {
    if (!currentParams) {
      paramsBox.innerHTML = `<p class="text-muted">No hay parámetros configurados.</p>`;
      return;
    }
    // Anti-g columns: iva, dgr, mun, gan
    document.getElementById("pIva").textContent = fmt(currentParams.iva * 100, false);
    document.getElementById("pDgr").textContent = fmt(currentParams.dgr * 100, false);
    document.getElementById("pMun").textContent = fmt(currentParams.mun * 100, false);
    document.getElementById("pGan").textContent = fmt(currentParams.gan * 100, false);
    document.getElementById("pFeeVat").textContent = currentParams.fee_vat_credit ? "SÍ" : "NO";
    document.getElementById("pValidFrom").textContent = currentParams.valid_from ? new Date(currentParams.valid_from).toLocaleDateString() : "S/D";
    
    outParamsLine.textContent = `Parametría: IVA ${currentParams.iva*100}%, DGR ${currentParams.dgr*100}%, MUN ${currentParams.mun*100}%, GAN ${currentParams.gan*100}%`;
  }

  function renderChannels() {
    channelsBody.innerHTML = allChannels.map(c => `
      <tr>
        <td class="cell-pl"><b>${c.name}</b></td>
        <td class="text-right">${fmt(c.arancel * 100, false)}</td>
        <td class="text-right">${fmt(c.ret * 100, false)}</td>
        <td class="text-center">
          <span class="tag ${c.active ? "tag-green" : "tag-gray"}">${c.active ? "SI" : "NO"}</span>
        </td>
        <td class="text-center cell-pr">
          <button class="btn-icon" onclick="editChannel('${c.id}')" style="background:transparent; border:none; cursor:pointer; font-size:16px;">⚙️</button>
        </td>
      </tr>
    `).join("");
  }

  function updateChannelSelect() {
    selChannel.innerHTML = `<option value="">Seleccioná canal...</option>` +
      allChannels.filter(c => c.active).map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  }

  function renderHistory() {
    if (!historyDataset.length) {
      historyBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No hay corridas guardadas.</td></tr>`;
      return;
    }
    historyBody.innerHTML = historyDataset.map(h => `
      <tr>
        <td class="cell-pl">${new Date(h.created_at).toLocaleString()}</td>
        <td>${h.channel_name}</td>
        <td class="text-right">${fmt(h.cost_net + (h.inputs_net || 0))}</td>
        <td class="text-right">${fmt(h.margin_target * 100, false)}</td>
        <td class="text-right"><b>${fmt(h.price_final)}</b></td>
        <td class="text-center cell-pr">
          <button class="btn-icon" onclick="viewJson('${h.id}')" style="background:transparent; border:none; cursor:pointer; font-size:16px;">📄</button>
        </td>
      </tr>
    `).join("");
  }

  // =========================
  // Calculation Engine
  // =========================
  function calculate() {
    setStatus("");
    if (!currentParams) return setStatus("Faltan parámetros globales", true);
    
    const channelId = selChannel.value;
    const channel = allChannels.find(c => c.id === channelId);
    if (!channel) return setStatus("Elegí un canal", true);

    const costNet = parseFloat(inCostNet.value) || 0;
    const inputsNet = parseFloat(inInputsNet.value) || 0;
    const marginTarget = (parseFloat(inMarginTarget.value) || 0) / 100;

    const C = costNet + inputsNet;
    const IVA = currentParams.iva;
    const DGR = currentParams.dgr;
    const MUN = currentParams.mun;
    const GAN = currentParams.gan;
    const F_pct_raw = channel.arancel; // e.g. 0.10
    
    // Fee adjustment: if fee vat credit is true, fee cost is net of VAT
    const F_pct = currentParams.fee_vat_credit ? (F_pct_raw / (1 + IVA)) : F_pct_raw;
    const T_pct = DGR + MUN;

    // Formula: V = C / [ (1 - F_pct - T_pct) - (marginTarget / (1-GAN)) ]
    const denom = (1 - F_pct - T_pct) - (marginTarget / (1 - GAN));

    if (denom <= 0) {
      lastResult = null;
      outPriceFinal.textContent = "IMP.";
      return setStatus("Margen imposible con estos costos/impuestos.", true);
    }

    const V = C / denom;
    const S = V * (1 + IVA);

    // Breakdown for UI
    const totalFees = V * F_pct;
    const localTaxes = V * T_pct;
    const profitBeforeGan = V - C - totalFees - localTaxes;
    const ganTax = profitBeforeGan * GAN;
    const profitAfter = profitBeforeGan - ganTax;
    const netReceived = V - totalFees - localTaxes;

    lastResult = {
      channel_id: channel.id,
      channel_name: channel.name,
      params_id: currentParams.id,
      cost_net: costNet,
      inputs_net: inputsNet,
      margin_target: marginTarget,
      price_final: S,
      price_net: V,
      cost_total: C,
      fees_canal: totalFees,
      taxes_local: localTaxes,
      profit_before_gan: profitBeforeGan,
      gan_tax: ganTax,
      profit_net: profitAfter,
      margin_achieved: profitAfter / V,
      net_received: netReceived
    };

    // Render results
    outPriceFinal.textContent = fmt(S);
    outNetSale.textContent = fmt(V);
    outMargin.textContent = fmt(lastResult.margin_achieved * 100, false);
    
    outChannel.textContent = channel.name;
    outTotalCost.textContent = fmt(C);
    outChannelFees.textContent = fmt(totalFees);
    outLocalTaxes.textContent = fmt(localTaxes);
    outProfitBeforeGan.textContent = fmt(profitBeforeGan);
    outGanTax.textContent = fmt(ganTax);
    outProfitAfter.textContent = fmt(profitAfter);
    outNetReceived.textContent = fmt(netReceived);

    btnCopyJson.disabled = false;
    btnSaveRun.disabled = false;
  }

  // =========================
  // Actions
  // =========================
  tabsNav.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    const tabId = btn.dataset.tab;
    
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    tabPanels.forEach(p => {
      p.style.display = p.id === tabId ? "block" : "none";
    });
  });

  btnCalc.addEventListener("click", calculate);
  btnReset.addEventListener("click", () => {
    inCostNet.value = "";
    inInputsNet.value = "";
    inMarginTarget.value = "35";
    selChannel.value = "";
    setStatus("");
    lastResult = null;
    outPriceFinal.textContent = "—";
    outNetSale.textContent = "—";
    outMargin.textContent = "—";
    btnCopyJson.disabled = true;
    btnSaveRun.disabled = true;
  });

  btnCopyJson.addEventListener("click", () => {
    if (!lastResult) return;
    navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
    const oldText = btnCopyJson.textContent;
    btnCopyJson.textContent = "¡COPIADO!";
    setTimeout(() => btnCopyJson.textContent = oldText, 2000);
  });

  btnSaveRun.addEventListener("click", async () => {
    if (!lastResult) return;
    const client = window.supabaseClient;
    try {
      setStatus("Guardando...");
      const { error } = await client.from(T_RUNS).insert({
        channel_id: lastResult.channel_id,
        channel_name: lastResult.channel_name,
        cost_net: lastResult.cost_net,
        inputs_net: lastResult.inputs_net,
        margin_target: lastResult.margin_target,
        price_final: lastResult.price_final,
        result_json: lastResult
      });
      if (error) throw error;
      setStatus("Corrida guardada.");
      btnSaveRun.disabled = true;
      loadHistory();
    } catch (e) {
      console.error(e);
      setStatus("Error al guardar", true);
    }
  });

  // =========================
  // Config Modals
  // =========================
  // Params
  document.getElementById("btnEditParams").addEventListener("click", () => {
    document.getElementById("paramsForm").reset();
    if (currentParams) {
      document.getElementById("fIva").value = currentParams.iva * 100;
      document.getElementById("fGan").value = currentParams.gan * 100;
      document.getElementById("fDgr").value = currentParams.dgr * 100;
      document.getElementById("fMun").value = currentParams.mun * 100;
      document.getElementById("fFeeVatCredit").checked = currentParams.fee_vat_credit;
    }
    paramsModal.style.display = "flex";
  });
  
  document.getElementById("btnParamsCancel").addEventListener("click", () => paramsModal.style.display = "none");
  document.getElementById("btnParamsSave").addEventListener("click", async () => {
    const client = window.supabaseClient;
    const payload = {
      iva: (parseFloat(document.getElementById("fIva").value) || 0) / 100,
      gan: (parseFloat(document.getElementById("fGan").value) || 0) / 100,
      dgr: (parseFloat(document.getElementById("fDgr").value) || 0) / 100,
      mun: (parseFloat(document.getElementById("fMun").value) || 0) / 100,
      fee_vat_credit: document.getElementById("fFeeVatCredit").checked,
      valid_from: document.getElementById("fValidFrom").value || new Date().toISOString(),
      active: true
    };
    try {
      // Deactivate others
      await client.from(T_PARAMS).update({ active: false }).eq("active", true);
      const { error } = await client.from(T_PARAMS).insert(payload);
      if (error) throw error;
      paramsModal.style.display = "none";
      loadInitialData();
    } catch (e) { alert(e.message); }
  });

  // Channel
  window.editChannel = (id) => {
    const chan = allChannels.find(c => c.id === id);
    if (!chan) return;
    document.getElementById("cId").value = chan.id;
    document.getElementById("cName").value = chan.name;
    document.getElementById("cArancel").value = chan.arancel * 100;
    document.getElementById("cRet").value = chan.ret * 100;
    document.getElementById("cObs").value = chan.obs || "";
    document.getElementById("cActive").checked = chan.active;
    document.getElementById("channelModalTitle").textContent = "EDITAR CANAL";
    channelModal.style.display = "flex";
  };

  document.getElementById("btnNewChannel").addEventListener("click", () => {
    document.getElementById("channelForm").reset();
    document.getElementById("cId").value = "";
    document.getElementById("cActive").checked = true;
    document.getElementById("channelModalTitle").textContent = "NUEVO CANAL";
    channelModal.style.display = "flex";
  });

  document.getElementById("btnChannelCancel").addEventListener("click", () => channelModal.style.display = "none");
  document.getElementById("btnChannelSave").addEventListener("click", async () => {
    const client = window.supabaseClient;
    const id = document.getElementById("cId").value;
    const payload = {
      name: document.getElementById("cName").value.trim().toUpperCase(),
      arancel: (parseFloat(document.getElementById("cArancel").value) || 0) / 100,
      ret: (parseFloat(document.getElementById("cRet").value) || 0) / 100,
      obs: document.getElementById("cObs").value.trim(),
      active: document.getElementById("cActive").checked
    };
    try {
      let error;
      if (id) ({ error } = await client.from(T_CHANNELS).update(payload).eq("id", id));
      else ({ error } = await client.from(T_CHANNELS).insert(payload));
      if (error) throw error;
      channelModal.style.display = "none";
      loadInitialData();
    } catch (e) { alert(e.message); }
  });

  // JSON View
  window.viewJson = (id) => {
    const run = historyDataset.find(h => h.id === id);
    if (!run) return;
    document.getElementById("jsonPre").textContent = JSON.stringify(run.result_json || run, null, 2);
    jsonModal.style.display = "flex";
  };
  document.getElementById("btnJsonClose").addEventListener("click", () => jsonModal.style.display = "none");

  document.getElementById("btnBack").addEventListener("click", () => window.location.href = "master-index.html");

  // =========================
  // Boot
  // =========================
  (async function init() {
    await requireAdmin();
    loadInitialData();
  })();

})();
