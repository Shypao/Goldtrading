// Browser application source.
// The legacy single-page UI is incrementally typed; server and persistence code use strict TypeScript.
// @ts-nocheck
/* ============================= DATA LAYER ============================= */
let db = { rates:[], customers:[], stock:[], liquidations:[], refiningBatches:[], retailSales:[] };
let currentTab = 'dashboard';
const STORE_KEY = 'zpp_gold_db';
const LEDGER_DB_NAME = 'zpp_gold_trading_ph';
const LEDGER_DB_VERSION = 1;
const ARRAY_STORES = ['customers','stock','liquidations','refiningBatches','retailSales','pricingHistory'];
let ledgerDB = null;

function uid(p){ return (p||'id')+'_'+Math.random().toString(36).slice(2,9); }
function todayStr(){ const d=new Date(), off=d.getTimezoneOffset(); return new Date(d.getTime()-off*60000).toISOString().slice(0,10); }
function monthStr(){ return todayStr().slice(0,7); }
function fmtMoney(n){ n=Number(n)||0; return 'PHP ' + n.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtWeight(n){ return (Number(n)||0).toFixed(2) + ' g'; }
function roundMoney(n){ return Math.round((Number(n)+Number.EPSILON)*100)/100; }
function roundWeight(n){ return Math.round((Number(n)+Number.EPSILON)*100)/100; }
function fmtDate(d){ if(!d) return '—'; const dt=new Date(d+'T00:00:00'); return dt.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'2-digit'}); }
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function ensureShape(){
  db.customers = db.customers||[]; db.stock = db.stock||[];
  db.liquidations = db.liquidations||[]; db.refiningBatches = db.refiningBatches||[]; db.retailSales = db.retailSales||[];
  db.pricingHistory = db.pricingHistory||[];
  db.pricingHistory.forEach(h=>{ if(!h.id) h.id=uid('rate'); });
  if(!db.pricing){
    db.pricing = { effectiveDate: todayStr(), gold:{base:0,overrides:{}}, silver:{base:0,overrides:{}}, platinum:{base:0,overrides:{}}, featured:null };
  }
  db.pricing.gold = db.pricing.gold||{base:0,overrides:{}}; db.pricing.gold.overrides = db.pricing.gold.overrides||{};
  db.pricing.silver = db.pricing.silver||{base:0,overrides:{}}; db.pricing.silver.overrides = db.pricing.silver.overrides||{};
  db.pricing.platinum = db.pricing.platinum||{base:0,overrides:{}}; db.pricing.platinum.overrides = db.pricing.platinum.overrides||{};
  db.pricing.auto = Object.assign({enabled:true,payoutPct:94,lastFetchDate:'',lastAppliedDate:'',lastFetchedAt:'',usdPhp:0,spotUsd:{},draft:null},db.pricing.auto||{});
}

function openLedgerDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(LEDGER_DB_NAME,LEDGER_DB_VERSION);
    req.onupgradeneeded=()=>{
      const idb=req.result;
      ARRAY_STORES.forEach(name=>{ if(!idb.objectStoreNames.contains(name)) idb.createObjectStore(name,{keyPath:'id'}); });
      if(!idb.objectStoreNames.contains('settings')) idb.createObjectStore('settings',{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
function idbRequest(req){ return new Promise((resolve,reject)=>{ req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
async function loadFromLedgerDB(){
  const tx=ledgerDB.transaction([...ARRAY_STORES,'settings'],'readonly');
  const arrayReads=ARRAY_STORES.map(name=>idbRequest(tx.objectStore(name).getAll()));
  const pricingRead=idbRequest(tx.objectStore('settings').get('pricing'));
  const values=await Promise.all([...arrayReads,pricingRead]);
  const loaded={}; ARRAY_STORES.forEach((name,i)=>loaded[name]=values[i]);
  const pricing=values[values.length-1];
  if(!pricing && ARRAY_STORES.every(name=>!loaded[name].length)) return false;
  ARRAY_STORES.forEach(name=>db[name]=loaded[name]);
  db.pricing=pricing?pricing.value:null;
  ensureShape(); return true;
}
async function saveDB(){
  try{
    ensureShape();
    if(location.protocol==='http:'||location.protocol==='https:'){
      const response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(db)});
      if(!response.ok) throw new Error('Database server returned HTTP '+response.status);
      return;
    }
    if(!ledgerDB) ledgerDB=await openLedgerDB();
    const snapshot=JSON.parse(JSON.stringify(db));
    await new Promise((resolve,reject)=>{
      const tx=ledgerDB.transaction([...ARRAY_STORES,'settings'],'readwrite');
      ARRAY_STORES.forEach(name=>{
        const store=tx.objectStore(name); store.clear();
        (snapshot[name]||[]).forEach(item=>store.put(item));
      });
      tx.objectStore('settings').put({id:'pricing',value:snapshot.pricing});
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
    });
  }
  catch(e){ console.error('Save failed', e); toast('Could not save — changes may not persist'); }
}

function seedDemo(){
  const c1 = uid('cust');
  db.customers = [{id:c1, name:'Maria Santos', contact:'0917 555 2210', notes:'Regular seller, mostly 18K scrap.'}];
  db.pricing = {
    effectiveDate: todayStr(),
    gold:{ base:8350, overrides:{} },
    silver:{ base:70, overrides:{} },
    platinum:{ base:2300, overrides:{} },
    auto:{enabled:true,payoutPct:94,lastFetchDate:'',lastAppliedDate:'',lastFetchedAt:'',usdPhp:0,spotUsd:{},draft:null},
    featured:{ metal:'Gold', key:'18K-BUO', low:6360, high:6560 }
  };
  db.pricingHistory = [{ id:uid('rate'), ts:Date.now(), effectiveDate: todayStr(), enteredBy:'Admin', snapshot: JSON.parse(JSON.stringify(db.pricing)) }];
  const netW = 15.00, rate = 6260, amt = netW*rate;
  db.stock = [{
    id:uid('stk'), date: todayStr(), customerId:c1, customerName:'Maria Santos',
    metal:'Gold', itemType:'Scrap', karat:'18K', grossWeight:15.25, deductions:0.25,
    netWeight:netW, currentWeight:netW, rate:rate, suggestedAmount:amt, payout:amt,
    overrideReason:'', paymentMethod:'Cash', staff:'Joseph Reyes', status:'For Refining',
    location:'Vault A · Sample tray', remarks:'Sample entry from proposal illustration', cost:amt
  }];
  db.liquidations = []; db.refiningBatches = []; db.retailSales = [];
}

async function loadDB(){
  try{
    if(location.protocol==='http:'||location.protocol==='https:'){
      const response=await fetch('/api/state',{cache:'no-store'});
      if(!response.ok) throw new Error('Database server returned HTTP '+response.status);
      const serverState=await response.json();
      if(serverState.pricing){ db=serverState; ensureShape(); }
      else { seedDemo(); ensureShape(); await saveDB(); }
      boot();
      if(db.pricing.auto.enabled&&db.pricing.auto.lastAppliedDate!==todayStr()) refreshPhilippineRates(true);
      return;
    }
    ledgerDB=await openLedgerDB();
    const found=await loadFromLedgerDB();
    if(!found){
      let legacy=null;
      try{
        if(window.storage && typeof window.storage.get==='function'){ const r=await window.storage.get(STORE_KEY,false); legacy=r&&r.value; }
        if(!legacy) legacy=localStorage.getItem(STORE_KEY);
      }catch(ignore){}
      if(legacy){ db=JSON.parse(legacy); ensureShape(); }
      else seedDemo();
      await saveDB();
    }
  }catch(e){ console.error('Database load failed',e); seedDemo(); ensureShape(); }
  boot();
  if(db.pricing.auto.enabled && db.pricing.auto.lastAppliedDate!==todayStr()) refreshPhilippineRates(true);
}

async function resetDemo(){
  if(!confirm('This replaces all current data with the sample dataset. Continue?')) return;
  seedDemo();
  await saveDB();
  render();
  toast('Sample data restored');
}

function toast(msg){
  const t=document.createElement('div');
  t.className='toast'; t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2600);
}

/* ============================= PRICING / RATES ============================= */
const GOLD_GRADES = [
  {key:'24K', label:'24K', mult:1},
  {key:'23K', label:'23K', mult:0.965},
  {key:'22K', label:'22K', mult:0.916},
  {key:'21K', label:'21K', mult:0.875},
  {key:'18K', label:'18K', mult:0.75},
  {key:'18K-BUO', label:'18K-Buo', mult:0.75},
  {key:'16K', label:'16K', mult:0.667},
  {key:'14K', label:'14K', mult:0.585},
  {key:'12K', label:'12K', mult:0.375},
  {key:'10K', label:'10K', mult:0.35},
  {key:'8K', label:'8K', mult:0.25},
  {key:'98%', label:'98%', mult:0.98},
  {key:'73%', label:'73%', mult:0.73},
];
const SILVER_GRADES = ['999','925','900','800'];
const PLATINUM_GRADES = ['999','950','900','850'];
const GRADES = { Gold: GOLD_GRADES.map(g=>g.key), Silver: SILVER_GRADES, Platinum: PLATINUM_GRADES };

function gradeMeta(metal, key){
  if(metal==='Gold') return GOLD_GRADES.find(g=>g.key===key) || null;
  return {key, label:key, mult:1};
}
function computedRate(metal, key){
  if(metal==='Gold'){ const g=GOLD_GRADES.find(x=>x.key===key); return g? +(db.pricing.gold.base*g.mult).toFixed(2) : 0; }
  if(metal==='Silver') return +(db.pricing.silver.base*(parseInt(key,10)/999)).toFixed(2);
  if(metal==='Platinum') return +(db.pricing.platinum.base*(parseInt(key,10)/999)).toFixed(2);
  return 0;
}
function bucketFor(metal){ return metal==='Gold'?db.pricing.gold : metal==='Silver'?db.pricing.silver : db.pricing.platinum; }
function metalRate(metal, key){
  const b = bucketFor(metal);
  const ov = b.overrides[key];
  return (ov!=null && ov!=='') ? +ov : computedRate(metal, key);
}
function isOverridden(metal, key){
  const b = bucketFor(metal);
  return b.overrides[key]!=null && b.overrides[key]!=='';
}
function gradeLabel(metal, key){ const g=gradeMeta(metal,key); return g? g.label : key; }
function distinctKarats(metal){ return GRADES[metal] || []; }
function activeRate(metal, karat){
  if(!GRADES[metal] || !GRADES[metal].includes(karat)) return null;
  return { rate: metalRate(metal, karat), effectiveDate: db.pricing.effectiveDate };
}

function setBase(metal, value){
  const v = parseFloat(value);
  bucketFor(metal).base = isNaN(v)? 0 : v;
  saveDB(); render();
}
function setOverride(metal, key, value){
  const b = bucketFor(metal);
  if(value===''){ delete b.overrides[key]; } else { b.overrides[key] = parseFloat(value); }
  saveDB(); render();
}
function resetOverride(metal, key){
  delete bucketFor(metal).overrides[key];
  saveDB(); render();
}
function setFeatured(metal, key, low, high){
  db.pricing.featured = { metal, key, low: parseFloat(low)||0, high: parseFloat(high)||0 };
  saveDB(); render();
}
function clearFeatured(){ db.pricing.featured = null; saveDB(); render(); }
let pricingFetchBusy=false;
const overrideEditors=new Set();
const TROY_OUNCE_GRAMS=31.1034768;
async function fetchJson(url){
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok) throw new Error('Price service returned HTTP '+response.status);
  return response.json();
}
async function refreshPhilippineRates(silent){
  if(pricingFetchBusy) return;
  pricingFetchBusy=true; render();
  try{
    let proposal;
    if(location.protocol==='http:'||location.protocol==='https:'){
      proposal=await fetchJson('/api/market?payoutPct='+encodeURIComponent(db.pricing.auto.payoutPct));
    }else{
      const [gold,silver,platinum,fx]=await Promise.all([
        fetchJson('https://api.gold-api.com/price/XAU'),fetchJson('https://api.gold-api.com/price/XAG'),
        fetchJson('https://api.gold-api.com/price/XPT'),fetchJson('https://open.er-api.com/v6/latest/USD')
      ]);
      const usdPhp=Number(fx.rates&&fx.rates.PHP), spotUsd={Gold:Number(gold.price),Silver:Number(silver.price),Platinum:Number(platinum.price)};
      if(!usdPhp||Object.values(spotUsd).some(v=>!v)) throw new Error('Incomplete market data');
      const factor=Math.max(0,Math.min(100,Number(db.pricing.auto.payoutPct)||0))/100;
      proposal={effectiveDate:todayStr(),fetchedAt:new Date().toISOString(),usdPhp,spotUsd,draft:{effectiveDate:todayStr(),gold:+(spotUsd.Gold*usdPhp/TROY_OUNCE_GRAMS*factor).toFixed(2),silver:+(spotUsd.Silver*usdPhp/TROY_OUNCE_GRAMS*factor).toFixed(2),platinum:+(spotUsd.Platinum*usdPhp/TROY_OUNCE_GRAMS*factor).toFixed(2)}};
    }
    db.pricing.auto.lastFetchDate=proposal.effectiveDate;
    db.pricing.auto.lastFetchedAt=proposal.fetchedAt;
    db.pricing.auto.usdPhp=proposal.usdPhp;
    db.pricing.auto.spotUsd=proposal.spotUsd;
    activateMarketRates(proposal.draft, silent?'Automatic daily internet update':'Manual internet refresh');
    await saveDB();
    if(!silent) toast('Live internet prices refreshed and activated');
  }catch(e){
    console.error('Automatic pricing failed',e);
    if(!silent) toast('Live pricing unavailable — current rates are unchanged');
  }finally{ pricingFetchBusy=false; render(); }
}
function activateMarketRates(d, enteredBy){
  db.pricing.gold.base=d.gold; db.pricing.silver.base=d.silver; db.pricing.platinum.base=d.platinum;
  db.pricing.effectiveDate=d.effectiveDate;
  db.pricing.auto.lastAppliedDate=d.effectiveDate;
  db.pricing.auto.draft=null;
  db.pricingHistory.push({id:uid('rate'),ts:Date.now(),effectiveDate:d.effectiveDate,enteredBy,snapshot:JSON.parse(JSON.stringify(db.pricing))});
}
function setAutoEnabled(checked){ db.pricing.auto.enabled=checked; saveDB(); render(); }
function setPayoutPct(value){
  const n=parseFloat(value);
  if(!isNaN(n)) db.pricing.auto.payoutPct=Math.max(0,Math.min(100,n));
  db.pricing.auto.draft=null; saveDB(); render();
}
function overrideEditorId(metal,key){ return metal+'|'+key; }
function beginOverride(metal,key){
  const id=overrideEditorId(metal,key);
  overrideEditors.add(id);
  render();
  requestAnimationFrame(()=>{
    const input=document.querySelector(`[data-rate-editor="${metal}-${key}"]`);
    if(input){ input.focus(); input.select(); }
  });
}
function cancelOverride(metal,key){ overrideEditors.delete(overrideEditorId(metal,key)); render(); }
function commitOverride(metal,key,value){
  const n=parseFloat(value);
  if(!Number.isFinite(n)||n<0){ toast('Enter a valid non-negative price'); return; }
  overrideEditors.delete(overrideEditorId(metal,key));
  setOverride(metal,key,n);
  toast(`${gradeLabel(metal,key)} price overridden`);
}
function savePricingSnapshot(){
  const by = val('px_by').trim() || 'Admin';
  const date = val('px_date') || todayStr();
  db.pricing.effectiveDate = date;
  db.pricingHistory.push({ id:uid('rate'), ts:Date.now(), effectiveDate:date, enteredBy:by, snapshot: JSON.parse(JSON.stringify(db.pricing)) });
  saveDB(); render(); toast('Rate sheet saved to history');
}

/* ============================= NAV / BOOT ============================= */
const TABS = [
  {id:'dashboard', label:'Dashboard'},
  {id:'rates', label:'Daily rate setup'},
  {id:'buying', label:'Buying transactions'},
  {id:'inventory', label:'Inventory'},
  {id:'liquidation', label:'Selective liquidation'},
  {id:'refining', label:'Refining tracking'},
  {id:'retail', label:'Limited retail sales'},
  {id:'customers', label:'Customer management'},
  {id:'reports', label:'Reports & exports'},
];

function boot(){
  const nav = document.getElementById('navTabs');
  nav.innerHTML = TABS.map(t=>`<button data-tab="${t.id}" class="${t.id===currentTab?'active':''}" onclick="goTab('${t.id}')"><span class="dot"></span>${t.label}</button>`).join('');
  document.getElementById('pageDate').textContent = fmtDate(todayStr());
  render();
  startAutomaticPricing();
}
let automaticPricingTimer=null;
function startAutomaticPricing(){
  if(automaticPricingTimer) return;
  automaticPricingTimer=setInterval(()=>{
    if(db.pricing.auto.enabled&&db.pricing.auto.lastAppliedDate!==todayStr()) refreshPhilippineRates(true);
  },15*60*1000);
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&db.pricing.auto.enabled&&db.pricing.auto.lastAppliedDate!==todayStr()) refreshPhilippineRates(true);
  });
}
function goTab(id){
  currentTab = id;
  document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===id));
  render();
}

function render(){
  const titles = {
    dashboard:['Overview','Dashboard'],
    rates:['Pricing control','Daily rate setup'],
    buying:['Record a purchase','Buying transactions'],
    inventory:['Current stock','Inventory'],
    liquidation:['Release stock to a buyer or refiner','Selective liquidation'],
    refining:['Refining batches','Refining tracking'],
    retail:['Walk-in resale','Limited retail sales'],
    customers:['Sellers on file','Customer management'],
    reports:['Ledger views & exports','Reports & exports'],
  };
  document.getElementById('pageEyebrow').textContent = titles[currentTab][0];
  document.getElementById('pageTitle').textContent = titles[currentTab][1];
  const el = document.getElementById('content');
  const fns = {dashboard:renderDashboard, rates:renderRates, buying:renderBuying, inventory:renderInventory,
    liquidation:renderLiquidation, refining:renderRefining, retail:renderRetail, customers:renderCustomers, reports:renderReports};
  el.innerHTML = fns[currentTab]();
}

