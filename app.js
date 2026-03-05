/* Lopes Serviços Mecânicos - PWA Offline + Sync Supabase (single table app_state)
   NÃO salva senha do Supabase no banco. Login Supabase via email/senha (Auth).
   Auto-sync: ao salvar + a cada X segundos + ao voltar pro app.
*/
const APP = {
  supabaseUrl: "https://euoetxrcwzkogtdbuiqj.supabase.co",
  supabaseAnonKey: "sb_publishable_q87P7Cy6GQHh6wNxtOOSZA_CwLXiFVN",
  storageKey: "lopes_mecanica_state_v1",
  pinKey: "lopes_mecanica_pin_v1",
  rememberEmailKey: "lopes_cloud_email_v1",
  rememberPassKey: "lopes_cloud_pass_v1",
};

const $ = (id) => document.getElementById(id);
const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("pt-BR");
const todayISO = () => new Date().toISOString().slice(0,10);
const norm = (s) => (s||"").toString().trim();
const normPlaca = (p) => norm(p).toUpperCase().replace(/[^A-Z0-9]/g,"");
const money = (n) => (Number(n||0)).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const uuid = () => crypto.randomUUID();

function addMonths(dateISO, months){
  const d = new Date(dateISO + "T00:00:00");
  const day = d.getDate();
  d.setMonth(d.getMonth() + Number(months||0));
  if(d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0,10);
}

function loadState(){
  const raw = localStorage.getItem(APP.storageKey);
  const base = {
    version: "1.2",
    updated_at: new Date().toISOString(),
    counters: { os: 1 },
    clients: [],
    vehicles: [],
    services: [],
    cash: [],
    settings: { rememberEmail: true, rememberPass: true }
  };
  if(!raw) return base;
  try{
    const data = JSON.parse(raw);
    // garante campos novos
    data.counters = data.counters || { os: 1 };
    data.clients = data.clients || [];
    data.vehicles = data.vehicles || [];
    data.services = data.services || [];
    data.cash = data.cash || [];
    data.settings = data.settings || { rememberEmail: true, rememberPass: true };
    data.updated_at = data.updated_at || new Date().toISOString();
    data.version = data.version || "1.2";
    return data;
  }catch{
    return base;
  }
}

let state = loadState();

// Supabase client (loaded via CDN)
let supabaseClient = null;
let session = null;

/* ===== Auto Sync control ===== */
let dirtySinceLastSync = false;
let syncTimer = null;
let syncInFlight = false;
let syncQueued = false;
let syncDebounceTimer = null;

// interval padrão (visível): 30s
const SYNC_INTERVAL_VISIBLE_MS = 30000;
// intervalo quando app fica oculto: 2 min
const SYNC_INTERVAL_HIDDEN_MS = 120000;

function toast(msg){
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.position="fixed";
  el.style.left="50%";
  el.style.bottom="18px";
  el.style.transform="translateX(-50%)";
  el.style.background="rgba(0,0,0,.78)";
  el.style.color="#fff";
  el.style.padding="10px 12px";
  el.style.border="1px solid rgba(255,255,255,.15)";
  el.style.borderRadius="12px";
  el.style.zIndex="9999";
  el.style.maxWidth="92vw";
  document.body.appendChild(el);
  setTimeout(()=> el.remove(), 2200);
}

/* Modal helpers */
const backdrop = $("modalBackdrop");
const modals = {
  client: $("modalClient"),
  vehicle: $("modalVehicle"),
  service: $("modalService"),
  config: $("modalConfig"),
  cash: $("modalCash"),
  cashTx: $("modalCashTx"),
  report: $("modalReport"),
  oilAlerts: $("modalOilAlerts"),
};
function closeAllModals(){
  if (backdrop) backdrop.hidden = true;
  Object.values(modals).forEach(m => { if(m) m.hidden = true; });
}
function openModal(which){
  if (backdrop) backdrop.hidden = false;
  if(modals[which]) modals[which].hidden = false;
}
document.addEventListener("click", (e)=>{
  const t = e.target;
  if(t === backdrop) return closeAllModals();
  const closeEl = t && t.closest ? t.closest("[data-close]") : null;
  if(closeEl) return closeAllModals();
});

