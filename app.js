
/* Lopes Serviços Mecânicos - PWA Offline + Sync Supabase (single table app_state)
   NÃO salva senha. Login Supabase via email/senha (Auth).
*/
const APP = {
  supabaseUrl: "https://euoetxrcwzkogtdbuiqj.supabase.co",
  supabaseAnonKey: "sb_publishable_q87P7Cy6GQHh6wNxtOOSZA_CwLXiFVN",
  storageKey: "lopes_mecanica_state_v1",
  pinKey: "lopes_mecanica_pin_v1",
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
  // keep day stable if possible
  if(d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0,10);
}

function loadState(){
  const raw = localStorage.getItem(APP.storageKey);
  if(!raw){
    return {
      version: "1.2",
      updated_at: new Date().toISOString(),
      counters: { os: 1 },
      clients: [],
      vehicles: [],
      services: []
    };
  }
  try{
    return JSON.parse(raw);
  }catch{
    return {
      version: "1.2",
      updated_at: new Date().toISOString(),
      counters: { os: 1 },
      clients: [],
      vehicles: [],
      services: []
    };
  }
}

function saveState(){
  state.updated_at = new Date().toISOString();
  localStorage.setItem(APP.storageKey, JSON.stringify(state));
  renderAll();
}

let state = loadState();

// Supabase client (loaded via CDN)
let supabaseClient = null;
let session = null;

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
};
function closeAllModals(){
  if (backdrop) backdrop.hidden = true;
  Object.values(modals).forEach(m => m.hidden = true);
}
function openModal(which){
  if (backdrop) backdrop.hidden = false;
  modals[which].hidden = false;
}
document.addEventListener("click", (e)=>{
  const t = e.target;
  // Click outside (backdrop) closes
  if(t === backdrop) return closeAllModals();
  // Any element inside a button/link with data-close should close (handles clicks on icons/spans)
  const closeEl = t && t.closest ? t.closest("[data-close]") : null;
  if(closeEl) return closeAllModals();
});

/* Render */
function matchesQuery(obj, q){
  const hay = JSON.stringify(obj).toLowerCase();
  return hay.includes(q.toLowerCase());
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
  // km compare with current vehicle km if available
  const v = state.vehicles.find(v=>v.id===service.veiculo_id);
  if(v && km != null && Number(v.km_atual||0) >= Number(km)) due = true;
  else if(v && km != null && Number(km) - Number(v.km_atual||0) <= 300) warn = true;

  if(due) return {cls:"red", txt:"Vencido"};
  if(warn) return {cls:"warn", txt:"Perto"};
  return {cls:"ok", txt:"Em dia"};
}