/* ============================= DASHBOARD ============================= */
function renderDashboard(){
  const today = todayStr(), mon = monthStr();
  const pToday = db.stock.filter(s=>s.date===today);
  const pMonth = db.stock.filter(s=>s.date.startsWith(mon));
  const payoutToday = pToday.reduce((a,s)=>a+Number(s.payout),0);
  const payoutMonth = pMonth.reduce((a,s)=>a+Number(s.payout),0);

  const invByMetal = {Gold:0, Silver:0, Platinum:0};
  const invCostByMetal = {Gold:0, Silver:0, Platinum:0};
  db.stock.forEach(s=>{ if(s.currentWeight>0 && s.status!=='Liquidated' && s.status!=='Sold'){ invByMetal[s.metal]=(invByMetal[s.metal]||0)+Number(s.currentWeight); invCostByMetal[s.metal]=(invCostByMetal[s.metal]||0)+Number(s.cost); } });
  const maxW = Math.max(invByMetal.Gold, invByMetal.Silver, invByMetal.Platinum, 1);

  const readySelling = db.stock.filter(s=>s.status==='For Selling').reduce((a,s)=>a+Number(s.currentWeight),0);
  const readyRefining = db.stock.filter(s=>s.status==='For Refining').reduce((a,s)=>a+Number(s.currentWeight),0);
  const onHold = db.stock.filter(s=>s.status==='On Hold').reduce((a,s)=>a+Number(s.currentWeight),0);

  const liqMonth = db.liquidations.filter(l=>l.date.startsWith(mon));
  const liqMargin = liqMonth.reduce((a,l)=>a+Number(l.margin),0);
  const retailMonth = db.retailSales.filter(r=>r.date.startsWith(mon));
  const retailMargin = retailMonth.reduce((a,r)=>a+Number(r.margin),0);
  const releaseStatus = (metal, intervalDays) => {
    const rows=db.liquidations.filter(l=>l.metal===metal).sort((a,b)=>b.date.localeCompare(a.date));
    if(!rows.length) return {label:'No release yet',sub:`Recommended every ${intervalDays} days`};
    const last=new Date(rows[0].date+'T00:00:00'); last.setDate(last.getDate()+intervalDays);
    const due=last.toLocaleDateString('en-PH',{month:'short',day:'2-digit',year:'numeric'});
    return {label:due,sub:`Last release ${fmtDate(rows[0].date)}`};
  };
  const goldRelease=releaseStatus('Gold',3), silverRelease=releaseStatus('Silver',7);

  return `
  <section class="block">
    <h2 class="block-title">Today &amp; this month</h2>
    <div class="stat-row">
      <div class="stat"><div class="label">Purchases today</div><div class="value">${pToday.length}</div><div class="sub">${fmtMoney(payoutToday)} paid out</div></div>
      <div class="stat"><div class="label">Purchases this month</div><div class="value">${pMonth.length}</div><div class="sub">${fmtMoney(payoutMonth)} paid out</div></div>
      <div class="stat"><div class="label">Liquidation margin (month)</div><div class="value">${fmtMoney(liqMargin)}</div><div class="sub">${liqMonth.length} batch(es) released</div></div>
      <div class="stat"><div class="label">Retail margin (month)</div><div class="value">${fmtMoney(retailMargin)}</div><div class="sub">${retailMonth.length} item(s) sold</div></div>
    </div>
  </section>

  <section class="block two-col">
    <div>
      <h2 class="block-title">Current inventory by metal</h2>
      <div class="bar-compare">
        <div class="bar-row"><div class="bar-label">Gold</div><div class="bar-track"><div class="bar-fill" style="width:${(invByMetal.Gold/maxW*100).toFixed(1)}%"></div></div><div class="bar-value">${fmtWeight(invByMetal.Gold)}</div></div>
        <div class="bar-row"><div class="bar-label">Silver</div><div class="bar-track"><div class="bar-fill silver" style="width:${(invByMetal.Silver/maxW*100).toFixed(1)}%"></div></div><div class="bar-value">${fmtWeight(invByMetal.Silver)}</div></div>
        <div class="bar-row"><div class="bar-label">Platinum</div><div class="bar-track"><div class="bar-fill" style="width:${(invByMetal.Platinum/maxW*100).toFixed(1)}%;background:var(--platinum-m);"></div></div><div class="bar-value">${fmtWeight(invByMetal.Platinum)}</div></div>
      </div>
      <p class="form-note" style="margin-top:10px;">Carrying cost — Gold ${fmtMoney(invCostByMetal.Gold)} · Silver ${fmtMoney(invCostByMetal.Silver)} · Platinum ${fmtMoney(invCostByMetal.Platinum)}</p>
    </div>
    <div>
      <h2 class="block-title">Liquidation readiness</h2>
      <div class="stat-row" style="gap:10px;">
        <div class="stat" style="flex:1 1 auto;"><div class="label">For selling</div><div class="value">${fmtWeight(readySelling)}</div></div>
        <div class="stat" style="flex:1 1 auto;"><div class="label">For refining</div><div class="value">${fmtWeight(readyRefining)}</div></div>
        <div class="stat" style="flex:1 1 auto;"><div class="label">On hold</div><div class="value">${fmtWeight(onHold)}</div></div>
      </div>
    </div>
  </section>

  <section class="block">
    <h2 class="block-title">Independent release schedules</h2>
    <div class="stat-row">
      <div class="stat"><div class="label">Gold next recommended release</div><div class="value">${goldRelease.label}</div><div class="sub">${goldRelease.sub} · 2–3 day cadence</div></div>
      <div class="stat"><div class="label">Silver next recommended release</div><div class="value">${silverRelease.label}</div><div class="sub">${silverRelease.sub} · weekly cadence</div></div>
    </div>
  </section>

  <section class="block latest-purchases">
    <h2 class="block-title">Latest purchases</h2>
    ${tableOrEmpty(db.stock.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8), s=>`
      <tr><td data-label="Date">${fmtDate(s.date)}</td><td data-label="Customer">${esc(s.customerName)}</td><td data-label="Metal / karat"><span class="metal-tag ${s.metal.toLowerCase()}">${s.metal}</span> ${esc(s.karat)}</td>
      <td data-label="Type">${esc(s.itemType)}</td><td data-label="Net weight" class="num">${fmtWeight(s.netWeight)}</td><td data-label="Payout" class="num">${fmtMoney(s.payout)}</td>
      <td data-label="Status">${statusPill(s.status)}</td></tr>`,
      ['Date','Customer','Metal / karat','Type','Net weight','Payout','Status'],
      'No purchases recorded yet — add one under Buying transactions.')}
  </section>
  `;
}

function statusPill(status){
  const map = {'For Selling':'selling','For Refining':'refining','On Hold':'hold','Liquidated':'liquidated','Sold':'sold'};
  return `<span class="pill ${map[status]||''}">${status}</span>`;
}
function tableOrEmpty(rows, rowFn, headers, emptyMsg){
  if(!rows.length) return `<div class="empty-note">${emptyMsg}</div>`;
  const numericHeaders=new Set(['Net weight','Payout']);
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th class="${numericHeaders.has(h)?'num-head':''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(rowFn).join('')}</tbody></table></div>`;
}