function escapeHtml(str){
  return (str||"").toString()
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function matchesQuery(obj, q){
  const hay = JSON.stringify(obj).toLowerCase();
  return hay.includes(q.toLowerCase());
}

/* ===== Persistência local ===== */
function saveState({ sync = true } = {}){
  state.updated_at = new Date().toISOString();
  localStorage.setItem(APP.storageKey, JSON.stringify(state));
  dirtySinceLastSync = true;
  renderAll();

  // se estiver conectado, tenta sincronizar (debounce)
  if(sync) scheduleAutoSync("saveState");
}

/* ===== Sync helpers ===== */
function scheduleAutoSync(reason){
  // só agenda se estiver logado e online
  if(!session || !navigator.onLine) return;

  // debounce de 900ms pra não disparar várias vezes seguidas
  if(syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(()=>{
    cloudSyncSafe(reason).catch(()=>{});
  }, 900);
}

async function cloudSyncSafe(reason){
  if(syncInFlight){
    syncQueued = true;
    return;
  }
  syncInFlight = true;
  try{
    await cloudSync();
    dirtySinceLastSync = false;
  }catch(err){
    // falha silenciosa (não spammar toast)
    // se quiser ver o erro: console.warn(err)
  }finally{
    syncInFlight = false;
    if(syncQueued){
      syncQueued = false;
      // tenta novamente logo depois
      setTimeout(()=> cloudSyncSafe("queued").catch(()=>{}), 800);
    }
  }
}

function restartAutoSyncTimer(){
  if(syncTimer) clearInterval(syncTimer);
  const ms = document.hidden ? SYNC_INTERVAL_HIDDEN_MS : SYNC_INTERVAL_VISIBLE_MS;
  syncTimer = setInterval(()=>{
    if(session && navigator.onLine){
      // se não mudou nada, ainda assim puxa do remoto (pega atualizações do PC/celular)
      cloudSyncSafe("interval").catch(()=>{});
    }
  }, ms);
}

function labelTipo(t){
  const m = {
    troca_oleo:"Troca de óleo",
    revisao:"Revisão",
    freios:"Freios",
    suspensao:"Suspensão",
    arrefecimento:"Arrefecimento",
    eletrica:"Elétrica",
    pneus:"Pneus",
    alinhamento_balanceamento:"Alinhamento/Balanceamento",
    outro:"Outro"
  };
  return m[t] || t || "";
}

function labelPay(m){
  const map = {pix:"Pix", dinheiro:"Dinheiro", debito:"Débito", credito:"Crédito", boleto:"Boleto", outro:"Outro"};
  return map[m] || (m||"");
}

function dueBadgeForOil(service){
  if(service.tipo !== "troca_oleo") return null;
  const d = service.oil_next_date;
  const km = service.oil_next_km;
  const now = new Date();
  let due = false;
  let warn = false;
  if(d){
    const dd = new Date(d+"T00:00:00");
    const diffDays = Math.round((dd - now) / (1000*60*60*24));
    if(diffDays <= 0) due = true;
    else if(diffDays <= 14) warn = true;
  }
  const v = state.vehicles.find(v=>v.id===service.veiculo_id);
  if(v && km != null && Number(v.km_atual||0) >= Number(km)) due = true;
  else if(v && km != null && Number(km) - Number(v.km_atual||0) <= 300) warn = true;

  if(due) return {cls:"red", txt:"Vencido"};
  if(warn) return {cls:"warn", txt:"Perto"};
  return {cls:"ok", txt:"Em dia"};
}

/* ===== Render ===== */
function renderClients(){
  const q = norm($("q")?.value);
  const list = $("clientsList");
  if(!list) return;
  list.innerHTML = "";
  let items = state.clients.slice().sort((a,b)=> (a.nome||"").localeCompare(b.nome||""));
  if(q) items = items.filter(x=> matchesQuery(x,q));
  if(items.length===0){
    list.innerHTML = `<div class="muted">Nenhum cliente.</div>`;
    return;
  }
  for(const c of items){
    const el = document.createElement("div");
    el.className="item";
    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(c.nome||"(Sem nome)")}</div>
        <div class="sub">${c.whatsapp? "Whats: "+escapeHtml(c.whatsapp) : ""}</div>
      </div>
      <div class="badge">${escapeHtml((c.id||"").slice(0,8))}</div>
    `;
    el.onclick = ()=> openClient(c.id);
    list.appendChild(el);
  }
}

function renderVehicles(){
  const q = norm($("q")?.value);
  const list = $("vehiclesList");
  if(!list) return;
  list.innerHTML = "";
  let items = state.vehicles.slice().sort((a,b)=> (a.placa||"").localeCompare(b.placa||""));
  if(q) items = items.filter(x=> matchesQuery(x,q));
  if(items.length===0){
    list.innerHTML = `<div class="muted">Nenhum veículo.</div>`;
    return;
  }
  for(const v of items){
    const c = state.clients.find(c=>c.id===v.cliente_id);
    const el = document.createElement("div");
    el.className="item";
    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(v.placa||"(Sem placa)")}</div>
        <div class="sub">${escapeHtml(v.modelo||"")} • ${escapeHtml((c&&c.nome)||"")} • KM ${escapeHtml(String(v.km_atual??""))}</div>
      </div>
      <div class="badge">${escapeHtml((v.id||"").slice(0,8))}</div>
    `;
    el.onclick = ()=> openVehicle(v.id);
    list.appendChild(el);
  }
}

function renderServices(){
  const q = norm($("q")?.value);
  const list = $("servicesList");
  if(!list) return;
  list.innerHTML = "";
  let items = state.services.slice().sort((a,b)=> (b.created_at||"").localeCompare(a.created_at||""));
  if(q) items = items.filter(x=> matchesQuery(x,q));
  if(items.length===0){
    list.innerHTML = `<div class="muted">Nenhuma OS.</div>`;
    return;
  }
  for(const s of items){
    const v = state.vehicles.find(v=>v.id===s.veiculo_id);
    const c = state.clients.find(c=>c.id===s.cliente_id);
    const badge = dueBadgeForOil(s);
    const el = document.createElement("div");
    el.className="item";
    const title = s.os_numero ? `OS ${s.os_numero}` : (s.tipo==="troca_oleo" ? "Troca de óleo" : "Serviço");
    const sub = `${fmtDate(s.data_servico)} • ${v? v.placa:""} • ${c? c.nome:""} • ${money(s.total||0)}`;
    const payBadge = s.paid ? `<div class="badge ok">Pago</div>` : `<div class="badge">Aberto</div>`;
    const badgeHtml = badge ? `<div class="badge ${badge.cls}">${badge.txt}</div>${payBadge}` : `${payBadge}`;
    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(title)}</div>
        <div class="sub">${escapeHtml(sub)}</div>
        ${s.tipo==="troca_oleo" ? `<div class="sub">Próxima: ${s.oil_next_date? fmtDate(s.oil_next_date):"-"} ou ${s.oil_next_km? (s.oil_next_km+" km"):"-"}</div>` : ``}
      </div>
      ${badgeHtml}
    `;
    el.onclick = ()=> openService(s.id);
    list.appendChild(el);
  }
}

function renderChips(){
  const wrap = $("quickChips");
  if(!wrap) return;
  const due = state.services.filter(s=> s.tipo==="troca_oleo" && dueBadgeForOil(s)?.cls==="red").length;
  const near = state.services.filter(s=> s.tipo==="troca_oleo" && dueBadgeForOil(s)?.cls==="warn").length;
  wrap.innerHTML = `
    <div class="chip" data-chip="due">Trocas vencidas: <b>${due}</b></div>
    <div class="chip" data-chip="near">Perto de vencer: <b>${near}</b></div>
    <div class="chip" data-chip="all">Ver tudo</div>
  `;
  wrap.querySelectorAll(".chip").forEach(ch=>{
    ch.onclick = ()=>{
      const type = ch.getAttribute("data-chip");
      if(type==="all"){ $("q").value=""; renderAll(); return; }
      if(type==="due"){ $("q").value="\"troca_oleo\""; }
      if(type==="near"){ $("q").value="troca_oleo"; }
      renderAll();
    };
  });
}

function renderAll(){
  renderChips();
  renderClients();
  renderVehicles();
  renderServices();
  refreshSelects();
  refreshCloudStatus();
}

/* ===== CRUD - Cliente ===== */
let editingClientId = null;
function openClient(id){
  editingClientId = id;
  const c = state.clients.find(x=>x.id===id);
  $("clientTitle").textContent = c ? "Editar Cliente" : "Novo Cliente";
  $("clientNome").value = c?.nome || "";
  $("clientWhats").value = c?.whatsapp || "";
  $("clientObs").value = c?.observacoes || "";
  $("clientDelete").style.display = c ? "inline-block":"none";
  openModal("client");
}

$("btnNewClient")?.addEventListener("click", ()=> openClient(null));

$("clientSave")?.addEventListener("click", ()=>{
  const nome = norm($("clientNome").value);
  const whats = norm($("clientWhats").value).replace(/\D/g,"");
  const obs = norm($("clientObs").value);
  if(!nome){ toast("Informe o nome do cliente."); return; }
  if(editingClientId){
    const c = state.clients.find(x=>x.id===editingClientId);
    Object.assign(c,{nome,whatsapp:whats,observacoes:obs, updated_at:new Date().toISOString()});
  }else{
    state.clients.push({id:uuid(), nome, whatsapp:whats, observacoes:obs, created_at:new Date().toISOString(), updated_at:new Date().toISOString()});
  }
  saveState();
  closeAllModals();
});

$("clientDelete")?.addEventListener("click", ()=>{
  if(!editingClientId) return;
  if(!confirm("Excluir cliente?")) return;
  state.vehicles.forEach(v=>{ if(v.cliente_id===editingClientId) v.cliente_id=null; });
  state.clients = state.clients.filter(c=>c.id!==editingClientId);
  saveState();
  closeAllModals();
});

/* ===== CRUD - Veículo ===== */
let editingVehicleId = null;
function openVehicle(id){
  editingVehicleId = id;
  const v = state.vehicles.find(x=>x.id===id);
  $("vehicleTitle").textContent = v ? "Editar Veículo" : "Novo Veículo";
  $("vehicleCliente").value = v?.cliente_id || "";
  $("vehiclePlaca").value = v?.placa || "";
  $("vehicleMarca").value = v?.marca || "";
  $("vehicleModelo").value = v?.modelo || "";
  $("vehicleAno").value = v?.ano || "";
  $("vehicleKm").value = v?.km_atual ?? "";
  $("vehicleObs").value = v?.observacoes || "";
  $("vehicleDelete").style.display = v ? "inline-block":"none";
  openModal("vehicle");
}
$("btnNewVehicle")?.addEventListener("click", ()=> openVehicle(null));

$("vehicleSave")?.addEventListener("click", ()=>{
  const cliente_id = $("vehicleCliente").value || null;
  const placa = normPlaca($("vehiclePlaca").value);
  const marca = norm($("vehicleMarca").value);
  const modelo = norm($("vehicleModelo").value);
  const ano = norm($("vehicleAno").value);
  const km_atual = Number($("vehicleKm").value || 0);
  const obs = norm($("vehicleObs").value);
  if(!placa){ toast("Informe a placa."); return; }

  const exists = state.vehicles.find(x=> x.placa===placa && x.id!==editingVehicleId);
  if(exists){ toast("Já existe um veículo com essa placa."); return; }

  if(editingVehicleId){
    const v = state.vehicles.find(x=>x.id===editingVehicleId);
    Object.assign(v,{cliente_id,placa,marca,modelo,ano,km_atual,observacoes:obs, updated_at:new Date().toISOString()});
  }else{
    state.vehicles.push({id:uuid(), cliente_id, placa, marca, modelo, ano, km_atual, observacoes:obs, created_at:new Date().toISOString(), updated_at:new Date().toISOString()});
  }
  saveState();
  closeAllModals();
});

$("vehicleDelete")?.addEventListener("click", ()=>{
  if(!editingVehicleId) return;
  if(!confirm("Excluir veículo? As OS deste veículo também serão removidas.")) return;
  state.services = state.services.filter(s=>s.veiculo_id!==editingVehicleId);
  state.vehicles = state.vehicles.filter(v=>v.id!==editingVehicleId);
  saveState();
  closeAllModals();
});

/* ===== OS ===== */
let editingServiceId = null;

function nextOsNumber(){
  const n = state.counters?.os || 1;
  state.counters.os = n + 1;
  return String(n).padStart(6,"0");
}

function onOilIntervalChange(){
  const v = $("oilKmInterval")?.value;
  if($("oilKmCustom")) $("oilKmCustom").hidden = v !== "custom";
}
function toggleOilBlock(){
  if(!$("oilBlock") || !$("osTipo")) return;
  $("oilBlock").style.display = $("osTipo").value === "troca_oleo" ? "block":"none";
}
function previewOil(){
  if(!$("osTipo") || $("osTipo").value !== "troca_oleo"){ if($("oilPreview")) $("oilPreview").textContent=""; return; }
  const kmServico = Number($("osKm").value||0);
  const dateServico = $("osData").value || todayISO();
  let kmInt = $("oilKmInterval").value;
  if(kmInt==="custom") kmInt = Number($("oilKmCustom").value||0);
  else kmInt = Number(kmInt);
  const months = Number($("oilMonths").value||6);
  const nextKm = kmServico && kmInt ? (kmServico + kmInt) : null;
  const nextDate = addMonths(dateServico, months);
  if($("oilPreview")) $("oilPreview").textContent = `Próxima troca: ${fmtDate(nextDate)} ou ${nextKm ? (nextKm+" km") : "—"} (o que vencer primeiro).`;
}

// Pagamento: info de troco e recebido
function updatePayInfo(){
  const info = $("osPayInfo");
  if(!info) return;
  const total = Number($("osTotal")?.value || 0);
  const recv = Number($("osPayAmount")?.value || 0);
  const change = Number($("osPayChange")?.value || 0);
  if(!recv && !change){
    info.textContent = "";
    return;
  }
  const diff = (recv - total - change);
  info.textContent = `Total: ${money(total)} • Recebido: ${money(recv)} • Troco: ${money(change)} • Dif: ${money(diff)}`;
}

function filterVehiclesForOs(){
  const sel = $("osVeiculo");
  const cid = $("osCliente")?.value;
  if(!sel) return;
  const all = state.vehicles.filter(v=> !cid || v.cliente_id===cid);
  sel.innerHTML = `<option value="">Selecione…</option>` + all.map(v=> `<option value="${v.id}">${escapeHtml(v.placa)} — ${escapeHtml(v.modelo||"")}</option>`).join("");
}

function openService(id){
  editingServiceId = id;
  const s = state.services.find(x=>x.id===id);

  $("serviceTitle").textContent = s ? "Editar OS" : "Nova OS";
  $("osData").value = s?.data_servico || todayISO();
  $("osKm").value = s?.km_servico ?? "";
  $("osTipo").value = s?.tipo || "troca_oleo";
  $("osObs").value = s?.observacoes || "";
  $("osTotal").value = s?.total ?? "";
  $("osNumero").value = s?.os_numero || (s? "": nextOsNumber());

  // pagamento
  if($("osPaid")) $("osPaid").checked = !!s?.paid;
  if($("osPayMethod")) $("osPayMethod").value = s?.pay_method || "pix";
  if($("osPayAmount")) $("osPayAmount").value = s?.pay_amount ?? "";
  if($("osPayChange")) $("osPayChange").value = s?.pay_change ?? "";
  updatePayInfo();

  $("osCliente").value = s?.cliente_id || "";
  setTimeout(()=>{
    filterVehiclesForOs();
    $("osVeiculo").value = s?.veiculo_id || "";
  },0);

  // óleo
  $("oilKmInterval").value = s?.oil_km_interval || "10000";
  $("oilKmCustom").value = s?.oil_km_custom || "";
  $("oilMonths").value = s?.oil_months || 6;
  $("oilSpec").value = s?.oil_spec || "";
  onOilIntervalChange();
  toggleOilBlock();
  previewOil();

  $("serviceDelete").style.display = s ? "inline-block":"none";
  openModal("service");
}

$("btnNewOS")?.addEventListener("click", ()=> openService(null));

$("osCliente")?.addEventListener("change", filterVehiclesForOs);
$("osTipo")?.addEventListener("change", ()=> { toggleOilBlock(); previewOil(); });

$("oilKmInterval")?.addEventListener("change", ()=> { onOilIntervalChange(); previewOil(); });
$("oilKmCustom")?.addEventListener("input", previewOil);
$("oilMonths")?.addEventListener("input", previewOil);
$("osData")?.addEventListener("change", previewOil);
$("osKm")?.addEventListener("input", previewOil);

$("osTotal")?.addEventListener("input", updatePayInfo);
$("osPayAmount")?.addEventListener("input", updatePayInfo);
$("osPayChange")?.addEventListener("input", updatePayInfo);

$("serviceSave")?.addEventListener("click", ()=>{
  const cliente_id = $("osCliente").value || null;
  const veiculo_id = $("osVeiculo").value || null;
  const data_servico = $("osData").value || todayISO();
  const km_servico = Number($("osKm").value||0);
  const tipo = $("osTipo").value;
  const observacoes = norm($("osObs").value);
  const total = Number($("osTotal").value||0);
  const os_numero = norm($("osNumero").value);

  const paid = !!$("osPaid")?.checked;
  const pay_method = $("osPayMethod")?.value || "pix";
  const pay_amount = Number($("osPayAmount")?.value||0);
  const pay_change = Number($("osPayChange")?.value||0);

  if(!cliente_id){ toast("Selecione o cliente."); return; }
  if(!veiculo_id){ toast("Selecione o veículo."); return; }
  if(!data_servico){ toast("Informe a data."); return; }

  let oil_next_date=null, oil_next_km=null, oil_km_interval=null, oil_km_custom=null, oil_months=null, oil_spec=null;
  if(tipo==="troca_oleo"){
    let kmInt = $("oilKmInterval").value;
    oil_km_interval = kmInt;
    if(kmInt==="custom"){
      oil_km_custom = Number($("oilKmCustom").value||0) || null;
      kmInt = oil_km_custom || 0;
    }else{
      kmInt = Number(kmInt);
    }
    oil_months = Number($("oilMonths").value||6);
    oil_spec = norm($("oilSpec").value);
    oil_next_date = addMonths(data_servico, oil_months);
    oil_next_km = km_servico && kmInt ? (km_servico + kmInt) : null;
  }

  if(editingServiceId){
    const s = state.services.find(x=>x.id===editingServiceId);
    Object.assign(s,{cliente_id,veiculo_id,data_servico,km_servico,tipo,observacoes,total,os_numero,
      paid, pay_method, pay_amount, pay_change,
      oil_next_date,oil_next_km,oil_km_interval,oil_km_custom,oil_months,oil_spec,
      updated_at:new Date().toISOString()
    });
  }else{
    state.services.push({
      id: uuid(),
      cliente_id, veiculo_id,
      data_servico, km_servico,
      tipo, observacoes, total, os_numero,
      paid, pay_method, pay_amount, pay_change,
      oil_next_date, oil_next_km, oil_km_interval, oil_km_custom, oil_months, oil_spec,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

  const v = state.vehicles.find(v=>v.id===veiculo_id);
  if(v && km_servico && km_servico > Number(v.km_atual||0)){
    v.km_atual = km_servico;
    v.updated_at = new Date().toISOString();
  }

  saveState();
  closeAllModals();
  scheduleAutoSync("saveOS");
});

$("serviceDelete")?.addEventListener("click", ()=>{
  if(!editingServiceId) return;
  if(!confirm("Excluir esta OS?")) return;
  state.services = state.services.filter(s=>s.id!==editingServiceId);
  saveState();
  closeAllModals();
});

/* Print */
$("btnPrint")?.addEventListener("click", ()=> printCurrentOS());
$("btnWhats")?.addEventListener("click", ()=> sendWhats());

function printCurrentOS(){
  const s = editingServiceId ? state.services.find(x=>x.id===editingServiceId) : null;
  const snap = s || {
    cliente_id: $("osCliente").value,
    veiculo_id: $("osVeiculo").value,
    data_servico: $("osData").value,
    km_servico: Number($("osKm").value||0),
    tipo: $("osTipo").value,
    observacoes: norm($("osObs").value),
    total: Number($("osTotal").value||0),
    os_numero: norm($("osNumero").value),
    oil_next_date: $("osTipo").value==="troca_oleo" ? addMonths($("osData").value||todayISO(), Number($("oilMonths").value||6)) : null,
    oil_next_km: $("osTipo").value==="troca_oleo" ? (Number($("osKm").value||0) + Number(($("oilKmInterval").value==="custom" ? ($("oilKmCustom").value||0) : $("oilKmInterval").value)||0)) : null,
    oil_spec: norm($("oilSpec").value),
  };
  const c = state.clients.find(c=>c.id===snap.cliente_id);
  const v = state.vehicles.find(v=>v.id===snap.veiculo_id);

  const printArea = $("printArea");
  if(!printArea) return;
  printArea.hidden = false;
  printArea.innerHTML = `
    <div class="os-page">
      <div class="os-header">
        <img src="assets/logo.png" alt="Logo" />
        <div class="htext">
          <div class="t">Lopes Serviços Mecânicos</div>
          <div class="s">Leme/SP • (19) 99772-6572</div>
          <div class="s">${escapeHtml(snap.os_numero? ("OS Nº "+snap.os_numero) : "Ordem de Serviço")}</div>
        </div>
        <div style="min-width:60mm; text-align:right">
          <div class="label">Data</div>
          <div class="value">${escapeHtml(fmtDate(snap.data_servico))}</div>
          <div class="label" style="margin-top:3mm">KM</div>
          <div class="value">${escapeHtml(String(snap.km_servico||""))}</div>
        </div>
      </div>

      <div class="os-box">
        <div class="os-grid">
          <div>
            <div class="label">Cliente</div>
            <div class="value">${escapeHtml(c?.nome || "")}</div>
          </div>
          <div>
            <div class="label">WhatsApp</div>
            <div class="value">${escapeHtml(c?.whatsapp || "")}</div>
          </div>
          <div class="full">
            <div class="label">Veículo</div>
            <div class="value">${escapeHtml((v?.placa||"") + " • " + (v?.modelo||"") + (v?.ano?(" • "+v.ano):""))}</div>
          </div>
        </div>
      </div>

      <div class="os-box">
        <div class="label">Tipo de serviço</div>
        <div class="value">${escapeHtml(labelTipo(snap.tipo))}</div>
        ${snap.tipo==="troca_oleo" ? `
          <div class="os-hr"></div>
          <div class="os-grid">
            <div>
              <div class="label">Óleo / especificação</div>
              <div class="value">${escapeHtml(snap.oil_spec || "-")}</div>
            </div>
            <div>
              <div class="label">Próxima troca</div>
              <div class="value">${escapeHtml(snap.oil_next_date ? fmtDate(snap.oil_next_date) : "-")}${snap.oil_next_km ? " ou "+snap.oil_next_km+" km":""}</div>
            </div>
          </div>
        `:``}
      </div>

      <div class="os-box">
        <div class="label">Itens / Observações</div>
        <div class="value" style="font-weight:600; white-space:pre-wrap">${escapeHtml(snap.observacoes||"-")}</div>
      </div>

      <div class="os-box">
        <div class="os-grid">
          <div>
            <div class="label">Total</div>
            <div class="value">${escapeHtml(money(snap.total||0))}</div>
          </div>
          <div>
            <div class="label">Assinatura</div>
            <div class="value" style="font-weight:400">________________________________</div>
          </div>
        </div>
      </div>

      <div class="os-foot">
        <div>Gerado pelo sistema Lopes Serviços Mecânicos</div>
        <div>${new Date().toLocaleString("pt-BR")}</div>
      </div>
    </div>
  `;
  window.print();
  setTimeout(()=>{ printArea.innerHTML=""; printArea.hidden=true; }, 500);
}

function sendWhats(){
  const cid = $("osCliente")?.value;
  const vid = $("osVeiculo")?.value;
  const c = state.clients.find(c=>c.id===cid);
  const v = state.vehicles.find(v=>v.id===vid);
  if(!c?.whatsapp){ toast("Cliente sem WhatsApp cadastrado."); return; }

  const tipo = labelTipo($("osTipo")?.value);
  const data = $("osData")?.value ? fmtDate($("osData").value) : "";
  const total = money($("osTotal")?.value||0);
  let msg = `Olá ${c.nome}! 👋\n\nOS ${$("osNumero")?.value||""}\nServiço: ${tipo}\nVeículo: ${v?.placa||""} ${v?.modelo||""}\nData: ${data}\nTotal: ${total}\n\nQualquer dúvida, estamos à disposição.\nLopes Serviços Mecânicos`;
  if($("osTipo")?.value==="troca_oleo"){
    previewOil();
    msg += `\n\nPróxima troca: ${$("oilPreview")?.textContent.replace("Próxima troca: ","")}`;
  }
  const url = `https://wa.me/55${c.whatsapp}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
}

/* Select refresh */
function refreshSelects(){
  const selC = $("vehicleCliente");
  if(selC){
    const cur = selC.value;
    selC.innerHTML = `<option value="">(Sem cliente)</option>` + state.clients
      .slice().sort((a,b)=>(a.nome||"").localeCompare(b.nome||""))
      .map(c=> `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join("");
    selC.value = cur || "";
  }

  const osC = $("osCliente");
  if(osC){
    const osCur = osC.value;
    osC.innerHTML = `<option value="">Selecione…</option>` + state.clients
      .slice().sort((a,b)=>(a.nome||"").localeCompare(b.nome||""))
      .map(c=> `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join("");
    osC.value = osCur || "";
  }
  filterVehiclesForOs();
}

/* Config + PIN */
$("btnConfig")?.addEventListener("click", ()=> openModal("config"));

$("btnPin")?.addEventListener("click", ()=>{
  const oldPin = $("pinOld").value || "";
  const newPin = $("pinNew").value || "";
  const cur = localStorage.getItem(APP.pinKey) || "1234";
  if(oldPin !== cur){ toast("PIN atual incorreto."); return; }
  if(newPin.length < 4){ toast("Novo PIN deve ter 4+ dígitos."); return; }
  localStorage.setItem(APP.pinKey, newPin);
  $("pinOld").value=""; $("pinNew").value="";
  toast("PIN atualizado.");
});

$("btnExport")?.addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `lopes-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("importFile")?.addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  const text = await file.text();
  try{
    const data = JSON.parse(text);
    if(!data.clients || !data.vehicles || !data.services) throw new Error("Formato inválido");
    state = data;
    saveState({ sync: true });
    toast("Backup importado.");
  }catch(err){
    toast("Falha ao importar: " + err.message);
  }finally{
    e.target.value="";
  }
});

$("btnWipe")?.addEventListener("click", ()=>{
  if(!confirm("Zerar tudo? Isso apaga clientes, veículos e OS do aparelho.")) return;
  localStorage.removeItem(APP.storageKey);
  state = loadState();
  saveState({ sync: true });
  toast("Dados locais zerados.");
});

/* ===== Cloud / Supabase ===== */
async function ensureSupabaseReady(){
  if(supabaseClient) return supabaseClient;
  const start = Date.now();
  while(!window.supabase && (Date.now() - start) < 5000){
    await new Promise(r => setTimeout(r, 100));
  }
  if(!window.supabase){
    throw new Error("Supabase não carregou. Atualize a página (Ctrl+Shift+R) e tente novamente. Se usar bloqueador/antivírus, tente desativar para este site.");
  }
  supabaseClient = window.supabase.createClient(APP.supabaseUrl, APP.supabaseAnonKey);
  return supabaseClient;
}

async function cloudLogin(email, password){
  const client = await ensureSupabaseReady();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if(error) throw error;
  session = data.session;
  return session;
}

async function cloudLogout(){
  const client = await ensureSupabaseReady();
  await client.auth.signOut();
  session = null;
}

async function cloudSync(){
  const client = await ensureSupabaseReady();
  const { data: sess } = await client.auth.getSession();
  session = sess.session;
  if(!session) throw new Error("Não conectado.");
  const owner_id = session.user.id;

  // Pull
  const { data: rows, error: selErr } = await client
    .from("app_state")
    .select("*")
    .eq("owner_id", owner_id)
    .limit(1);

  if(selErr) throw selErr;

  if(rows && rows.length){
    const remote = rows[0];
    const remoteUpdated = new Date(remote.updated_at).getTime();
    const localUpdated = new Date(state.updated_at || 0).getTime();

    if(remoteUpdated > localUpdated){
      state = remote.payload;
      state.version = state.version || "1.2";
      state.updated_at = remote.updated_at;
      // garante campos novos
      state.cash = state.cash || [];
      state.settings = state.settings || { rememberEmail: true, rememberPass: true };
      localStorage.setItem(APP.storageKey, JSON.stringify(state));
      renderAll();
    }
  }

  // Push (upsert)
  const payload = state;
  const { error: upErr } = await client
    .from("app_state")
    .upsert({
      owner_id,
      payload,
      updated_at: new Date().toISOString()
    }, { onConflict: "owner_id" });

  if(upErr) throw upErr;
}

function refreshCloudStatus(){
  const pill = $("cloudStatus");
  if(!pill) return;
  const online = navigator.onLine;
  pill.textContent = session ? (online ? "Conectado" : "Conectado (sem internet)") : (online ? "Não conectado" : "Offline");
  pill.style.borderColor = session ? "rgba(43,213,118,.35)" : "rgba(255,255,255,.15)";
}

/* Lembrar email/senha (preencher campos) */
function initRememberCloudCreds(){
  const emailEl = $("cloudEmail");
  const passEl = $("cloudPass");
  if(emailEl){
    const savedEmail = localStorage.getItem(APP.rememberEmailKey) || "";
    if(savedEmail) emailEl.value = savedEmail;
  }
  if(passEl){
    const savedPass = localStorage.getItem(APP.rememberPassKey) || "";
    if(savedPass) passEl.value = savedPass;
  }
}

/* Botões nuvem */
$("btnCloudLogin")?.addEventListener("click", async ()=>{
  try{
    const email = $("cloudEmail").value.trim();
    const pass = $("cloudPass").value;
    if(!email || !pass){ toast("Informe e-mail e senha."); return; }

    // salva para preencher automaticamente depois
    localStorage.setItem(APP.rememberEmailKey, email);
    localStorage.setItem(APP.rememberPassKey, pass);

    await cloudLogin(email, pass);
    refreshCloudStatus();

    // assim que logar, já sincroniza na hora e liga autosync
    await cloudSyncSafe("login");
    restartAutoSyncTimer();
    toast("Conectado ✅ (Auto-sync ligado)");
  }catch(err){
    toast("Erro: " + (err?.message || err));
  }
});

$("btnCloudLogout")?.addEventListener("click", async ()=>{
  try{
    await cloudLogout();
    refreshCloudStatus();
    toast("Desconectado.");
  }catch(err){
    toast("Erro: " + (err?.message || err));
  }
});

$("btnCloudSync")?.addEventListener("click", async ()=>{
  try{
    await cloudSyncSafe("manual");
    toast("Sincronizado ✅");
  }catch(err){
    toast("Falha sync: " + (err?.message || err));
  }
});

$("btnSync")?.addEventListener("click", async ()=>{
  try{
    await cloudSyncSafe("quick");
    toast("Sincronizado ✅");
  }catch(err){
    toast("Falha: " + (err?.message || err));
  }
});

window.addEventListener("online", ()=>{
  refreshCloudStatus();
  if(session) cloudSyncSafe("online").catch(()=>{});
});
window.addEventListener("offline", refreshCloudStatus);

document.addEventListener("visibilitychange", ()=>{
  // muda intervalo e tenta sincronizar ao voltar
  restartAutoSyncTimer();
  if(!document.hidden && session && navigator.onLine){
    cloudSyncSafe("resume").catch(()=>{});
  }
});

/* Init auth (pega sessão existente) */
async function initAuthState(){
  try{
    const client = await ensureSupabaseReady();
    const { data } = await client.auth.getSession();
    session = data.session;
  }catch{ /* ignore */ }
  refreshCloudStatus();
  if(session){
    restartAutoSyncTimer();
    // puxa atualizações do outro aparelho ao abrir
    cloudSyncSafe("startup").catch(()=>{});
  }
}

/* ===== Extra features v4.0 ===== */

// Marcas e modelos (base offline - principais do Brasil)
const VEHICLE_DB = {
  "Chevrolet": ["Onix","Onix Plus","Prisma","Celta","Corsa","Classic","Cruze","Tracker","S10","Spin","Montana","Astra","Vectra"],
  "Volkswagen": ["Gol","Voyage","Polo","Virtus","T-Cross","Nivus","Saveiro","Fox","Up!","Jetta","Amarok","Parati"],
  "Fiat": ["Uno","Mobi","Argo","Cronos","Palio","Siena","Strada","Toro","Punto","Idea","Doblo","Fiorino"],
  "Ford": ["Ka","Fiesta","Focus","Ecosport","Ranger","Fusion"],
  "Renault": ["Kwid","Sandero","Logan","Duster","Captur","Oroch"],
  "Hyundai": ["HB20","HB20S","Creta","Tucson","i30"],
  "Toyota": ["Corolla","Etios","Yaris","Hilux","SW4","RAV4"],
  "Honda": ["Civic","City","Fit","HR-V","WR-V"],
  "Nissan": ["Kicks","Versa","March","Sentra","Frontier"],
  "Jeep": ["Renegade","Compass","Commander"],
  "Peugeot": ["206","207","208","2008","307","308"],
  "Citroën": ["C3","C4 Cactus","Aircross","Xsara Picasso"],
  "Kia": ["Sportage","Cerato","Soul"],
  "Mitsubishi": ["L200","ASX","Outlander","Pajero"],
  "Chery": ["Tiggo 2","Tiggo 3X","Tiggo 5X","Tiggo 7","Arrizo 5"],
  "BYD": ["Dolphin","Song Plus","Yuan Plus","Seal"],
  "Mercedes-Benz": ["Classe A","Classe C","Classe E","Sprinter"],
  "BMW": ["Série 1","Série 3","X1","X3","X5"],
  "Audi": ["A3","A4","Q3","Q5"],
};

function initVehicleDatalists(){
  const dlB = $("dlMarcas");
  if(!dlB) return;
  dlB.innerHTML = Object.keys(VEHICLE_DB).sort().map(b=>`<option value="${escapeHtml(b)}"></option>`).join("");
  updateModelsForBrand();
  const marca = $("vehicleMarca");
  if(marca){
    marca.addEventListener("input", ()=> updateModelsForBrand());
  }
}

function updateModelsForBrand(){
  const dlM = $("dlModelos");
  const marca = norm($("vehicleMarca")?.value);
  if(!dlM) return;
  const models = VEHICLE_DB[marca] || [];
  dlM.innerHTML = models.map(m=>`<option value="${escapeHtml(m)}"></option>`).join("");
}

// Busca por placa (automaticamente preenche se existir)
function wirePlateAutofill(){
  const placaEl = $("vehiclePlaca");
  if(!placaEl) return;
  let t=null;
  placaEl.addEventListener("input", ()=>{
    clearTimeout(t);
    t=setTimeout(()=>{
      const p = normPlaca(placaEl.value);
      if(!p) return;
      const found = state.vehicles.find(v=>v.placa===p && v.id!==editingVehicleId);
      if(found){
        $("vehicleCliente").value = found.cliente_id || "";
        $("vehicleMarca").value = found.marca || "";
        updateModelsForBrand();
        $("vehicleModelo").value = found.modelo || "";
        $("vehicleAno").value = found.ano || "";
        $("vehicleKm").value = found.km_atual ?? "";
        $("vehicleObs").value = found.observacoes || "";
        toast("Placa já cadastrada — dados preenchidos.");
      }
    }, 250);
  });
}

/* ===== Caixa ===== */
let cashTxMode = "in"; // in/out

function cashBalance(){
  const txs = state.cash || [];
  let bal=0;
  for(const t of txs){
    const sign = t.type === "out" ? -1 : 1;
    bal += sign * Number(t.amount||0);
  }
  return bal;
}

function renderCash(){
  const pill = $("cashBalancePill");
  if(pill) pill.textContent = `Saldo: ${money(cashBalance())}`;

  const q = norm($("cashQ")?.value);
  const list = $("cashList");
  if(!list) return;

  const txs = (state.cash||[]).slice().sort((a,b)=> (b.date||"").localeCompare(a.date||""));
  const filtered = q ? txs.filter(t=> matchesQuery(t,q)) : txs;

  if(filtered.length===0){
    list.innerHTML = `<div class="muted">Nenhum movimento.</div>`;
    return;
  }

  list.innerHTML = "";
  for(const t of filtered){
    const el = document.createElement("div");
    el.className="item";
    const sign = t.type==="out" ? "-" : "+";
    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml(t.desc||"(Sem descrição)")}</div>
        <div class="sub">${escapeHtml(fmtDate(t.date))} • ${escapeHtml(labelPay(t.method))}</div>
      </div>
      <div class="badge ${t.type==="out"?"red":"ok"}">${sign} ${money(t.amount||0)}</div>
    `;
    el.onclick = ()=>{
      if(!confirm("Excluir este movimento do caixa?")) return;
      state.cash = (state.cash||[]).filter(x=>x.id!==t.id);
      saveState();
    };
    list.appendChild(el);
  }
}