function renderClients(){
  const q = norm($("q").value);
  const list = $("clientsList");
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
  const q = norm($("q").value);
  const list = $("vehiclesList");
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
  const q = norm($("q").value);
  const list = $("servicesList");
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
    const badgeHtml = badge ? `<div class="badge ${badge.cls}">${badge.txt}</div>` : `<div class="badge">${escapeHtml(s.tipo||"")}</div>`;
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
      if(type==="due"){ $("q").value="\"troca_oleo\""; } // weak filter
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

/* CRUD - Client */
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
$("btnNewClient").onclick = ()=> openClient(null);
$("clientSave").onclick = ()=>{
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
};
$("clientDelete").onclick = ()=>{
  if(!editingClientId) return;
  if(!confirm("Excluir cliente?")) return;
  // Keep vehicles but detach
  state.vehicles.forEach(v=>{ if(v.cliente_id===editingClientId) v.cliente_id=null; });
  state.clients = state.clients.filter(c=>c.id!==editingClientId);
  saveState();
  closeAllModals();
};

/* CRUD - Vehicle */
let editingVehicleId = null;
function openVehicle(id){
  editingVehicleId = id;
  const v = state.vehicles.find(x=>x.id===id);
  $("vehicleTitle").textContent = v ? "Editar Veículo" : "Novo Veículo";
  $("vehicleCliente").value = v?.cliente_id || "";
  $("vehiclePlaca").value = v?.placa || "";
  $("vehicleModelo").value = v?.modelo || "";
  $("vehicleAno").value = v?.ano || "";
  $("vehicleKm").value = v?.km_atual ?? "";
  $("vehicleObs").value = v?.observacoes || "";
  $("vehicleDelete").style.display = v ? "inline-block":"none";
  openModal("vehicle");
}
$("btnNewVehicle").onclick = ()=> openVehicle(null);
$("vehicleSave").onclick = ()=>{
  const cliente_id = $("vehicleCliente").value || null;
  const placa = normPlaca($("vehiclePlaca").value);
  const modelo = norm($("vehicleModelo").value);
  const ano = norm($("vehicleAno").value);
  const km_atual = Number($("vehicleKm").value || 0);
  const obs = norm($("vehicleObs").value);
  if(!placa){ toast("Informe a placa."); return; }
  // unique by placa
  const exists = state.vehicles.find(x=> x.placa===placa && x.id!==editingVehicleId);
  if(exists){ toast("Já existe um veículo com essa placa."); return; }

  if(editingVehicleId){
    const v = state.vehicles.find(x=>x.id===editingVehicleId);
    Object.assign(v,{cliente_id,placa,modelo,ano,km_atual,observacoes:obs, updated_at:new Date().toISOString()});
  }else{
    state.vehicles.push({id:uuid(), cliente_id, placa, modelo, ano, km_atual, observacoes:obs, created_at:new Date().toISOString(), updated_at:new Date().toISOString()});
  }
  saveState();
  closeAllModals();
};
$("vehicleDelete").onclick = ()=>{
  if(!editingVehicleId) return;
  if(!confirm("Excluir veículo? As OS deste veículo também serão removidas.")) return;
  state.services = state.services.filter(s=>s.veiculo_id!==editingVehicleId);
  state.vehicles = state.vehicles.filter(v=>v.id!==editingVehicleId);
  saveState();
  closeAllModals();
};

/* OS */
let editingServiceId = null;
function nextOsNumber(){
  const n = state.counters?.os || 1;
  state.counters.os = n + 1;
  return String(n).padStart(6,"0");
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

  $("osCliente").value = s?.cliente_id || "";
  // vehicles list depends on client; set after refreshSelects
  setTimeout(()=>{
    filterVehiclesForOs();
    $("osVeiculo").value = s?.veiculo_id || "";
  },0);

  // oil params
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
$("btnNewOS").onclick = ()=> openService(null);

$("osCliente").onchange = ()=> filterVehiclesForOs();
$("osTipo").onchange = ()=> { toggleOilBlock(); previewOil(); };

function filterVehiclesForOs(){
  const cid = $("osCliente").value;
  const sel = $("osVeiculo");
  const all = state.vehicles.filter(v=> !cid || v.cliente_id===cid);
  sel.innerHTML = `<option value="">Selecione…</option>` + all.map(v=> `<option value="${v.id}">${escapeHtml(v.placa)} — ${escapeHtml(v.modelo||"")}</option>`).join("");
}

$("oilKmInterval").onchange = ()=> { onOilIntervalChange(); previewOil(); };
$("oilKmCustom").oninput = ()=> previewOil();
$("oilMonths").oninput = ()=> previewOil();
$("osData").onchange = ()=> previewOil();
$("osKm").oninput = ()=> previewOil();

function onOilIntervalChange(){
  const v = $("oilKmInterval").value;
  $("oilKmCustom").hidden = v !== "custom";
}
function toggleOilBlock(){
  $("oilBlock").style.display = $("osTipo").value === "troca_oleo" ? "block":"none";
}
function previewOil(){
  if($("osTipo").value !== "troca_oleo"){ $("oilPreview").textContent=""; return; }
  const kmServico = Number($("osKm").value||0);
  const dateServico = $("osData").value || todayISO();
  let kmInt = $("oilKmInterval").value;
  if(kmInt==="custom") kmInt = Number($("oilKmCustom").value||0);
  else kmInt = Number(kmInt);
  const months = Number($("oilMonths").value||6);
  const nextKm = kmServico && kmInt ? (kmServico + kmInt) : null;
  const nextDate = addMonths(dateServico, months);
  $("oilPreview").textContent = `Próxima troca: ${fmtDate(nextDate)} ou ${nextKm ? (nextKm+" km") : "—"} (o que vencer primeiro).`;
}

$("serviceSave").onclick = ()=>{
  const cliente_id = $("osCliente").value || null;
  const veiculo_id = $("osVeiculo").value || null;
  const data_servico = $("osData").value || todayISO();
  const km_servico = Number($("osKm").value||0);
  const tipo = $("osTipo").value;
  const observacoes = norm($("osObs").value);
  const total = Number($("osTotal").value||0);
  const os_numero = norm($("osNumero").value);

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
      oil_next_date,oil_next_km,oil_km_interval,oil_km_custom,oil_months,oil_spec,
      updated_at:new Date().toISOString()
    });
  }else{
    state.services.push({
      id: uuid(),
      cliente_id, veiculo_id,
      data_servico, km_servico,
      tipo, observacoes, total, os_numero,
      oil_next_date, oil_next_km, oil_km_interval, oil_km_custom, oil_months, oil_spec,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }
  // update vehicle km if greater
  const v = state.vehicles.find(v=>v.id===veiculo_id);
  if(v && km_servico && km_servico > Number(v.km_atual||0)){
    v.km_atual = km_servico;
    v.updated_at = new Date().toISOString();
  }

  saveState();
  closeAllModals();
  // try quick sync
  if(session) cloudSync().catch(()=>{});
};

$("serviceDelete").onclick = ()=>{
  if(!editingServiceId) return;
  if(!confirm("Excluir esta OS?")) return;
  state.services = state.services.filter(s=>s.id!==editingServiceId);
  saveState();
  closeAllModals();
};

$("btnPrint").onclick = ()=> printCurrentOS();
$("btnWhats").onclick = ()=> sendWhats();

/* Print */
function printCurrentOS(){
  const s = editingServiceId ? state.services.find(x=>x.id===editingServiceId) : null;
  // if new not saved yet: build from form
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
  const cid = $("osCliente").value;
  const vid = $("osVeiculo").value;
  const c = state.clients.find(c=>c.id===cid);
  const v = state.vehicles.find(v=>v.id===vid);
  if(!c?.whatsapp){ toast("Cliente sem WhatsApp cadastrado."); return; }

  const tipo = labelTipo($("osTipo").value);
  const data = $("osData").value ? fmtDate($("osData").value) : "";
  const total = money($("osTotal").value||0);
  let msg = `Olá ${c.nome}! 👋\n\nOS ${$("osNumero").value||""}\nServiço: ${tipo}\nVeículo: ${v?.placa||""} ${v?.modelo||""}\nData: ${data}\nTotal: ${total}\n\nQualquer dúvida, estamos à disposição.\nLopes Serviços Mecânicos`;
  if($("osTipo").value==="troca_oleo"){
    previewOil();
    msg += `\n\nPróxima troca: ${$("oilPreview").textContent.replace("Próxima troca: ","")}`;
  }
  const url = `https://wa.me/55${c.whatsapp}?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
}

/* Select refresh */
function refreshSelects(){
  // vehicle modal client list
  const selC = $("vehicleCliente");
  const cur = selC.value;
  selC.innerHTML = `<option value="">(Sem cliente)</option>` + state.clients
    .slice().sort((a,b)=>(a.nome||"").localeCompare(b.nome||""))
    .map(c=> `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join("");
  selC.value = cur || "";

  const osC = $("osCliente");
  const osCur = osC.value;
  osC.innerHTML = `<option value="">Selecione…</option>` + state.clients
    .slice().sort((a,b)=>(a.nome||"").localeCompare(b.nome||""))
    .map(c=> `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join("");
  osC.value = osCur || "";
  filterVehiclesForOs();
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

function escapeHtml(str){
  return (str||"").toString()
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

/* Config + PIN */
$("btnConfig").onclick = ()=> openModal("config");
$("btnPin").onclick = ()=>{
  const oldPin = $("pinOld").value || "";
  const newPin = $("pinNew").value || "";
  const cur = localStorage.getItem(APP.pinKey) || "1234";
  if(oldPin !== cur){ toast("PIN atual incorreto."); return; }
  if(newPin.length < 4){ toast("Novo PIN deve ter 4+ dígitos."); return; }
  localStorage.setItem(APP.pinKey, newPin);
  $("pinOld").value=""; $("pinNew").value="";
  toast("PIN atualizado.");
};

$("btnExport").onclick = ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `lopes-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

$("importFile").addEventListener("change", async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  const text = await file.text();
  try{
    const data = JSON.parse(text);
    if(!data.clients || !data.vehicles || !data.services) throw new Error("Formato inválido");
    state = data;
    saveState();
    toast("Backup importado.");
  }catch(err){
    toast("Falha ao importar: " + err.message);
  }finally{
    e.target.value="";
  }
});

$("btnWipe").onclick = ()=>{
  if(!confirm("Zerar tudo? Isso apaga clientes, veículos e OS do aparelho.")) return;
  localStorage.removeItem(APP.storageKey);
  state = loadState();
  saveState();
  toast("Dados locais zerados.");
};

/* Cloud / Supabase */
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
  const { data: rows, error: selErr } = await client.from("app_state").select("*").eq("owner_id", owner_id).limit(1);
  if(selErr) throw selErr;

  if(rows && rows.length){
    const remote = rows[0];
    const remoteUpdated = new Date(remote.updated_at).getTime();
    const localUpdated = new Date(state.updated_at || 0).getTime();
    if(remoteUpdated > localUpdated){
      // adopt remote
      state = remote.payload;
      // ensure version
      state.version = state.version || "1.2";
      state.updated_at = remote.updated_at;
      localStorage.setItem(APP.storageKey, JSON.stringify(state));
      toast("Dados baixados da nuvem.");
    }
  }

  // Push (upsert)
  const payload = state;
  const { error: upErr } = await client.from("app_state").upsert({
    owner_id,
    payload,
    updated_at: new Date().toISOString()
  }, { onConflict: "owner_id" });

  if(upErr) throw upErr;
  toast("Sincronizado ✅");
}

function refreshCloudStatus(){
  const pill = $("cloudStatus");
  if(!pill) return;
  const online = navigator.onLine;
  pill.textContent = session ? (online ? "Conectado" : "Conectado (sem internet)") : (online ? "Não conectado" : "Offline");
  pill.style.borderColor = session ? "rgba(43,213,118,.35)" : "rgba(255,255,255,.15)";
}

$("btnCloudLogin").onclick = async ()=>{
  try{
    const email = $("cloudEmail").value.trim();
    const pass = $("cloudPass").value;
    if(!email || !pass){ toast("Informe e-mail e senha."); return; }
    await cloudLogin(email, pass);
    toast("Conectado ✅");
    refreshCloudStatus();
  }catch(err){
    toast("Erro: " + (err?.message || err));
  }
};
$("btnCloudLogout").onclick = async ()=>{
  try{
    await cloudLogout();
    toast("Desconectado.");
    refreshCloudStatus();
  }catch(err){
    toast("Erro: " + (err?.message || err));
  }
};
$("btnCloudSync").onclick = async ()=>{
  try{
    await cloudSync();
  }catch(err){
    toast("Falha sync: " + (err?.message || err));
  }
};

$("btnSync").onclick = async ()=>{
  // quick sync button
  try{
    await cloudSync();
  }catch(err){
    toast("Falha: " + (err?.message || err));
  }
};

window.addEventListener("online", refreshCloudStatus);
window.addEventListener("offline", refreshCloudStatus);

/* Init */
$("q").addEventListener("input", ()=> renderAll());

async function initAuthState(){
  try{
    const client = await ensureSupabaseReady();
    const { data } = await client.auth.getSession();
    session = data.session;
  }catch{ /* ignore */ }
  refreshCloudStatus();
}

window.addEventListener("load", ()=>{
  // service worker disabled for debugging Supabase connection
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((regs)=>Promise.all(regs.map(r=>r.unregister())))
    .catch(()=>{});
  if (window.caches && caches.keys) {
    caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).catch(()=>{});
  }
}
// pin gate (simple)
  const pin = localStorage.getItem(APP.pinKey) || "1234";
  setTimeout(()=>{
    const entered = prompt("Digite o PIN do sistema (padrão: 1234):");
    if(entered !== pin){
      alert("PIN incorreto.");
      location.reload();
    }
  }, 150);

  renderAll();
  initAuthState();
});