/* ============================= RATES ============================= */
function renderRates(){
  const goldGrid = GOLD_GRADES.filter(g=>g.key!=='24K');
  const auto=db.pricing.auto;
  const fetched=auto.lastFetchedAt?new Date(auto.lastFetchedAt).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'}):'Not fetched yet';
  return `
  <section class="auto-panel">
    <div class="auto-panel-head">
      <div>
        <h3>Automatic Philippine internet pricing</h3>
        <div class="metal-section-desc" style="margin:0;">Live USD metal prices are converted to PHP per gram, adjusted by your buying payout percentage, and activated automatically once per Philippine day.</div>
        <div class="auto-status">${pricingFetchBusy?'<span class="spinner"></span>Updating market data…':`Last checked: ${esc(fetched)}${auto.usdPhp?` · USD/PHP ${Number(auto.usdPhp).toFixed(4)}`:''}`}</div>
      </div>
      <div class="auto-controls">
        <label class="switch-line"><input type="checkbox" ${auto.enabled?'checked':''} onchange="setAutoEnabled(this.checked)"> Update automatically each day</label>
        <div class="field"><label>Buying payout</label><div style="display:flex;align-items:center;gap:5px"><input style="width:82px" type="number" min="0" max="100" step="0.1" value="${auto.payoutPct}" onchange="setPayoutPct(this.value)"><span>%</span></div></div>
        <button class="btn small" onclick="refreshPhilippineRates(false)" ${pricingFetchBusy?'disabled':''}>Refresh &amp; apply now</button>
      </div>
    </div>
    <div class="stat-row" style="margin-top:16px">
      <div class="stat"><div class="label">Active Gold 24K</div><div class="value">${fmtMoney(db.pricing.gold.base)}/g</div></div>
      <div class="stat"><div class="label">Active Silver 999</div><div class="value">${fmtMoney(db.pricing.silver.base)}/g</div></div>
      <div class="stat"><div class="label">Active Platinum 999</div><div class="value">${fmtMoney(db.pricing.platinum.base)}/g</div></div>
    </div>
    <p class="source-note">Formula: USD spot/oz × USD/PHP ÷ 31.1034768 × payout %. Indicative sources: <a href="https://gold-api.com" target="_blank" rel="noopener">Gold API</a> and <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">ExchangeRate-API</a>. Verify high-value payouts independently.</p>
  </section>
  <section class="block">
    <h2 class="block-title">How automated pricing works</h2>
    <p class="metal-section-desc">The live pure-metal rates calculate every karat or purity automatically. Click <strong>Override price</strong> on an individual grade to enter your own rate. That grade stays overridden through future internet updates until you reset it.</p>
  </section>

  <section class="metal-section">
    <div class="metal-section-head"><span class="metal-dot gold"></span><h3>Gold</h3><span class="count">${GOLD_GRADES.length} grades</span></div>
    <div class="base-row">
      <div class="base-box">
        <div class="base-label">24K rate — pure gold</div>
        <div class="base-input"><span>₱</span><input type="number" min="0" step="0.01" value="${db.pricing.gold.base||''}" onchange="setBase('Gold', this.value)"></div>
      </div>
      ${renderFeaturedBox()}
    </div>
    <div class="grade-grid">${goldGrid.map(g=>renderGradeCard('Gold', g.key, g.label, g.mult)).join('')}</div>
  </section>

  <section class="metal-section">
    <div class="metal-section-head"><span class="metal-dot silver"></span><h3>Silver</h3><span class="count">${SILVER_GRADES.length} grades</span></div>
    <div class="base-row">
      <div class="base-box">
        <div class="base-label">999 rate — pure silver</div>
        <div class="base-input"><span>₱</span><input type="number" min="0" step="0.01" value="${db.pricing.silver.base||''}" onchange="setBase('Silver', this.value)"></div>
      </div>
    </div>
    <div class="grade-grid">${SILVER_GRADES.map(k=>renderGradeCard('Silver', k, k, null)).join('')}</div>
  </section>

  <section class="metal-section">
    <div class="metal-section-head"><span class="metal-dot platinum"></span><h3>Platinum</h3><span class="count">${PLATINUM_GRADES.length} grades</span></div>
    <div class="base-row">
      <div class="base-box">
        <div class="base-label">999 rate — pure platinum</div>
        <div class="base-input"><span>₱</span><input type="number" min="0" step="0.01" value="${db.pricing.platinum.base||''}" onchange="setBase('Platinum', this.value)"></div>
      </div>
    </div>
    <div class="grade-grid">${PLATINUM_GRADES.map(k=>renderGradeCard('Platinum', k, k, null)).join('')}</div>
  </section>

  <section class="block">
    <h2 class="block-title">Save today's rate sheet</h2>
    <div class="form-grid">
      <div class="field"><label>Effective date</label><input id="px_date" type="date" value="${db.pricing.effectiveDate||todayStr()}"></div>
      <div class="field"><label>Entered by</label><input id="px_by" placeholder="Staff name"></div>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="savePricingSnapshot()">Save rate sheet</button>
      <span class="form-note">Rates above already apply to new purchases as you edit them. Saving records this sheet in the audit history below.</span>
    </div>
  </section>

  <section class="block">
    <h2 class="block-title">Rate history</h2>
    ${tableOrEmpty(db.pricingHistory.slice().sort((a,b)=>b.ts-a.ts),
      h=>`<tr><td>${fmtDate(h.effectiveDate)}</td><td>${esc(h.enteredBy)}</td><td class="num">${fmtMoney(h.snapshot.gold.base)}/g</td><td class="num">${fmtMoney(h.snapshot.silver.base)}/g</td><td class="num">${fmtMoney(h.snapshot.platinum.base)}/g</td></tr>`,
      ['Effective date','Entered by','Gold 24K base','Silver base','Platinum base'],
      'No saved rate sheets yet.')}
  </section>
  `;
}
function renderGradeCard(metal, key, label, mult){
  const ov = isOverridden(metal, key);
  const editing = overrideEditors.has(overrideEditorId(metal,key));
  const rate = metalRate(metal, key);
  const multTxt = (mult!=null) ? `×${mult}` : `×${(parseInt(key,10)/999).toFixed(3)}`;
  return `<div class="grade-card ${ov?'is-override':''}">
    <div class="gc-top"><span>${esc(label)}</span><span>${multTxt}</span></div>
    <div class="gc-rate"><span class="unit">₱</span><input data-rate-editor="${metal}-${key}" type="number" min="0" step="0.01" value="${rate}" ${editing||ov?'':'readonly'} onchange="commitOverride('${metal}','${key}', this.value)"><span class="unit">/g</span></div>
    <div class="gc-foot">${ov? `<span class="ov-tag">overridden</span> · <button onclick="resetOverride('${metal}','${key}')">reset to live price</button>` : editing? `<button onclick="cancelOverride('${metal}','${key}')">cancel override</button>` : `<button onclick="beginOverride('${metal}','${key}')">Override price</button>`}</div>
  </div>`;
}
function renderFeaturedBox(){
  const f = db.pricing.featured;
  if(!f){
    return `<div class="featured-box">
      <span class="fx-label">Pin a grade to quote a buying range to staff</span>
      <div class="fx-edit">
        <select id="fx_metal" onchange="updateFxKeyOptions()">${['Gold','Silver','Platinum'].map(m=>`<option>${m}</option>`).join('')}</select>
        <select id="fx_key">${GRADES['Gold'].map(k=>`<option value="${k}">${gradeLabel('Gold',k)}</option>`).join('')}</select>
        <input id="fx_low" type="number" placeholder="Low">
        <input id="fx_high" type="number" placeholder="High">
        <button class="btn small" onclick="saveFeaturedFromForm()">Pin</button>
      </div>
    </div>`;
  }
  return `<div class="featured-box">
    <span class="fx-grade">${esc(gradeLabel(f.metal,f.key))}</span>
    <span class="fx-range">₱${Number(f.low).toLocaleString()}–${Number(f.high).toLocaleString()}</span>
    <button class="btn small secondary" style="color:var(--cream-text);border-color:#45412F;" onclick="clearFeatured()">Unpin</button>
  </div>`;
}
function updateFxKeyOptions(){
  const m = val('fx_metal');
  const sel = document.getElementById('fx_key');
  if(sel) sel.innerHTML = GRADES[m].map(k=>`<option value="${k}">${gradeLabel(m,k)}</option>`).join('');
}
function saveFeaturedFromForm(){
  const metal = val('fx_metal'), key = val('fx_key'), low = val('fx_low'), high = val('fx_high');
  if(low===''||high===''){ toast('Enter both a low and high value'); return; }
  setFeatured(metal, key, low, high);
}
function val(id){ const e=document.getElementById(id); return e? e.value : ''; }

/* ============================= CUSTOMERS ============================= */
let custSearch = '', custOpen = null;
function renderCustomers(){
  const list = db.customers.filter(c=> (c.name+c.contact).toLowerCase().includes(custSearch.toLowerCase()));
  return `
  <section class="block">
    <h2 class="block-title">Add a customer</h2>
    <div class="form-grid">
      <div class="field"><label>Name</label><input id="c_name" placeholder="Full name"></div>
      <div class="field"><label>Contact</label><input id="c_contact" placeholder="Phone / address"></div>
      <div class="field span-2"><label>Notes</label><textarea id="c_notes" placeholder="Optional remarks"></textarea></div>
    </div>
    <div class="form-actions"><button class="btn" onclick="addCustomer()">Save customer</button></div>
  </section>

  <section class="block">
    <h2 class="block-title">Customers on file</h2>
    <div class="filter-row">
      <div class="field"><label>Search</label><input value="${esc(custSearch)}" oninput="custSearch=this.value; render();" placeholder="Search name or contact"></div>
    </div>
    ${tableOrEmpty(list, c=>{
      const history = db.stock.filter(s=>s.customerId===c.id);
      const totalPayout = history.reduce((a,s)=>a+Number(s.payout),0);
      return `<tr><td>${esc(c.name)}</td><td>${esc(c.contact||'—')}</td><td>${esc(c.notes||'—')}</td>
      <td class="num">${history.length} sale(s) · ${fmtMoney(totalPayout)}</td>
      <td><button class="btn secondary small" onclick="toggleCustHist('${c.id}')">${custOpen===c.id?'Hide':'View'} history</button></td></tr>
      ${custOpen===c.id ? `<tr><td colspan="5"><div class="customer-hist">${history.length? history.map(s=>`${fmtDate(s.date)} — ${s.metal} ${esc(s.karat)} ${esc(s.itemType)}, ${fmtWeight(s.netWeight)}, ${fmtMoney(s.payout)} (${s.status})`).join('<br>') : 'No purchases from this customer yet.'}</div></td></tr>` : ''}`;
    }, ['Name','Contact','Notes','Selling history',''], 'No customers yet.')}
  </section>
  `;
}
function toggleCustHist(id){ custOpen = (custOpen===id? null : id); render(); }
function addCustomer(){
  const name=val('c_name').trim(), contact=val('c_contact').trim(), notes=val('c_notes').trim();
  if(!name){ toast('Enter a customer name'); return; }
  db.customers.push({id:uid('cust'), name, contact, notes});
  saveDB(); render(); toast('Customer added');
}