function openCash(){
  renderCash();
  openModal("cash");
}

function openCashTx(mode){
  cashTxMode = mode;
  $("cashTxTitle").textContent = mode==="out" ? "Saída" : "Entrada";
  $("cashTxDate").value = todayISO();
  $("cashTxDesc").value = "";
  $("cashTxMethod").value = "pix";
  $("cashTxAmount").value = "";
  openModal("cashTx");
}

function saveCashTx(){
  const date = $("cashTxDate").value || todayISO();
  const desc = norm($("cashTxDesc").value);
  const method = $("cashTxMethod").value;
  const amount = Number($("cashTxAmount").value||0);
  if(!desc){ toast("Informe a descrição."); return; }
  if(!amount || amount<=0){ toast("Informe o valor."); return; }
  state.cash = state.cash || [];
  state.cash.push({id:uuid(), type: cashTxMode, date, desc, method, amount, created_at:new Date().toISOString()});
  saveState();
  closeAllModals();
}

/* ===== Relatório ===== */
function monthKey(iso){ return (iso||"").slice(0,7); } // YYYY-MM

function buildReportMonthOptions(){
  const sel = $("reportMonth");
  if(!sel) return;
  const months = new Set();
  for(const s of state.services||[]) months.add(monthKey(s.data_servico));
  for(const t of state.cash||[]) months.add(monthKey(t.date));
  const arr = Array.from(months).filter(Boolean).sort().reverse();
  const cur = sel.value || arr[0] || monthKey(todayISO());
  sel.innerHTML = arr.map(m=>`<option value="${m}">${m}</option>`).join("");
  if(!arr.includes(cur) && arr.length) sel.value = arr[0];
  else sel.value = cur;
}

function renderReport(){
  const m = $("reportMonth")?.value || monthKey(todayISO());
  const monthServices = (state.services||[]).filter(s=> monthKey(s.data_servico)===m);
  const paidTotal = monthServices.filter(s=>s.paid).reduce((a,s)=>a+Number(s.total||0),0);
  const openTotal = monthServices.filter(s=>!s.paid).reduce((a,s)=>a+Number(s.total||0),0);
  if($("repPaid")) $("repPaid").textContent = money(paidTotal);
  if($("repOpen")) $("repOpen").textContent = money(openTotal);
  if($("repCount")) $("repCount").textContent = String(monthServices.length);

  const by = {};
  for(const s of monthServices.filter(s=>s.paid)){
    const k = s.pay_method || "outro";
    by[k] = (by[k]||0) + Number(s.total||0);
  }
  const txs = (state.cash||[]).filter(t=> monthKey(t.date)===m);
  const cashIn = txs.filter(t=>t.type!=="out").reduce((a,t)=>a+Number(t.amount||0),0);
  const cashOut = txs.filter(t=>t.type==="out").reduce((a,t)=>a+Number(t.amount||0),0);

  const list = $("repBreakdown");
  if(list){
    const rows = Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`
      <div class="item">
        <div><div class="title">${escapeHtml(labelPay(k))}</div><div class="sub">OS pagas</div></div>
        <div class="badge ok">${money(v)}</div>
      </div>
    `).join("");
    list.innerHTML = rows + `
      <div class="item">
        <div><div class="title">Caixa • Entradas</div><div class="sub">${escapeHtml(m)}</div></div>
        <div class="badge ok">${money(cashIn)}</div>
      </div>
      <div class="item">
        <div><div class="title">Caixa • Saídas</div><div class="sub">${escapeHtml(m)}</div></div>
        <div class="badge red">- ${money(cashOut)}</div>
      </div>
    `;
  }
}