/* ============================= BUYING ============================= */
let purchaseBatch=[];
function renderBuying(){
  const selectedCustomer=val('b_customer');
  const metal = val('b_metal') || 'Gold';
  const karats = distinctKarats(metal);
  const requestedKarat=val('b_karat');
  const karat = (karats.includes(requestedKarat)?requestedKarat:karats[0]) || '';
  const rateObj = karat ? activeRate(metal, karat) : null;
  const gross = parseFloat(val('b_gross'))||0, ded = parseFloat(val('b_ded'))||0;
  const net = Math.max(roundWeight(gross-ded),0);
  const rate = rateObj ? rateObj.rate : 0;
  const suggested = roundMoney(net*rate);

  return `
  <section class="block buying-workflow">
    <div class="buying-step">
      <div class="step-number">1</div>
      <div class="step-content">
        <h2>Who is selling?</h2>
        <p>Select a saved customer or add a new name.</p>
        <div class="form-grid buying-customer-grid">
          <div class="field"><label>Customer</label>
            <select id="b_customer" onchange="toggleNewCustomerField()">
              <option value="">Select customer</option>
              ${db.customers.map(c=>`<option value="${c.id}" ${selectedCustomer===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
              <option value="__new__" ${selectedCustomer==='__new__'?'selected':''}>+ New customer</option>
            </select>
          </div>
          <div class="field ${selectedCustomer==='__new__'?'':'is-hidden'}" id="b_new_customer_field"><label>New customer name</label><input id="b_newcust" placeholder="Full name"></div>
          <div class="field"><label>Date</label><input id="b_date" type="date" value="${val('b_date')||todayStr()}"></div>
          <div class="field"><label>Payment</label><select id="b_pay"><option>Cash</option><option>Bank transfer</option><option>GCash</option></select></div>
        </div>
      </div>
    </div>

    <div class="buying-step">
      <div class="step-number">2</div>
      <div class="step-content">
        <h2>Add an item</h2>
        <p>Choose the grade and enter its weight. The amount calculates automatically.</p>
        <div class="form-grid buying-item-grid">
      <div class="field"><label>Metal</label>
        <select id="b_metal" onchange="updateBuyingGrades()">
          <option value="Gold" ${metal==='Gold'?'selected':''}>Gold</option>
          <option value="Silver" ${metal==='Silver'?'selected':''}>Silver</option>
          <option value="Platinum" ${metal==='Platinum'?'selected':''}>Platinum</option>
        </select>
      </div>
      <div class="field"><label>Item type</label>
        <select id="b_itemtype"><option>Scrap</option><option>Jewelry</option></select>
      </div>
      <div class="field"><label>Karat / purity</label>
        <select id="b_karat" onchange="recalcBuying()">
          ${karats.length? karats.map(k=>`<option value="${k}" ${k===karat?'selected':''}>${esc(gradeLabel(metal,k))}</option>`).join('') : `<option value="">No rate set</option>`}
        </select>
        ${!karats.length? `<span class="hint">Add a buying rate for ${metal} first.</span>`:''}
      </div>
      <div class="field"><label>Gross weight (g)</label><input id="b_gross" type="number" min="0" step="0.01" value="${val('b_gross')}" oninput="recalcBuying()"></div>
      <div class="field"><label>Deductions (g)</label><input id="b_ded" type="number" min="0" step="0.01" value="${val('b_ded')}" oninput="recalcBuying()"></div>
        </div>

        <div class="payout-calculator">
          <div><span>Net weight</span><strong id="b_net_display">${fmtWeight(net)}</strong></div>
          <div><span id="b_rate_label">Buying rate (${Number(db.pricing.auto.payoutPct)}%)</span><strong id="b_rate_display">${rateObj?fmtMoney(rate)+'/g':'No active rate'}</strong></div>
          <div class="suggested"><span>Calculated amount</span><strong id="b_suggested_display">${fmtMoney(suggested)}</strong></div>
          <div class="final-payout"><label for="b_payout">Final payout</label><div><span>₱</span><input id="b_payout" type="number" min="0" step="0.01" placeholder="${suggested.toFixed(2)}" oninput="togglePayoutOverride()"></div></div>
        </div>
        <div class="field override-reason is-hidden" id="b_override_field"><label>Why is the final payout different?</label><input id="b_override" placeholder="Enter a short reason"></div>

        <details class="buying-more">
          <summary>More details <span>optional</span></summary>
          <div class="form-grid buying-more-grid">
            <div class="field"><label>Staff member</label><input id="b_staff" placeholder="Name"></div>
            <div class="field"><label>Initial status</label><select id="b_status"><option>For Selling</option><option>For Refining</option><option>On Hold</option></select></div>
            <div class="field"><label>Storage location / tray</label><input id="b_location" placeholder="e.g. Vault A · Tray 2"></div>
            <div class="field"><label>Remarks</label><textarea id="b_remarks" placeholder="Optional notes"></textarea></div>
          </div>
        </details>

        <div class="form-actions buying-add-action">
          <button class="btn" onclick="addPurchaseItem()">Add this item</button>
          <span class="form-note">You can add more items before paying.</span>
        </div>
      </div>
    </div>
  </section>

  <section class="block" id="purchase_batch_panel">${renderPurchaseBatchPanelMarkup()}</section>

  <section class="block recent-purchases">
    <h2 class="block-title">Recent purchases</h2>
    ${tableOrEmpty(db.stock.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10),
      s=>`<tr><td data-label="Date">${fmtDate(s.date)}</td><td data-label="Customer">${esc(s.customerName)}</td><td data-label="Metal / karat"><span class="metal-tag ${s.metal.toLowerCase()}">${s.metal}</span> ${esc(s.karat)}</td>
      <td data-label="Type">${esc(s.itemType)}</td><td data-label="Net weight" class="num">${fmtWeight(s.netWeight)}</td><td data-label="Payout" class="num">${fmtMoney(s.payout)}</td><td data-label="Staff">${esc(s.staff||'—')}</td><td data-label="Status">${statusPill(s.status)}</td></tr>`,
      ['Date','Customer','Metal / karat','Type','Net weight','Payout','Staff','Status'],
      'No purchases recorded yet.')}
  </section>
  `;
}
function updateBuyingGrades(){
  const metal=val('b_metal'), select=document.getElementById('b_karat'), grades=distinctKarats(metal);
  select.innerHTML=grades.map(k=>`<option value="${k}">${esc(gradeLabel(metal,k))}</option>`).join('');
  recalcBuying();
}
function toggleNewCustomerField(){
  const field=document.getElementById('b_new_customer_field'),input=document.getElementById('b_newcust');
  const isNew=val('b_customer')==='__new__';
  field?.classList.toggle('is-hidden',!isNew);
  if(isNew) input?.focus(); else if(input) input.value='';
}
function recalcBuying(){
  const metal=val('b_metal'),karat=val('b_karat'),gross=parseFloat(val('b_gross'))||0,ded=parseFloat(val('b_ded'))||0;
  const net=Math.max(roundWeight(gross-ded),0), rateObj=karat?activeRate(metal,karat):null, rate=rateObj?rateObj.rate:0;
  const netEl=document.getElementById('b_net_display'),rateEl=document.getElementById('b_rate_display'),rateLabel=document.getElementById('b_rate_label'),suggestedEl=document.getElementById('b_suggested_display'),payoutEl=document.getElementById('b_payout');
  if(netEl) netEl.textContent=fmtWeight(net);
  if(rateEl) rateEl.textContent=rateObj?fmtMoney(rate)+'/g':'No active rate';
  if(rateLabel) rateLabel.textContent=`Buying rate (${Number(db.pricing.auto.payoutPct)}%)`;
  const suggested=roundMoney(net*rate);
  if(suggestedEl) suggestedEl.textContent=fmtMoney(suggested);
  if(payoutEl) payoutEl.placeholder=suggested.toFixed(2);
  togglePayoutOverride();
}
function togglePayoutOverride(){
  const payout=val('b_payout'),field=document.getElementById('b_override_field');
  if(!field) return;
  if(!payout){ field.classList.add('is-hidden'); return; }
  const metal=val('b_metal'),karat=val('b_karat'),gross=parseFloat(val('b_gross'))||0,ded=parseFloat(val('b_ded'))||0;
  const active=karat?activeRate(metal,karat):null,suggested=roundMoney(Math.max(roundWeight(gross-ded),0)*(active?active.rate:0));
  field.classList.toggle('is-hidden',Math.abs(parseFloat(payout)-suggested)<0.005);
}
function purchaseItemFromForm(){
  const metal = val('b_metal'), karat = val('b_karat');
  if(!karat){ toast('Add a buying rate for this metal first'); return null; }
  const gross = parseFloat(val('b_gross'))||0, ded = parseFloat(val('b_ded'))||0;
  const net = Math.max(roundWeight(gross-ded),0);
  if(net<=0){ toast('Enter a valid gross weight'); return null; }
  const rateObj = activeRate(metal, karat);
  const rate = rateObj? rateObj.rate : 0;
  const suggested = roundMoney(net*rate);
  const payoutInput = val('b_payout');
  const payout = payoutInput? roundMoney(parseFloat(payoutInput)) : suggested;
  const overrideReason = (payout!==suggested) ? val('b_override').trim() : '';
  if(!Number.isFinite(payout)||payout<0){ toast('Enter a valid final payout'); return null; }
  if(payout!==suggested && !overrideReason){ toast('Enter an override reason — payout differs from suggested'); return null; }
  return {id:uid('line'),metal,itemType:val('b_itemtype'),karat,grossWeight:gross,deductions:ded,
    netWeight:net,currentWeight:net,rate,suggestedAmount:suggested,payout,overrideReason};
}
function addPurchaseItem(){
  const item=purchaseItemFromForm();
  if(!item) return;
  purchaseBatch.push(item);
  ['b_gross','b_ded','b_payout','b_override'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  recalcBuying(); renderPurchaseBatchPanel();
  toast(`${gradeLabel(item.metal,item.karat)} added to payout`);
}
function removePurchaseItem(id){
  purchaseBatch=purchaseBatch.filter(item=>item.id!==id);
  renderPurchaseBatchPanel();
}
function renderPurchaseBatchPanel(){
  const panel=document.getElementById('purchase_batch_panel');
  if(panel) panel.innerHTML=renderPurchaseBatchPanelMarkup();
}
function renderPurchaseBatchPanelMarkup(){
  const total=roundMoney(purchaseBatch.reduce((sum,item)=>sum+Number(item.payout),0));
  if(!purchaseBatch.length) return `<h2 class="block-title">Current payout</h2><div class="empty-note">Add the customer's gold or other metal items above. The combined total will appear here.</div>`;
  return `<div class="batch-head"><div><h2 class="block-title">Current payout · ${purchaseBatch.length} item${purchaseBatch.length===1?'':'s'}</h2><div class="batch-total">${fmtMoney(total)}</div></div><button class="btn" onclick="openPurchaseSummary()">Review total</button></div>
    <div class="table-wrap"><table class="purchase-batch-table"><thead><tr><th>Item</th><th>Metal / grade</th><th class="num-col">Net weight</th><th class="num-col">Rate</th><th class="num-col">Payout</th><th></th></tr></thead><tbody>
    ${purchaseBatch.map((item,index)=>`<tr><td>${index+1}</td><td><span class="metal-tag ${item.metal.toLowerCase()}">${item.metal}</span> ${esc(gradeLabel(item.metal,item.karat))} · ${esc(item.itemType)}</td><td class="num">${fmtWeight(item.netWeight)}</td><td class="num">${fmtMoney(item.rate)}/g</td><td class="num">${fmtMoney(item.payout)}</td><td><button class="btn secondary small" onclick="removePurchaseItem('${item.id}')">Remove</button></td></tr>`).join('')}
    </tbody></table></div>`;
}
function purchaseCustomer(){
  const newName=val('b_newcust').trim(),customerId=val('b_customer');
  if(newName) return {id:'',name:newName,isNew:true};
  if(customerId){
    const customer=db.customers.find(c=>c.id===customerId);
    if(customer) return {id:customer.id,name:customer.name,isNew:false};
  }
  toast('Select or enter a customer'); return null;
}
function openPurchaseSummary(){
  if(!purchaseBatch.length){ toast('Add at least one item'); return; }
  const customer=purchaseCustomer(); if(!customer) return;
  closePurchaseSummary();
  const total=roundMoney(purchaseBatch.reduce((sum,item)=>sum+Number(item.payout),0));
  const totalWeight=purchaseBatch.reduce((sum,item)=>sum+Number(item.netWeight),0);
  const modal=document.createElement('div'); modal.id='purchase_summary_modal'; modal.className='modal-backdrop';
  modal.innerHTML=`<div class="summary-modal" role="dialog" aria-modal="true" aria-labelledby="purchase_summary_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Combined customer payout</div><h2 id="purchase_summary_title">${esc(customer.name)}</h2></div><button class="modal-close" onclick="closePurchaseSummary()" aria-label="Close">×</button></div>
    <div class="summary-lines">${purchaseBatch.map((item,index)=>`<div class="summary-line"><div><strong>${index+1}. ${esc(item.metal)} ${esc(gradeLabel(item.metal,item.karat))}</strong><span>${esc(item.itemType)} · ${fmtWeight(item.netWeight)} × ${fmtMoney(item.rate)}/g</span></div><strong>${fmtMoney(item.payout)}</strong></div>`).join('')}</div>
    <div class="summary-grand"><div><span>${purchaseBatch.length} item${purchaseBatch.length===1?'':'s'} · ${fmtWeight(totalWeight)}</span><strong>Grand total</strong></div><div>${fmtMoney(total)}</div></div>
    <div class="summary-meta">${fmtDate(val('b_date')||todayStr())} · ${esc(val('b_pay'))}${val('b_staff').trim()?` · Staff: ${esc(val('b_staff').trim())}`:''}</div>
    <div class="form-actions"><button class="btn secondary" onclick="closePurchaseSummary()">Back to items</button><button class="btn" onclick="commitPurchaseBatch()">Confirm &amp; record payout</button></div>
  </div>`;
  modal.addEventListener('click',event=>{if(event.target===modal)closePurchaseSummary();});
  document.body.appendChild(modal);
}
function closePurchaseSummary(){ document.getElementById('purchase_summary_modal')?.remove(); }
async function commitPurchaseBatch(){
  if(!purchaseBatch.length) return;
  const customer=purchaseCustomer(); if(!customer) return;
  let customerId=customer.id;
  if(customer.isNew){ customerId=uid('cust'); db.customers.push({id:customerId,name:customer.name,contact:'',notes:''}); }
  const batchId=uid('buy');
  const shared={date:val('b_date')||todayStr(),customerId,customerName:customer.name,paymentMethod:val('b_pay'),staff:val('b_staff').trim(),
    status:val('b_status'),location:val('b_location').trim(),remarks:val('b_remarks').trim(),batchId};
  purchaseBatch.forEach(item=>db.stock.push({...item,...shared,id:uid('stk'),cost:item.payout}));
  const count=purchaseBatch.length,total=roundMoney(purchaseBatch.reduce((sum,item)=>sum+Number(item.payout),0));
  purchaseBatch=[]; closePurchaseSummary(); await saveDB(); render();
  toast(`${count} items recorded · ${fmtMoney(total)}`);
}