function openReport(){
  buildReportMonthOptions();
  renderReport();
  openModal("report");
}

function exportReportCSV(){
  const m = $("reportMonth")?.value || monthKey(todayISO());
  const monthServices = (state.services||[]).filter(s=> monthKey(s.data_servico)===m);
  const header = ["data","os","cliente","placa","tipo","total","pago","forma_pagamento"];
  const lines = [header.join(",")];
  for(const s of monthServices){
    const c = state.clients.find(x=>x.id===s.cliente_id);
    const v = state.vehicles.find(x=>x.id===s.veiculo_id);
    const row = [
      s.data_servico||"",
      s.os_numero||"",
      (c?.nome||"").replaceAll('"','""'),
      v?.placa||"",
      s.tipo||"",
      String(Number(s.total||0)).replace(".",","),
      s.paid?"sim":"nao",
      s.pay_method||""
    ];
    lines.push(row.map(x=>`"${String(x)}"`).join(","));
  }
  const blob = new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `relatorio-${m}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ===== Avisos troca de óleo ===== */
function renderOilAlerts(){
  const list = $("oilAlertsList");
  if(!list) return;
  const items = (state.services||[])
    .filter(s=>s.tipo==="troca_oleo")
    .map(s=>({s, badge: dueBadgeForOil(s)}))
    .filter(x=>x.badge && (x.badge.cls==="red" || x.badge.cls==="warn"))
    .sort((a,b)=> (a.s.oil_next_date||"").localeCompare(b.s.oil_next_date||""));

  if(items.length===0){
    list.innerHTML = `<div class="muted">Nenhum aviso no momento.</div>`;
    return;
  }

  list.innerHTML="";
  for(const {s,badge} of items){
    const v = state.vehicles.find(v=>v.id===s.veiculo_id);
    const c = state.clients.find(c=>c.id===s.cliente_id);
    const el = document.createElement("div");
    el.className="item";
    const nextTxt = `${s.oil_next_date? fmtDate(s.oil_next_date):"-"}${s.oil_next_km?(" ou "+s.oil_next_km+" km"):""}`;
    el.innerHTML = `
      <div>
        <div class="title">${escapeHtml((c?.nome||""))} • ${escapeHtml((v?.placa||""))}</div>
        <div class="sub">Status: <b>${escapeHtml(badge.txt)}</b> • Próxima: ${escapeHtml(nextTxt)}</div>
      </div>
      <div class="row" style="gap:8px">
        <div class="badge ${badge.cls}">${escapeHtml(badge.txt)}</div>
        <button class="btn" type="button">WhatsApp</button>
      </div>
    `;
    el.querySelector("button").onclick = ()=>{
      if(!c?.whatsapp){ toast("Cliente sem WhatsApp cadastrado."); return; }
      const msg = `Olá ${c.nome}! 👋\n\nPassando pra lembrar da troca de óleo do veículo ${v?.placa||""} (${v?.modelo||""}).\nPróxima troca: ${nextTxt}.\n\nSe quiser, já podemos agendar.\nLopes Serviços Mecânicos`;
      window.open(`https://wa.me/55${c.whatsapp}?text=${encodeURIComponent(msg)}`,"_blank");
    };
    list.appendChild(el);
  }
}

function openOilAlerts(){
  renderOilAlerts();
  openModal("oilAlerts");
}

/* Wire extra UI buttons */
function wireExtraButtons(){
  $("btnCash")?.addEventListener("click", openCash);
  $("btnCashIn")?.addEventListener("click", ()=>openCashTx("in"));
  $("btnCashOut")?.addEventListener("click", ()=>openCashTx("out"));
  $("cashTxSave")?.addEventListener("click", saveCashTx);
  $("cashQ")?.addEventListener("input", renderCash);

  $("btnReport")?.addEventListener("click", openReport);
  $("reportMonth")?.addEventListener("change", renderReport);
  $("btnReportExport")?.addEventListener("click", exportReportCSV);

  $("btnOilAlerts")?.addEventListener("click", openOilAlerts);
}

/* ===== Busca ===== */
$("q")?.addEventListener("input", ()=> renderAll());

/* ===== Init ===== */
window.addEventListener("load", ()=>{
  // PWA SW
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }

  // PIN gate (simple)
  const pin = localStorage.getItem(APP.pinKey) || "1234";
  setTimeout(()=>{
    const entered = prompt("Digite o PIN do sistema (padrão: 1234):");
    if(entered !== pin){
      alert("PIN incorreto.");
      location.reload();
    }
  }, 150);

  initVehicleDatalists();
  wirePlateAutofill();
  wireExtraButtons();
  initRememberCloudCreds();

  renderAll();
  initAuthState().catch(()=>{});
});