/* ============================= INVENTORY ============================= */
let invFilter = {metal:'All', karat:'All', type:'All', status:'All'};
function renderInventory(){
  const karats = Array.from(new Set(db.stock.map(s=>s.karat)));
  const rows = db.stock.filter(s=>
    (invFilter.metal==='All'||s.metal===invFilter.metal) &&
    (invFilter.karat==='All'||s.karat===invFilter.karat) &&
    (invFilter.type==='All'||s.itemType===invFilter.type) &&
    (invFilter.status==='All'||s.status===invFilter.status)
  ).sort((a,b)=>b.date.localeCompare(a.date));

  const groups = {};
  db.stock.forEach(s=>{
    if(s.currentWeight<=0||s.status==='Sold'||s.status==='Liquidated') return;
    const key = [s.metal,s.karat,s.itemType,s.status].join(' · ');
    groups[key] = groups[key] || {weight:0, cost:0};
    groups[key].weight += Number(s.currentWeight);
    groups[key].cost += Number(s.cost);
  });

  return `
  <section class="block">
    <h2 class="block-title">Inventory summary (weight &amp; cost)</h2>
    <div class="stat-row">
      ${Object.keys(groups).length? Object.entries(groups).map(([k,v])=>`<div class="stat"><div class="label">${k}</div><div class="value">${fmtWeight(v.weight)}</div><div class="sub">${fmtMoney(v.cost)} cost</div></div>`).join('')
      : '<div class="empty-note" style="flex:1;">No active inventory yet.</div>'}
    </div>
  </section>

  <section class="block">
    <h2 class="block-title">Filter stock</h2>
    <div class="filter-row">
      <div class="field"><label>Metal</label><select onchange="invFilter.metal=this.value; render();">
        ${['All','Gold','Silver','Platinum'].map(m=>`<option value="${m}" ${invFilter.metal===m?'selected':''}>${m}</option>`).join('')}</select></div>
      <div class="field"><label>Karat / purity</label><select onchange="invFilter.karat=this.value; render();">
        <option value="All">All</option>${karats.map(k=>`<option value="${k}" ${invFilter.karat===k?'selected':''}>${k}</option>`).join('')}</select></div>
      <div class="field"><label>Item type</label><select onchange="invFilter.type=this.value; render();">
        ${['All','Jewelry','Scrap'].map(t=>`<option value="${t}" ${invFilter.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Status</label><select onchange="invFilter.status=this.value; render();">
        ${['All','For Selling','For Refining','On Hold','Liquidated','Sold'].map(s=>`<option value="${s}" ${invFilter.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
    </div>
    ${tableOrEmpty(rows, s=>`<tr><td>${fmtDate(s.date)}</td><td>${esc(s.customerName)}</td><td><span class="metal-tag ${s.metal.toLowerCase()}">${s.metal}</span> ${esc(s.karat)}</td>
      <td>${esc(s.itemType)}</td><td class="num">${fmtWeight(s.currentWeight)}</td><td class="num">${fmtMoney(s.cost)}</td><td>${statusPill(s.status)}</td><td>${esc(s.location||'—')}</td><td>${esc(s.remarks||'—')}</td></tr>`,
      ['Date','Customer','Metal / karat','Type','Current weight','Cost','Status','Location','Remarks'],
      'No stock matches this filter.')}
  </section>
  `;
}

/* ============================= LIQUIDATION ============================= */
let liqMetal = 'Gold', liqStatus='All', liqKarat='All';
function renderLiquidation(){
  const eligible = db.stock.filter(s=> s.metal===liqMetal && s.currentWeight>0 && (s.status==='For Selling'||s.status==='For Refining')
    && (liqStatus==='All'||s.status===liqStatus) && (liqKarat==='All'||s.karat===liqKarat));
  const karats = Array.from(new Set(db.stock.filter(s=>s.metal===liqMetal).map(s=>s.karat)));

  return `
  <section class="block">
    <h2 class="block-title">1. Choose what to release</h2>
    <div class="filter-row">
      <div class="field"><label>Metal</label><select onchange="liqMetal=this.value; render();">
        ${['Gold','Silver','Platinum'].map(m=>`<option ${liqMetal===m?'selected':''}>${m}</option>`).join('')}</select>
        <span class="hint">Gold and silver are released in separate batches.</span>
      </div>
      <div class="field"><label>Karat / purity</label><select onchange="liqKarat=this.value; render();">
        <option value="All">All</option>${karats.map(k=>`<option ${liqKarat===k?'selected':''}>${k}</option>`).join('')}</select></div>
      <div class="field"><label>Status</label><select onchange="liqStatus=this.value; render();">
        ${['All','For Selling','For Refining'].map(s=>`<option ${liqStatus===s?'selected':''}>${s}</option>`).join('')}</select></div>
    </div>
    ${eligible.length? `
    <div class="item-check-row head"><span></span><span>Item</span><span>Available</span><span>Cost</span><span>Status</span><span>Release wt (g)</span></div>
    ${eligible.map(s=>`
      <div class="item-check-row" data-item="${s.id}">
        <input type="checkbox" class="liq-chk" onchange="syncLiqRow('${s.id}')">
        <span>${fmtDate(s.date)} · ${esc(s.karat)} ${esc(s.itemType)} · ${esc(s.customerName)}</span>
        <span class="num">${fmtWeight(s.currentWeight)}</span>
        <span class="num">${fmtMoney(s.cost)}</span>
        <span>${statusPill(s.status)}</span>
        <input type="number" min="0" step="0.01" max="${s.currentWeight}" class="liq-wt" id="liqwt_${s.id}" placeholder="0.00" disabled>
      </div>`).join('')}
    ` : `<div class="empty-note">No eligible ${liqMetal.toLowerCase()} stock for these filters.</div>`}
  </section>

  <section class="block">
    <h2 class="block-title">2. Batch details</h2>
    <div class="form-grid">
      <div class="field"><label>Buyer / refiner</label><input id="lq_buyer" placeholder="Name"></div>
      <div class="field"><label>Release date</label><input id="lq_date" type="date" value="${todayStr()}"></div>
      <div class="field"><label>Selling rate (PHP/g)</label><input id="lq_rate" type="number" min="0" step="0.01"></div>
      <div class="field"><label>Payment status</label><select id="lq_payment"><option>Pending</option><option>Partially Paid</option><option>Paid</option></select></div>
      <div class="field span-2"><label>Remarks</label><input id="lq_remarks" placeholder="Optional"></div>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="submitLiquidation()">Record liquidation</button>
      <span class="form-note">Proceeds = total released weight × selling rate. Cost is carried proportionally from each item.</span>
    </div>
  </section>

  <section class="block">
    <h2 class="block-title">Liquidation history</h2>
    ${tableOrEmpty(db.liquidations.slice().sort((a,b)=>b.date.localeCompare(a.date)),
      l=>`<tr><td>${fmtDate(l.date)}</td><td><span class="metal-tag ${l.metal.toLowerCase()}">${l.metal}</span></td><td>${esc(l.buyer)}</td>
      <td class="num">${fmtWeight(l.releasedWeight)}</td><td class="num">${fmtMoney(l.proceeds)}</td><td>${esc(l.paymentStatus||'—')}</td><td class="num">${fmtMoney(l.cost)}</td>
      <td class="num" style="color:${l.margin>=0?'var(--sage)':'var(--rust)'}">${fmtMoney(l.margin)}</td></tr>`,
      ['Date','Metal','Buyer / refiner','Released wt','Proceeds','Payment','Cost','Margin'],
      'No liquidations recorded yet.')}
  </section>
  `;
}
function syncLiqRow(id){
  const chk = document.querySelector(`.item-check-row[data-item="${id}"] .liq-chk`);
  const wt = document.getElementById('liqwt_'+id);
  wt.disabled = !chk.checked;
  if(chk.checked && !wt.value){
    const item = db.stock.find(s=>s.id===id);
    wt.value = Number(item.currentWeight).toFixed(2);
  }
}
function submitLiquidation(){
  const rows = Array.from(document.querySelectorAll('.item-check-row .liq-chk')).filter(c=>c.checked);
  if(!rows.length){ toast('Select at least one item'); return; }
  const buyer = val('lq_buyer').trim(), date = val('lq_date'), rate = parseFloat(val('lq_rate'));
  if(!buyer){ toast('Enter a buyer or refiner name'); return; }
  if(!rate || rate<=0){ toast('Enter a valid selling rate'); return; }

  let totalWeight=0, totalCost=0, lines=[];
  for(const chk of rows){
    const row = chk.closest('.item-check-row');
    const id = row.dataset.item;
    const item = db.stock.find(s=>s.id===id);
    const wtInput = document.getElementById('liqwt_'+id);
    const w = parseFloat(wtInput.value)||0;
    if(w<=0) continue;
    if(w>item.currentWeight+0.0001){ toast('Release weight exceeds available for one item'); return; }
    const costPortion = (w/item.currentWeight)*item.cost;
    item.currentWeight = +(item.currentWeight - w).toFixed(4);
    item.cost = +(item.cost - costPortion).toFixed(2);
    if(item.currentWeight<=0.005){ item.currentWeight=0; item.status='Liquidated'; }
    totalWeight += w; totalCost += costPortion;
    lines.push({itemId:id, weight:w, costPortion});
  }
  if(!lines.length){ toast('Enter a release weight for at least one selected item'); return; }
  const proceeds = totalWeight*rate;
  db.liquidations.push({id:uid('liq'), date, metal:liqMetal, buyer, sellingRate:rate, releasedWeight:+totalWeight.toFixed(2),
    proceeds:+proceeds.toFixed(2), paymentStatus:val('lq_payment'), cost:+totalCost.toFixed(2), margin:+(proceeds-totalCost).toFixed(2), lines, remarks:val('lq_remarks').trim()});
  saveDB(); render(); toast('Liquidation recorded');
}

/* ============================= REFINING ============================= */
let refMetal='Gold';
function renderRefining(){
  const eligible = db.stock.filter(s=>s.metal===refMetal && s.status==='For Refining' && s.currentWeight>0);
  return `
  <section class="block">
    <h2 class="block-title">1. Select scrap for this refining batch</h2>
    <div class="filter-row">
      <div class="field"><label>Metal</label><select onchange="refMetal=this.value; render();">
        ${['Gold','Silver','Platinum'].map(m=>`<option ${refMetal===m?'selected':''}>${m}</option>`).join('')}</select></div>
    </div>
    ${eligible.length? `
    <div class="item-check-row head"><span></span><span>Item</span><span>Weight</span><span>Cost</span><span></span><span></span></div>
    ${eligible.map(s=>`<div class="item-check-row" data-item="${s.id}">
      <input type="checkbox" class="ref-chk">
      <span>${fmtDate(s.date)} · ${esc(s.karat)} · ${esc(s.customerName)}</span>
      <span class="num">${fmtWeight(s.currentWeight)}</span><span class="num">${fmtMoney(s.cost)}</span><span></span><span></span>
      </div>`).join('')}
    ` : `<div class="empty-note">No ${refMetal.toLowerCase()} stock marked "For Refining".</div>`}
  </section>

  <section class="block">
    <h2 class="block-title">2. Batch outcome</h2>
    <div class="form-grid">
      <div class="field"><label>Refiner</label><input id="rf_refiner" placeholder="Name"></div>
      <div class="field"><label>Date</label><input id="rf_date" type="date" value="${todayStr()}"></div>
      <div class="field"><label>Expected yield (g)</label><input id="rf_expected" type="number" min="0" step="0.01"></div>
      <div class="field"><label>Actual yield (g)</label><input id="rf_actual" type="number" min="0" step="0.01"></div>
      <div class="field"><label>Refining charges (PHP)</label><input id="rf_charges" type="number" min="0" step="0.01"></div>
      <div class="field"><label>Returned metal (g)</label><input id="rf_returned" type="number" min="0" step="0.01"></div>
      <div class="field span-2"><label>Remarks</label><input id="rf_remarks" placeholder="Optional"></div>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="submitRefining()">Save refining batch</button>
      <span class="form-note">Variance = actual yield − expected yield. Selected items are removed from available inventory.</span>
    </div>
  </section>

  <section class="block">
    <h2 class="block-title">Refining history</h2>
    ${tableOrEmpty(db.refiningBatches.slice().sort((a,b)=>b.date.localeCompare(a.date)),
      r=>`<tr><td>${fmtDate(r.date)}</td><td><span class="metal-tag ${r.metal.toLowerCase()}">${r.metal}</span></td><td>${esc(r.refiner)}</td>
      <td class="num">${fmtWeight(r.inputWeight)}</td><td class="num">${fmtWeight(r.expectedYield)}</td><td class="num">${fmtWeight(r.actualYield)}</td>
      <td class="num" style="color:${r.variance>=0?'var(--sage)':'var(--rust)'}">${r.variance>=0?'+':''}${fmtWeight(r.variance)}</td><td class="num">${fmtMoney(r.refiningCharges)}</td></tr>`,
      ['Date','Metal','Refiner','Input wt','Expected yield','Actual yield','Variance','Charges'],
      'No refining batches recorded yet.')}
  </section>
  `;
}
function submitRefining(){
  const chosen = Array.from(document.querySelectorAll('.ref-chk')).filter(c=>c.checked)
    .map(c=>c.closest('.item-check-row').dataset.item);
  if(!chosen.length){ toast('Select at least one item for refining'); return; }
  const refiner = val('rf_refiner').trim();
  if(!refiner){ toast('Enter a refiner name'); return; }
  const expected = parseFloat(val('rf_expected'))||0, actual = parseFloat(val('rf_actual'))||0;
  const charges = parseFloat(val('rf_charges'))||0, returned = parseFloat(val('rf_returned'))||0;
  let inputWeight=0;
  chosen.forEach(id=>{
    const item = db.stock.find(s=>s.id===id);
    inputWeight += Number(item.currentWeight);
    item.currentWeight = 0; item.status='Liquidated';
  });
  db.refiningBatches.push({id:uid('ref'), date: val('rf_date'), metal:refMetal, refiner, itemIds:chosen,
    inputWeight:+inputWeight.toFixed(2), expectedYield:expected, actualYield:actual,
    variance:+(actual-expected).toFixed(2), refiningCharges:charges, returnedMetal:returned, remarks:val('rf_remarks').trim()});
  saveDB(); render(); toast('Refining batch saved');
}

/* ============================= RETAIL SALES ============================= */
let lastRetailSaleId=null;
function renderRetail(){
  const eligible = db.stock.filter(s=>s.status==='For Selling' && s.itemType==='Jewelry' && s.currentWeight>0);
  return `
  <section class="block">
    <h2 class="block-title">Sell a jewelry item</h2>
    <div class="form-grid">
      <div class="field span-2"><label>Item</label>
        <select id="rt_item">
          <option value="">— choose item —</option>
          ${eligible.map(s=>`<option value="${s.id}">${fmtDate(s.date)} · ${s.metal} ${esc(s.karat)} · ${fmtWeight(s.currentWeight)} · cost ${fmtMoney(s.cost)}</option>`).join('')}
        </select>
        ${!eligible.length? `<span class="hint">No jewelry currently marked "For Selling".</span>`:''}
      </div>
      <div class="field"><label>Buyer name</label><input id="rt_buyer" placeholder="Walk-in customer"></div>
      <div class="field"><label>Sale date</label><input id="rt_date" type="date" value="${todayStr()}"></div>
      <div class="field"><label>Sale price (PHP)</label><input id="rt_price" type="number" min="0" step="0.01"></div>
    </div>
    <div class="form-actions"><button class="btn" onclick="submitRetail()">Record sale</button></div>
  </section>

  <section class="block">
    <h2 class="block-title">Retail sales history</h2>
    ${tableOrEmpty(db.retailSales.slice().sort((a,b)=>b.date.localeCompare(a.date)),
      r=>`<tr><td>${fmtDate(r.date)}</td><td>${esc(r.buyer)}</td><td class="num">${fmtMoney(r.salePrice)}</td>
      <td class="num">${fmtMoney(r.cost)}</td><td class="num" style="color:${r.margin>=0?'var(--sage)':'var(--rust)'}">${fmtMoney(r.margin)}</td><td><button class="btn secondary small" onclick="printRetailSummary('${r.id}')">Summary</button></td></tr>`,
      ['Date','Buyer','Sale price','Cost','Margin',''],
      'No retail sales recorded yet.')}
  </section>
  `;
}
function submitRetail(){
  const itemId = val('rt_item');
  if(!itemId){ toast('Choose an item to sell'); return; }
  const item = db.stock.find(s=>s.id===itemId);
  const price = parseFloat(val('rt_price'));
  if(!price || price<=0){ toast('Enter a valid sale price'); return; }
  const buyer = val('rt_buyer').trim() || 'Walk-in';
  item.status='Sold'; item.currentWeight=0;
  const sale={id:uid('rtl'), date: val('rt_date'), itemId, buyer, salePrice:price, cost:item.cost, margin:+(price-item.cost).toFixed(2),
    itemSummary:`${item.metal} ${item.karat} ${item.itemType}`,weight:item.netWeight};
  db.retailSales.push(sale); lastRetailSaleId=sale.id;
  saveDB(); render(); toast('Sale recorded');
}
function printRetailSummary(id){
  const sale=db.retailSales.find(r=>r.id===id), item=sale&&db.stock.find(s=>s.id===sale.itemId);
  if(!sale){ toast('Sale summary not found'); return; }
  const summary=sale.itemSummary||(item?`${item.metal} ${item.karat} ${item.itemType}`:'Jewelry item');
  const weight=sale.weight||(item&&item.netWeight)||0;
  const w=window.open('','_blank','width=620,height=700');
  if(!w){ toast('Allow pop-ups to open the transaction summary'); return; }
  w.document.write(`<!doctype html><html><head><title>Retail Sale ${esc(sale.id)}</title><style>body{font-family:Arial,sans-serif;max-width:620px;margin:45px auto;color:#222}h1{font-family:Georgia,serif}table{width:100%;border-collapse:collapse;margin-top:24px}td{padding:10px;border-bottom:1px solid #ddd}td:last-child{text-align:right}.foot{margin-top:35px;font-size:12px;color:#666}@media print{button{display:none}}</style></head><body><h1>ZPP Gold Trading</h1><p>Retail transaction summary</p><table><tr><td>Reference</td><td>${esc(sale.id)}</td></tr><tr><td>Date</td><td>${esc(fmtDate(sale.date))}</td></tr><tr><td>Buyer</td><td>${esc(sale.buyer)}</td></tr><tr><td>Item</td><td>${esc(summary)}</td></tr><tr><td>Weight</td><td>${esc(fmtWeight(weight))}</td></tr><tr><td>Sale price</td><td>${esc(fmtMoney(sale.salePrice))}</td></tr></table><p class="foot">This summary records the selected jewelry item removed from available inventory.</p><button onclick="window.print()">Print</button></body></html>`);
  w.document.close();
}

/* ============================= REPORTS ============================= */
function toCSV(rows, columns){
  const head = columns.map(c=>c.label).join(',');
  const body = rows.map(r=>columns.map(c=>{
    let v = typeof c.get==='function' ? c.get(r) : r[c.key];
    v = (v==null?'':String(v)).replace(/"/g,'""');
    return `"${v}"`;
  }).join(',')).join('\n');
  return head+'\n'+body;
}
function downloadCSV(filename, csv){
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function exportStock(){ downloadCSV('zpp_inventory.csv', toCSV(db.stock, [
  {label:'Date',key:'date'},{label:'Customer',key:'customerName'},{label:'Metal',key:'metal'},{label:'Karat',key:'karat'},
  {label:'Item type',key:'itemType'},{label:'Gross weight',key:'grossWeight'},{label:'Deductions',key:'deductions'},
  {label:'Net weight',key:'netWeight'},{label:'Current weight',key:'currentWeight'},{label:'Rate',key:'rate'},
  {label:'Payout',key:'payout'},{label:'Cost remaining',key:'cost'},{label:'Status',key:'status'},{label:'Location',key:'location'},{label:'Staff',key:'staff'}
])); }
function exportLiquidations(){ downloadCSV('zpp_liquidations.csv', toCSV(db.liquidations, [
  {label:'Date',key:'date'},{label:'Metal',key:'metal'},{label:'Buyer/Refiner',key:'buyer'},{label:'Released weight',key:'releasedWeight'},
  {label:'Selling rate',key:'sellingRate'},{label:'Proceeds',key:'proceeds'},{label:'Payment status',key:'paymentStatus'},{label:'Cost',key:'cost'},{label:'Margin',key:'margin'}
])); }
function exportRefining(){ downloadCSV('zpp_refining.csv', toCSV(db.refiningBatches, [
  {label:'Date',key:'date'},{label:'Metal',key:'metal'},{label:'Refiner',key:'refiner'},{label:'Input weight',key:'inputWeight'},
  {label:'Expected yield',key:'expectedYield'},{label:'Actual yield',key:'actualYield'},{label:'Variance',key:'variance'},
  {label:'Charges',key:'refiningCharges'},{label:'Returned metal',key:'returnedMetal'}
])); }
function exportRetail(){ downloadCSV('zpp_retail_sales.csv', toCSV(db.retailSales, [
  {label:'Date',key:'date'},{label:'Buyer',key:'buyer'},{label:'Sale price',key:'salePrice'},{label:'Cost',key:'cost'},{label:'Margin',key:'margin'}
])); }
function exportCustomers(){ downloadCSV('zpp_customers.csv', toCSV(db.customers, [
  {label:'Name',key:'name'},{label:'Contact',key:'contact'},{label:'Notes',key:'notes'}
])); }
function exportRates(){ downloadCSV('zpp_rate_history.csv', toCSV(db.pricingHistory, [
  {label:'Effective date',key:'effectiveDate'},{label:'Entered by',key:'enteredBy'},
  {label:'Gold 24K base',get:h=>h.snapshot.gold.base},{label:'Silver base',get:h=>h.snapshot.silver.base},{label:'Platinum base',get:h=>h.snapshot.platinum.base}
])); }

function renderReports(){
  return `
  <section class="block">
    <h2 class="block-title">Export ledger data</h2>
    <div class="stat-row">
      <div class="stat"><div class="label">Inventory &amp; purchases</div><button class="btn small" style="margin-top:8px;" onclick="exportStock()">Download CSV</button></div>
      <div class="stat"><div class="label">Liquidation history</div><button class="btn small" style="margin-top:8px;" onclick="exportLiquidations()">Download CSV</button></div>
      <div class="stat"><div class="label">Refining history</div><button class="btn small" style="margin-top:8px;" onclick="exportRefining()">Download CSV</button></div>
      <div class="stat"><div class="label">Retail sales</div><button class="btn small" style="margin-top:8px;" onclick="exportRetail()">Download CSV</button></div>
      <div class="stat"><div class="label">Customers</div><button class="btn small" style="margin-top:8px;" onclick="exportCustomers()">Download CSV</button></div>
      <div class="stat"><div class="label">Rate history</div><button class="btn small" style="margin-top:8px;" onclick="exportRates()">Download CSV</button></div>
    </div>
  </section>

  <section class="block">
    <h2 class="block-title">Customer history (all sellers)</h2>
    ${tableOrEmpty(db.customers, c=>{
      const hist = db.stock.filter(s=>s.customerId===c.id);
      const totalW = hist.reduce((a,s)=>a+Number(s.netWeight),0);
      const totalP = hist.reduce((a,s)=>a+Number(s.payout),0);
      return `<tr><td>${esc(c.name)}</td><td class="num">${hist.length}</td><td class="num">${fmtWeight(totalW)}</td><td class="num">${fmtMoney(totalP)}</td></tr>`;
    }, ['Customer','Transactions','Total weight sold','Total payout'], 'No customers on file yet.')}
  </section>

  <section class="block">
    <h2 class="block-title">Liquidation readiness</h2>
    ${tableOrEmpty(db.stock.filter(s=>(s.status==='For Selling'||s.status==='For Refining') && s.currentWeight>0),
      s=>`<tr><td>${fmtDate(s.date)}</td><td><span class="metal-tag ${s.metal.toLowerCase()}">${s.metal}</span> ${esc(s.karat)}</td><td>${esc(s.itemType)}</td>
      <td class="num">${fmtWeight(s.currentWeight)}</td><td>${statusPill(s.status)}</td></tr>`,
      ['Date','Metal / karat','Type','Weight available','Status'],
      'Nothing is currently eligible for liquidation.')}
  </section>
  `;
}

/* ============================= INIT ============================= */
loadDB();
