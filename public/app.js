// Browser application source.
// The legacy single-page UI is incrementally typed; server and persistence code use strict TypeScript.
// @ts-nocheck
/* ============================= DATA LAYER ============================= */
let db = { rates: [], customers: [], stock: [], liquidations: [], refiningBatches: [], retailSales: [] };
let currentTab = 'dashboard';
let currentUser = null;
let userAccounts = [];
const STORE_KEY = 'zpp_gold_db';
const LEDGER_DB_NAME = 'zpp_gold_trading_ph';
const LEDGER_DB_VERSION = 1;
const ARRAY_STORES = ['customers', 'stock', 'liquidations', 'refiningBatches', 'retailSales', 'pricingHistory'];
let ledgerDB = null;
let storageLocationCleanupNeeded = false;
function uid(p) { return (p || 'id') + '_' + Math.random().toString(36).slice(2, 9); }
function todayStr() { const d = new Date(), off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); }
function monthStr() { return todayStr().slice(0, 7); }
function fmtMoney(n) { n = Number(n) || 0; return 'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtWeight(n) { return (Number(n) || 0).toFixed(2) + ' g'; }
function roundMoney(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function roundWeight(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function fmtDate(d) { if (!d)
    return '—'; const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' }); }
function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function parseMoneyEntry(value) { return Number(String(value ?? '').replace(/,/g, '')) || 0; }
function moneyEntryValue(value) {
    const number = parseMoneyEntry(value);
    return number ? number.toLocaleString('en-PH', { maximumFractionDigits: 2 }) : '';
}
function formatMoneyEntry(input) {
    const raw = String(input.value || '').replace(/,/g, '').replace(/[^0-9.]/g, '');
    if (!raw) {
        input.value = '';
        return;
    }
    const hasDecimal = raw.includes('.');
    const parts = raw.split('.');
    const whole = (parts.shift() || '0').replace(/^0+(?=\d)/, '') || '0';
    const decimals = parts.join('').slice(0, 2);
    input.value = Number(whole).toLocaleString('en-PH') + (hasDecimal ? '.' + decimals : '');
    input.setSelectionRange?.(input.value.length, input.value.length);
}
function nextSequenceId(prefix, records) {
    const maximum = records.reduce((max, record) => {
        const match = String(record.id || '').match(new RegExp(`^${prefix}-(\\d+)$`));
        return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `${prefix}-${String(maximum + 1).padStart(4, '0')}`;
}
function ensureShape() {
    db.customers = db.customers || [];
    db.stock = db.stock || [];
    db.stock.forEach(item => {
        if (Object.prototype.hasOwnProperty.call(item, 'location')) {
            delete item.location;
            storageLocationCleanupNeeded = true;
        }
    });
    db.liquidations = db.liquidations || [];
    db.refiningBatches = db.refiningBatches || [];
    db.retailSales = db.retailSales || [];
    db.pricingHistory = db.pricingHistory || [];
    db.pricingHistory.forEach(h => { if (!h.id)
        h.id = uid('rate'); });
    if (!db.pricing) {
        db.pricing = { effectiveDate: todayStr(), gold: { base: 0, overrides: {} }, silver: { base: 0, overrides: {} }, platinum: { base: 0, overrides: {} }, featured: null };
    }
    db.pricing.gold = db.pricing.gold || { base: 0, overrides: {} };
    db.pricing.gold.overrides = db.pricing.gold.overrides || {};
    db.pricing.silver = db.pricing.silver || { base: 0, overrides: {} };
    db.pricing.silver.overrides = db.pricing.silver.overrides || {};
    db.pricing.platinum = db.pricing.platinum || { base: 0, overrides: {} };
    db.pricing.platinum.overrides = db.pricing.platinum.overrides || {};
    db.pricing.auto = Object.assign({ enabled: true, payoutPct: 94, lastFetchDate: '', lastAppliedDate: '', lastFetchedAt: '', usdPhp: 0, spotUsd: {}, draft: null }, db.pricing.auto || {});
}
function openLedgerDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(LEDGER_DB_NAME, LEDGER_DB_VERSION);
        req.onupgradeneeded = () => {
            const idb = req.result;
            ARRAY_STORES.forEach(name => { if (!idb.objectStoreNames.contains(name))
                idb.createObjectStore(name, { keyPath: 'id' }); });
            if (!idb.objectStoreNames.contains('settings'))
                idb.createObjectStore('settings', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function idbRequest(req) { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
async function loadFromLedgerDB() {
    const tx = ledgerDB.transaction([...ARRAY_STORES, 'settings'], 'readonly');
    const arrayReads = ARRAY_STORES.map(name => idbRequest(tx.objectStore(name).getAll()));
    const pricingRead = idbRequest(tx.objectStore('settings').get('pricing'));
    const values = await Promise.all([...arrayReads, pricingRead]);
    const loaded = {};
    ARRAY_STORES.forEach((name, i) => loaded[name] = values[i]);
    const pricing = values[values.length - 1];
    if (!pricing && ARRAY_STORES.every(name => !loaded[name].length))
        return false;
    ARRAY_STORES.forEach(name => db[name] = loaded[name]);
    db.pricing = pricing ? pricing.value : null;
    ensureShape();
    return true;
}
async function saveDB() {
    try {
        ensureShape();
        if (location.protocol === 'http:' || location.protocol === 'https:') {
            const response = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(db) });
            if (response.status === 401) {
                showLogin();
                throw new Error('Session expired');
            }
            if (!response.ok)
                throw new Error('Database server returned HTTP ' + response.status);
            storageLocationCleanupNeeded = false;
            return true;
        }
        if (!ledgerDB)
            ledgerDB = await openLedgerDB();
        const snapshot = JSON.parse(JSON.stringify(db));
        await new Promise((resolve, reject) => {
            const tx = ledgerDB.transaction([...ARRAY_STORES, 'settings'], 'readwrite');
            ARRAY_STORES.forEach(name => {
                const store = tx.objectStore(name);
                store.clear();
                (snapshot[name] || []).forEach(item => store.put(item));
            });
            tx.objectStore('settings').put({ id: 'pricing', value: snapshot.pricing });
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        storageLocationCleanupNeeded = false;
        return true;
    }
    catch (e) {
        console.error('Save failed', e);
        toast('Could not save — changes may not persist');
        return false;
    }
}
function seedDemo() {
    const c1 = uid('cust');
    db.customers = [{ id: c1, name: 'Maria Santos', contact: '0917 555 2210', notes: 'Regular seller, mostly 18K scrap.' }];
    db.pricing = {
        effectiveDate: todayStr(),
        gold: { base: 8350, overrides: {} },
        silver: { base: 70, overrides: {} },
        platinum: { base: 2300, overrides: {} },
        auto: { enabled: true, payoutPct: 94, lastFetchDate: '', lastAppliedDate: '', lastFetchedAt: '', usdPhp: 0, spotUsd: {}, draft: null },
        featured: { metal: 'Gold', key: '18K-BUO', low: 6360, high: 6560 }
    };
    db.pricingHistory = [{ id: uid('rate'), ts: Date.now(), effectiveDate: todayStr(), enteredBy: 'Admin', snapshot: JSON.parse(JSON.stringify(db.pricing)) }];
    const netW = 15.00, rate = 6260, amt = netW * rate;
    db.stock = [{
            id: uid('stk'), date: todayStr(), customerId: c1, customerName: 'Maria Santos',
            metal: 'Gold', itemType: 'Scrap', karat: '18K', grossWeight: 15.25, deductions: 0.25,
            netWeight: netW, currentWeight: netW, rate: rate, suggestedAmount: amt, payout: amt,
            overrideReason: '', paymentMethod: 'Cash', staff: 'Joseph Reyes', status: 'For Refining',
            remarks: 'Sample entry from proposal illustration', cost: amt
        }];
    db.liquidations = [];
    db.refiningBatches = [];
    db.retailSales = [];
}
async function loadDB() {
    try {
        if (location.protocol === 'http:' || location.protocol === 'https:') {
            const response = await fetch('/api/state', { cache: 'no-store' });
            if (response.status === 401) {
                showLogin();
                return;
            }
            if (!response.ok)
                throw new Error('Database server returned HTTP ' + response.status);
            const serverState = await response.json();
            if (serverState.pricing) {
                db = serverState;
                ensureShape();
                if (storageLocationCleanupNeeded)
                    await saveDB();
            }
            else {
                seedDemo();
                ensureShape();
                await saveDB();
            }
            boot();
            if (isAdmin() && db.pricing.auto.enabled && db.pricing.auto.lastAppliedDate !== todayStr())
                refreshPhilippineRates(true);
            return;
        }
        ledgerDB = await openLedgerDB();
        const found = await loadFromLedgerDB();
        if (found && storageLocationCleanupNeeded)
            await saveDB();
        if (!found) {
            let legacy = null;
            try {
                if (window.storage && typeof window.storage.get === 'function') {
                    const r = await window.storage.get(STORE_KEY, false);
                    legacy = r && r.value;
                }
                if (!legacy)
                    legacy = localStorage.getItem(STORE_KEY);
            }
            catch (ignore) { }
            if (legacy) {
                db = JSON.parse(legacy);
                ensureShape();
            }
            else
                seedDemo();
            await saveDB();
        }
    }
    catch (e) {
        console.error('Database load failed', e);
        seedDemo();
        ensureShape();
    }
    boot();
    if (isAdmin() && db.pricing.auto.enabled && db.pricing.auto.lastAppliedDate !== todayStr())
        refreshPhilippineRates(true);
}
function isAdmin() { return currentUser?.role === 'admin'; }
function allowedTabs() { return TABS.filter(tab => isAdmin() || tab.staff); }
function showLogin() {
    currentUser = null;
    document.getElementById('appShell')?.classList.add('is-hidden');
    document.getElementById('loginScreen')?.classList.remove('is-hidden');
}
function showApp() {
    document.getElementById('loginScreen')?.classList.add('is-hidden');
    document.getElementById('appShell')?.classList.remove('is-hidden');
    const userEl = document.getElementById('sessionUser');
    if (userEl)
        userEl.innerHTML = `${esc(currentUser.displayName)}<br><span class="session-role">${esc(currentUser.role)}</span>`;
    const badge = document.getElementById('accessBadge');
    if (badge) {
        badge.className = `access-badge ${currentUser.role}`;
        badge.textContent = `${currentUser.role.toUpperCase()} ACCESS`;
        badge.title = `Signed in as ${currentUser.displayName} (${currentUser.role})`;
    }
}
async function initializeAuth() {
    try {
        const response = await fetch('/api/session', { cache: 'no-store' });
        if (!response.ok) {
            showLogin();
            return;
        }
        const result = await response.json();
        currentUser = result.user;
        showApp();
        await loadDB();
    }
    catch (error) {
        console.error('Session check failed', error);
        showLogin();
    }
}
async function signIn(event) {
    event.preventDefault();
    const errorEl = document.getElementById('login_error');
    const username = val('login_username').trim(), password = val('login_password');
    errorEl.textContent = 'Signing in…';
    try {
        const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || 'Sign-in failed');
        currentUser = result.user;
        currentTab = 'dashboard';
        errorEl.textContent = '';
        showApp();
        await loadDB();
    }
    catch (error) {
        errorEl.textContent = error.message || 'Sign-in failed';
    }
}
async function signOut() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    }
    catch (ignore) { }
    db = { rates: [], customers: [], stock: [], liquidations: [], refiningBatches: [], retailSales: [] };
    userAccounts = [];
    showLogin();
}
async function resetDemo() {
    if (!confirm('This replaces all current data with the sample dataset. Continue?'))
        return;
    seedDemo();
    await saveDB();
    render();
    toast('Sample data restored');
}
function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
}
/* ============================= PRICING / RATES ============================= */
const GOLD_GRADES = [
    { key: '24K', label: '24K', mult: 1 },
    { key: '23K', label: '23K', mult: 0.965 },
    { key: '22K', label: '22K', mult: 0.916 },
    { key: '21K', label: '21K', mult: 0.875 },
    { key: '18K', label: '18K', mult: 0.75 },
    { key: '18K-BUO', label: '18K-Buo', mult: 0.75 },
    { key: '16K', label: '16K', mult: 0.667 },
    { key: '14K', label: '14K', mult: 0.585 },
    { key: '12K', label: '12K', mult: 0.375 },
    { key: '10K', label: '10K', mult: 0.35 },
    { key: '8K', label: '8K', mult: 0.25 },
    { key: '98%', label: '98%', mult: 0.98 },
    { key: '73%', label: '73%', mult: 0.73 },
];
const SILVER_GRADES = ['999', '925', '900', '800'];
const PLATINUM_GRADES = ['999', '950', '900', '850'];
const GRADES = { Gold: GOLD_GRADES.map(g => g.key), Silver: SILVER_GRADES, Platinum: PLATINUM_GRADES };
function gradeMeta(metal, key) {
    if (metal === 'Gold')
        return GOLD_GRADES.find(g => g.key === key) || null;
    return { key, label: key, mult: 1 };
}
function computedRate(metal, key) {
    if (metal === 'Gold') {
        const g = GOLD_GRADES.find(x => x.key === key);
        return g ? +(db.pricing.gold.base * g.mult).toFixed(2) : 0;
    }
    if (metal === 'Silver')
        return +(db.pricing.silver.base * (parseInt(key, 10) / 999)).toFixed(2);
    if (metal === 'Platinum')
        return +(db.pricing.platinum.base * (parseInt(key, 10) / 999)).toFixed(2);
    return 0;
}
function bucketFor(metal) { return metal === 'Gold' ? db.pricing.gold : metal === 'Silver' ? db.pricing.silver : db.pricing.platinum; }
function metalRate(metal, key) {
    const b = bucketFor(metal);
    const ov = b.overrides[key];
    return (ov != null && ov !== '') ? +ov : computedRate(metal, key);
}
function isOverridden(metal, key) {
    const b = bucketFor(metal);
    return b.overrides[key] != null && b.overrides[key] !== '';
}
function gradeLabel(metal, key) { const g = gradeMeta(metal, key); return g ? g.label : key; }
function distinctKarats(metal) { return GRADES[metal] || []; }
function activeRate(metal, karat) {
    if (!GRADES[metal] || !GRADES[metal].includes(karat))
        return null;
    return { rate: metalRate(metal, karat), effectiveDate: db.pricing.effectiveDate };
}
function setBase(metal, value) {
    const v = parseFloat(value);
    bucketFor(metal).base = isNaN(v) ? 0 : v;
    saveDB();
    render();
}
function setOverride(metal, key, value) {
    const b = bucketFor(metal);
    if (value === '') {
        delete b.overrides[key];
    }
    else {
        b.overrides[key] = parseFloat(value);
    }
    saveDB();
    render();
}
function resetOverride(metal, key) {
    delete bucketFor(metal).overrides[key];
    saveDB();
    render();
}
function setFeatured(metal, key, low, high) {
    db.pricing.featured = { metal, key, low: parseFloat(low) || 0, high: parseFloat(high) || 0 };
    saveDB();
    render();
}
function clearFeatured() { db.pricing.featured = null; saveDB(); render(); }
let pricingFetchBusy = false;
const overrideEditors = new Set();
const TROY_OUNCE_GRAMS = 31.1034768;
async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        if (response.status === 401 && String(url).startsWith('/api/'))
            showLogin();
        throw new Error(payload?.error || ('Price service returned HTTP ' + response.status));
    }
    return payload;
}
async function refreshPhilippineRates(silent) {
    if (pricingFetchBusy)
        return;
    pricingFetchBusy = true;
    if (!silent)
        render();
    try {
        let proposal;
        if (location.protocol === 'http:' || location.protocol === 'https:') {
            proposal = await fetchJson('/api/market?apply=1&payoutPct=' + encodeURIComponent(db.pricing.auto.payoutPct));
        }
        else {
            const [gold, silver, platinum, fx] = await Promise.all([
                fetchJson('https://api.gold-api.com/price/XAU'), fetchJson('https://api.gold-api.com/price/XAG'),
                fetchJson('https://api.gold-api.com/price/XPT'), fetchJson('https://open.er-api.com/v6/latest/USD')
            ]);
            const usdPhp = Number(fx.rates && fx.rates.PHP), spotUsd = { Gold: Number(gold.price), Silver: Number(silver.price), Platinum: Number(platinum.price) };
            if (!usdPhp || Object.values(spotUsd).some(v => !v))
                throw new Error('Incomplete market data');
            const factor = Math.max(0, Math.min(100, Number(db.pricing.auto.payoutPct) || 0)) / 100;
            proposal = { effectiveDate: todayStr(), fetchedAt: new Date().toISOString(), usdPhp, spotUsd, draft: { effectiveDate: todayStr(), gold: +(spotUsd.Gold * usdPhp / TROY_OUNCE_GRAMS * factor).toFixed(2), silver: +(spotUsd.Silver * usdPhp / TROY_OUNCE_GRAMS * factor).toFixed(2), platinum: +(spotUsd.Platinum * usdPhp / TROY_OUNCE_GRAMS * factor).toFixed(2) } };
        }
        db.pricing.auto.lastFetchDate = proposal.effectiveDate;
        db.pricing.auto.lastFetchedAt = proposal.fetchedAt;
        db.pricing.auto.usdPhp = proposal.usdPhp;
        db.pricing.auto.spotUsd = proposal.spotUsd;
        activateMarketRates(proposal.draft, silent ? 'Automatic 5-second internet update' : 'Manual internet refresh', !silent);
        if (isAdmin())
            await saveDB();
        if (!silent)
            toast('Live internet prices refreshed and activated');
    }
    catch (e) {
        console.error('Automatic pricing failed', e);
        if (!silent)
            toast(`Live pricing unavailable — ${e.message || 'current rates are unchanged'}`);
    }
    finally {
        pricingFetchBusy = false;
        // Background market polling must never replace an in-progress form or
        // clear selections on another page. Only the rate screen needs a redraw.
        const editingRateField = currentTab === 'rates' && document.activeElement?.matches('input,select,textarea');
        if (!silent || (currentTab === 'rates' && !editingRateField))
            render();
    }
}
function activateMarketRates(d, enteredBy, recordHistory = true) {
    db.pricing.gold.base = d.gold;
    db.pricing.silver.base = d.silver;
    db.pricing.platinum.base = d.platinum;
    db.pricing.effectiveDate = d.effectiveDate;
    db.pricing.auto.lastAppliedDate = d.effectiveDate;
    db.pricing.auto.draft = null;
    const duplicate = db.pricingHistory.some(h => h.effectiveDate === d.effectiveDate && h.enteredBy === enteredBy &&
        Number(h.snapshot?.gold?.base) === Number(d.gold) &&
        Number(h.snapshot?.silver?.base) === Number(d.silver) &&
        Number(h.snapshot?.platinum?.base) === Number(d.platinum));
    if (recordHistory && !duplicate) {
        db.pricingHistory.push({ id: uid('rate'), ts: Date.now(), effectiveDate: d.effectiveDate, enteredBy, snapshot: JSON.parse(JSON.stringify(db.pricing)) });
    }
}
function visiblePricingHistory() {
    const seen = new Set();
    return db.pricingHistory.slice().sort((a, b) => b.ts - a.ts).filter(h => {
        const key = [h.effectiveDate, h.enteredBy, h.snapshot?.gold?.base, h.snapshot?.silver?.base, h.snapshot?.platinum?.base].join('|');
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function setAutoEnabled(checked) { db.pricing.auto.enabled = checked; saveDB(); render(); }
function setPayoutPct(value) {
    const n = parseFloat(value);
    if (!isNaN(n))
        db.pricing.auto.payoutPct = Math.max(0, Math.min(100, n));
    db.pricing.auto.draft = null;
    saveDB();
    render();
}
function overrideEditorId(metal, key) { return metal + '|' + key; }
function beginOverride(metal, key) {
    const id = overrideEditorId(metal, key);
    overrideEditors.add(id);
    render();
    requestAnimationFrame(() => {
        const input = document.querySelector(`[data-rate-editor="${metal}-${key}"]`);
        if (input) {
            input.focus();
            input.select();
        }
    });
}
function cancelOverride(metal, key) { overrideEditors.delete(overrideEditorId(metal, key)); render(); }
function commitOverride(metal, key, value) {
    const n = parseFloat(value);
    if (!Number.isFinite(n) || n < 0) {
        toast('Enter a valid non-negative price');
        return;
    }
    overrideEditors.delete(overrideEditorId(metal, key));
    setOverride(metal, key, n);
    toast(`${gradeLabel(metal, key)} price overridden`);
}
function savePricingSnapshot() {
    const by = val('px_by').trim() || 'Admin';
    const date = val('px_date') || todayStr();
    db.pricing.effectiveDate = date;
    db.pricingHistory.push({ id: uid('rate'), ts: Date.now(), effectiveDate: date, enteredBy: by, snapshot: JSON.parse(JSON.stringify(db.pricing)) });
    saveDB();
    render();
    toast('Rate sheet saved to history');
}
/* ============================= NAV / BOOT ============================= */
const TABS = [
    { id: 'dashboard', label: 'Dashboard & reports' },
    { id: 'rates', label: 'Daily rate setup', staff: true },
    { id: 'buying', label: 'Buying transactions', staff: true },
    { id: 'inventory', label: 'Inventory', staff: true },
    { id: 'liquidation', label: 'Selective liquidation' },
    { id: 'refining', label: 'Refining tracking' },
    { id: 'retail', label: 'Limited retail sales' },
    { id: 'customers', label: 'Customer management' },
    { id: 'users', label: 'User accounts' },
];
function boot() {
    const nav = document.getElementById('navTabs');
    if (!allowedTabs().some(tab => tab.id === currentTab))
        currentTab = allowedTabs()[0]?.id || 'buying';
    nav.innerHTML = allowedTabs().map(t => `<button data-tab="${t.id}" class="${t.id === currentTab ? 'active' : ''}" onclick="goTab('${t.id}')"><span class="dot"></span>${t.label}</button>`).join('');
    document.getElementById('pageDate').textContent = fmtDate(todayStr());
    render();
    startAutomaticPricing();
}
let automaticPricingTimer = null;
function startAutomaticPricing() {
    if (automaticPricingTimer)
        return;
    automaticPricingTimer = setInterval(() => {
        if (currentUser && db.pricing.auto.enabled && !document.hidden)
            refreshPhilippineRates(true);
    }, 5000);
    document.addEventListener('visibilitychange', () => {
        if (currentUser && !document.hidden && db.pricing.auto.enabled)
            refreshPhilippineRates(true);
    });
}
function goTab(id) {
    if (!allowedTabs().some(tab => tab.id === id))
        return;
    currentTab = id;
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    render();
    if (id === 'users')
        loadUserAccounts();
}
function render() {
    const titles = {
        dashboard: ['Admin overview, records & exports', 'Dashboard & reports'],
        rates: ['Pricing control', 'Daily rate setup'],
        buying: ['Record a purchase', 'Buying transactions'],
        inventory: ['Current stock', 'Inventory'],
        liquidation: ['Release stock to a buyer or refiner', 'Selective liquidation'],
        refining: ['Refining batches', 'Refining tracking'],
        retail: ['Walk-in resale', 'Limited retail sales'],
        customers: ['Sellers on file', 'Customer management'],
        users: ['Access control', 'User accounts'],
    };
    document.getElementById('pageEyebrow').textContent = titles[currentTab][0];
    document.getElementById('pageTitle').textContent = titles[currentTab][1];
    const el = document.getElementById('content');
    const fns = { dashboard: renderDashboard, rates: renderRates, buying: renderBuying, inventory: renderInventory,
        liquidation: renderLiquidation, refining: renderRefining, retail: renderRetail, customers: renderCustomers,
        users: renderUsers };
    el.innerHTML = fns[currentTab]();
    if (currentTab === 'liquidation')
        requestAnimationFrame(updateLiquidationPreview);
}
/* ============================= DASHBOARD ============================= */
let dashboardReportPanel = '';
function toggleDashboardReport(panel) {
    dashboardReportPanel = dashboardReportPanel === panel ? '' : panel;
    render();
    if (dashboardReportPanel)
        requestAnimationFrame(() => document.getElementById('dashboard_report_content')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
function filterDashboardReport(value) {
    const query = String(value || '').trim().toLowerCase();
    const rows = Array.from(document.querySelectorAll('#dashboard_report_content [data-dashboard-search]'));
    let visible = 0;
    rows.forEach(row => {
        const matches = !query || String(row.dataset.dashboardSearch || '').includes(query);
        row.hidden = !matches;
        if (matches)
            visible += 1;
    });
    const count = document.getElementById('dashboard_search_result_count');
    if (count)
        count.textContent = `Showing ${visible} of ${rows.length}`;
    document.getElementById('dashboard_search_empty')?.classList.toggle('is-hidden', visible > 0 || !rows.length);
}
function dashboardReportSearch(placeholder, total) {
    return `<div class="dashboard-report-search"><div class="field"><label for="dashboard_report_search">Search records</label><input id="dashboard_report_search" type="search" autocomplete="off" placeholder="${esc(placeholder)}" oninput="filterDashboardReport(this.value)"></div><span id="dashboard_search_result_count">Showing ${total} of ${total}</span></div><div id="dashboard_search_empty" class="empty-note is-hidden">No records match your search.</div>`;
}
function dashboardSearchValue(...values) { return esc(values.filter(value => value != null).join(' ').toLowerCase()); }
function renderDashboard() {
    const today = todayStr(), mon = monthStr();
    const purchases = db.stock.filter(s => !s.sourceRefiningBatchId);
    const pToday = purchases.filter(s => s.date === today);
    const pMonth = purchases.filter(s => s.date.startsWith(mon));
    const payoutToday = pToday.reduce((a, s) => a + Number(s.payout), 0);
    const payoutMonth = pMonth.reduce((a, s) => a + Number(s.payout), 0);
    const liqMonth = db.liquidations.filter(l => l.date.startsWith(mon));
    const liqMargin = liqMonth.reduce((a, l) => a + Number(l.margin), 0);
    const retailMonth = db.retailSales.filter(r => r.date.startsWith(mon));
    const retailMargin = retailMonth.reduce((a, r) => a + Number(r.margin), 0);
    return `
  <section class="block">
    <h2 class="block-title">Today &amp; this month</h2>
    <div class="stat-row">
      <div class="stat"><div class="label">Purchases today</div><div class="value">${pToday.length}</div><div class="sub">${fmtMoney(payoutToday)} paid out</div></div>
      <div class="stat"><div class="label">Purchases this month</div><div class="value">${pMonth.length}</div><div class="sub">${fmtMoney(payoutMonth)} paid out</div></div>
      ${isAdmin() ? `<div class="stat"><div class="label">Liquidation margin (month)</div><div class="value">${fmtMoney(liqMargin)}</div><div class="sub">${liqMonth.length} batch(es) released</div></div>
      <div class="stat"><div class="label">Retail margin (month)</div><div class="value">${fmtMoney(retailMargin)}</div><div class="sub">${retailMonth.length} item(s) sold</div></div>` : ''}
    </div>
  </section>

  ${isAdmin() ? renderReports() : ''}
  `;
}
function statusPill(status) {
    const map = { 'For Selling': 'selling', 'For Refining': 'refining', 'On Hold': 'hold', 'Liquidated': 'liquidated', 'Refined': 'liquidated', 'Sold': 'sold' };
    return `<span class="pill ${map[status] || ''}">${status}</span>`;
}
function tableOrEmpty(rows, rowFn, headers, emptyMsg) {
    if (!rows.length)
        return `<div class="empty-note">${emptyMsg}</div>`;
    const numericHeaders = new Set(['Net weight', 'Payout']);
    return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th class="${numericHeaders.has(h) ? 'num-head' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(rowFn).join('')}</tbody></table></div>`;
}
/* ============================= RATES ============================= */
function renderRates() {
    if (!isAdmin())
        return renderStaffRates();
    const goldGrid = GOLD_GRADES.filter(g => g.key !== '24K');
    const auto = db.pricing.auto;
    const fetched = auto.lastFetchedAt ? new Date(auto.lastFetchedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'medium' }) : 'Not fetched yet';
    return `
  <section class="auto-panel">
    <div class="auto-panel-head">
      <div>
        <h3>Automatic Philippine internet pricing</h3>
        <div class="metal-section-desc" style="margin:0;">Live USD metal prices are converted to PHP per gram, adjusted by your buying payout percentage, and activated automatically once per Philippine day.</div>
        <div class="auto-status">${pricingFetchBusy ? '<span class="spinner"></span>Updating market data…' : `Last checked: ${esc(fetched)}${auto.usdPhp ? ` · USD/PHP ${Number(auto.usdPhp).toFixed(4)}` : ''}`}</div>
      </div>
      <div class="auto-controls">
        <label class="switch-line"><input type="checkbox" ${auto.enabled ? 'checked' : ''} onchange="setAutoEnabled(this.checked)"> Update automatically every 5 seconds</label>
        <div class="field"><label>Buying payout</label><div style="display:flex;align-items:center;gap:5px"><input style="width:82px" type="number" min="0" max="100" step="0.1" value="${auto.payoutPct}" onchange="setPayoutPct(this.value)"><span>%</span></div></div>
        <button class="btn small" onclick="refreshPhilippineRates(false)" ${pricingFetchBusy ? 'disabled' : ''}>Refresh &amp; apply now</button>
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
        <div class="base-input"><span>₱</span><input type="text" inputmode="decimal" value="${db.pricing.gold.base || ''}" onchange="setBase('Gold', this.value)"></div>
      </div>
      ${renderFeaturedBox()}
    </div>
    <div class="grade-grid">${goldGrid.map(g => renderGradeCard('Gold', g.key, g.label, g.mult)).join('')}</div>
  </section>

  <section class="metal-section">
    <div class="metal-section-head"><span class="metal-dot silver"></span><h3>Silver</h3><span class="count">${SILVER_GRADES.length} grades</span></div>
    <div class="base-row">
      <div class="base-box">
        <div class="base-label">999 rate — pure silver</div>
        <div class="base-input"><span>₱</span><input type="text" inputmode="decimal" value="${db.pricing.silver.base || ''}" onchange="setBase('Silver', this.value)"></div>
      </div>
    </div>
    <div class="grade-grid">${SILVER_GRADES.map(k => renderGradeCard('Silver', k, k, null)).join('')}</div>
  </section>

  <section class="metal-section">
    <div class="metal-section-head"><span class="metal-dot platinum"></span><h3>Platinum</h3><span class="count">${PLATINUM_GRADES.length} grades</span></div>
    <div class="base-row">
      <div class="base-box">
        <div class="base-label">999 rate — pure platinum</div>
        <div class="base-input"><span>₱</span><input type="text" inputmode="decimal" value="${db.pricing.platinum.base || ''}" onchange="setBase('Platinum', this.value)"></div>
      </div>
    </div>
    <div class="grade-grid">${PLATINUM_GRADES.map(k => renderGradeCard('Platinum', k, k, null)).join('')}</div>
  </section>

  <section class="block">
    <h2 class="block-title">Save today's rate sheet</h2>
    <div class="form-grid">
      <div class="field"><label>Effective date</label><input id="px_date" type="date" value="${db.pricing.effectiveDate || todayStr()}"></div>
      <div class="field"><label>Entered by</label><input id="px_by" placeholder="Staff name"></div>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="savePricingSnapshot()">Save rate sheet</button>
      <span class="form-note">Rates above already apply to new purchases as you edit them. Saving records this sheet in the audit history below.</span>
    </div>
  </section>

  `;
}
function renderStaffRates() {
    const fetched = db.pricing.auto.lastFetchedAt ? new Date(db.pricing.auto.lastFetchedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'medium' }) : 'Not fetched yet';
    return `
  <section class="auto-panel">
    <div class="auto-panel-head"><div><h3>Active buying rates</h3><div class="metal-section-desc" style="margin:0;">Live base pricing refreshes every five seconds. Staff may override individual grades when needed.</div><div class="auto-status">Effective date: ${fmtDate(db.pricing.effectiveDate)} · Last checked: ${esc(fetched)}</div></div></div>
  </section>
  <section class="metal-section">
    <div class="metal-section-head"><span class="metal-dot gold"></span><h3>Gold</h3><span class="count">${GOLD_GRADES.length} grades</span></div>
    <div class="grade-grid">${GOLD_GRADES.map(g => renderGradeCard('Gold', g.key, g.label, g.mult)).join('')}</div>
  </section>
  <section class="metal-section">
    <div class="metal-section-head"><span class="metal-dot silver"></span><h3>Silver</h3><span class="count">${SILVER_GRADES.length} grades</span></div>
    <div class="grade-grid">${SILVER_GRADES.map(key => renderGradeCard('Silver', key, key, null)).join('')}</div>
  </section>
  <section class="metal-section">
    <div class="metal-section-head"><span class="metal-dot platinum"></span><h3>Platinum</h3><span class="count">${PLATINUM_GRADES.length} grades</span></div>
    <div class="grade-grid">${PLATINUM_GRADES.map(key => renderGradeCard('Platinum', key, key, null)).join('')}</div>
  </section>`;
}
function renderGradeCard(metal, key, label, mult) {
    const ov = isOverridden(metal, key);
    const editing = overrideEditors.has(overrideEditorId(metal, key));
    const rate = metalRate(metal, key);
    const multTxt = (mult != null) ? `×${mult}` : `×${(parseInt(key, 10) / 999).toFixed(3)}`;
    const rateControl = editing || ov
        ? `<input data-rate-editor="${metal}-${key}" type="text" inputmode="decimal" value="${rate}" onchange="commitOverride('${metal}','${key}', this.value)">`
        : `<span class="gc-value">${rate}</span>`;
    return `<div class="grade-card ${ov ? 'is-override' : ''}">
    <div class="gc-top"><span>${esc(label)}</span><span>${multTxt}</span></div>
    <div class="gc-rate"><span class="unit">₱</span>${rateControl}<span class="unit">/g</span></div>
    <div class="gc-foot">${ov ? `<span class="ov-tag">overridden</span> · <button onclick="resetOverride('${metal}','${key}')">reset to live price</button>` : editing ? `<button onclick="cancelOverride('${metal}','${key}')">cancel override</button>` : `<button onclick="beginOverride('${metal}','${key}')">Override price</button>`}</div>
  </div>`;
}
function renderFeaturedBox() {
    const f = db.pricing.featured;
    if (!f) {
        return `<div class="featured-box">
      <span class="fx-label">Pin a grade to quote a buying range to staff</span>
      <div class="fx-edit">
        <select id="fx_metal" onchange="updateFxKeyOptions()">${['Gold', 'Silver', 'Platinum'].map(m => `<option>${m}</option>`).join('')}</select>
        <select id="fx_key">${GRADES['Gold'].map(k => `<option value="${k}">${gradeLabel('Gold', k)}</option>`).join('')}</select>
        <input id="fx_low" type="text" inputmode="decimal" placeholder="Low">
        <input id="fx_high" type="text" inputmode="decimal" placeholder="High">
        <button class="btn small" onclick="saveFeaturedFromForm()">Pin</button>
      </div>
    </div>`;
    }
    return `<div class="featured-box">
    <span class="fx-grade">${esc(gradeLabel(f.metal, f.key))}</span>
    <span class="fx-range">₱${Number(f.low).toLocaleString()}–${Number(f.high).toLocaleString()}</span>
    <button class="btn small secondary" style="color:var(--cream-text);border-color:#45412F;" onclick="clearFeatured()">Unpin</button>
  </div>`;
}
function updateFxKeyOptions() {
    const m = val('fx_metal');
    const sel = document.getElementById('fx_key');
    if (sel)
        sel.innerHTML = GRADES[m].map(k => `<option value="${k}">${gradeLabel(m, k)}</option>`).join('');
}
function saveFeaturedFromForm() {
    const metal = val('fx_metal'), key = val('fx_key'), low = val('fx_low'), high = val('fx_high');
    if (low === '' || high === '') {
        toast('Enter both a low and high value');
        return;
    }
    setFeatured(metal, key, low, high);
}
function val(id) { const e = document.getElementById(id); return e ? e.value : ''; }
/* ============================= ADMIN EDIT MODALS ============================= */
function openAdminEditModal(title, formMarkup, saveAction, deleteAction = '') {
    if (!isAdmin()) {
        toast('Administrator access required');
        return;
    }
    closeAdminEditModal();
    const modal = document.createElement('div');
    modal.id = 'admin_edit_modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="edit-modal" role="dialog" aria-modal="true" aria-labelledby="admin_edit_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Administrator edit</div><h2 id="admin_edit_title">${esc(title)}</h2></div><button class="modal-close" onclick="closeAdminEditModal()" aria-label="Close">×</button></div>
    ${formMarkup}
    <div class="form-actions">${deleteAction ? `<button class="btn danger" onclick="${deleteAction}()">Delete record</button>` : ''}<button class="btn secondary" onclick="closeAdminEditModal()">Cancel</button><button class="btn" onclick="${saveAction}()">Save changes</button></div>
  </div>`;
    modal.addEventListener('click', event => { if (event.target === modal)
        closeAdminEditModal(); });
    document.body.appendChild(modal);
    modal.querySelector('input, select, textarea')?.focus();
}
function closeAdminEditModal() { document.getElementById('admin_edit_modal')?.remove(); }
function adminEditButton(kind, id) { return isAdmin() ? `<button class="btn secondary small" onclick="open${kind}Edit('${id}')">Edit</button>` : ''; }
function adminEditGuard() { if (!isAdmin()) {
    toast('Administrator access required');
    return false;
} return true; }
/* ============================= CUSTOMERS ============================= */
let custSearch = '', custOpen = null;
function renderCustomers() {
    const list = db.customers.filter(c => (c.name + c.contact).toLowerCase().includes(custSearch.toLowerCase()));
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
      <div class="field"><label>Search</label><input id="customer_search" value="${esc(custSearch)}" oninput="updateCustomerSearch(this.value)" placeholder="Search name or contact"></div>
    </div>
    <div id="customer_results">${renderCustomerTable(list)}</div>
  </section>
  `;
}
function renderCustomerTable(list) {
    return tableOrEmpty(list, c => {
        const history = db.stock.filter(s => s.customerId === c.id);
        const totalPayout = history.reduce((a, s) => a + Number(s.payout), 0);
        return `<tr><td>${esc(c.name)}</td><td>${esc(c.contact || '—')}</td><td>${esc(c.notes || '—')}</td>
      <td class="num">${history.length} sale(s) · ${fmtMoney(totalPayout)}</td>
      <td><div class="form-actions"><button class="btn secondary small" onclick="toggleCustHist('${c.id}')">${custOpen === c.id ? 'Hide' : 'View'} history</button>${adminEditButton('Customer', c.id)}</div></td></tr>
      ${custOpen === c.id ? `<tr><td colspan="5"><div class="customer-hist">${history.length ? history.map(s => `${fmtDate(s.date)} — ${s.metal} ${esc(s.karat)} ${esc(s.itemType)}, ${fmtWeight(s.netWeight)}, ${fmtMoney(s.payout)} (${s.status})`).join('<br>') : 'No purchases from this customer yet.'}</div></td></tr>` : ''}`;
    }, ['Name', 'Contact', 'Notes', 'Selling history', ''], custSearch ? 'No customers match your search.' : 'No customers yet.');
}
function updateCustomerSearch(value) {
    custSearch = value;
    const list = db.customers.filter(c => (c.name + c.contact).toLowerCase().includes(custSearch.toLowerCase()));
    const results = document.getElementById('customer_results');
    if (results)
        results.innerHTML = renderCustomerTable(list);
}
function toggleCustHist(id) { custOpen = (custOpen === id ? null : id); render(); }
function addCustomer() {
    const name = val('c_name').trim(), contact = val('c_contact').trim(), notes = val('c_notes').trim();
    if (!name) {
        toast('Enter a customer name');
        return;
    }
    db.customers.push({ id: uid('cust'), name, contact, notes });
    saveDB();
    render();
    toast('Customer added');
}
let editingCustomerId = null;
function openCustomerEdit(id) {
    const customer = db.customers.find(c => c.id === id);
    if (!customer || !adminEditGuard())
        return;
    editingCustomerId = id;
    openAdminEditModal('Edit customer', `<div class="form-grid">
    <div class="field"><label>Name</label><input id="edit_customer_name" value="${esc(customer.name)}"></div>
    <div class="field"><label>Contact</label><input id="edit_customer_contact" value="${esc(customer.contact || '')}"></div>
    <div class="field span-2"><label>Notes</label><textarea id="edit_customer_notes">${esc(customer.notes || '')}</textarea></div>
  </div>`, 'saveCustomerEdit', 'deleteCustomerRecord');
}
async function saveCustomerEdit() {
    if (!adminEditGuard())
        return;
    const customer = db.customers.find(c => c.id === editingCustomerId), name = val('edit_customer_name').trim();
    if (!customer)
        return;
    if (!name) {
        toast('Customer name is required');
        return;
    }
    customer.name = name;
    customer.contact = val('edit_customer_contact').trim();
    customer.notes = val('edit_customer_notes').trim();
    db.stock.filter(s => s.customerId === customer.id).forEach(s => s.customerName = name);
    closeAdminEditModal();
    await saveDB();
    render();
    toast('Customer updated');
}
async function deleteCustomerRecord() {
    if (!adminEditGuard())
        return;
    const customer = db.customers.find(c => c.id === editingCustomerId);
    if (!customer)
        return;
    if (db.stock.some(item => item.customerId === customer.id)) {
        toast('This customer has purchase history and cannot be deleted');
        return;
    }
    if (!confirm(`Delete customer "${customer.name}"? This cannot be undone.`))
        return;
    db.customers = db.customers.filter(c => c.id !== customer.id);
    closeAdminEditModal();
    await saveDB();
    render();
    toast('Customer deleted');
}
/* ============================= BUYING ============================= */
let purchaseBatch = [];
function renderBuying() {
    const sellerName = val('b_seller_name');
    const metal = val('b_metal') || 'Gold';
    const karats = distinctKarats(metal);
    const requestedKarat = val('b_karat');
    const karat = (karats.includes(requestedKarat) ? requestedKarat : karats[0]) || '';
    const rateObj = karat ? activeRate(metal, karat) : null;
    const gross = parseFloat(val('b_gross')) || 0, ded = parseFloat(val('b_ded')) || 0;
    const net = Math.max(roundWeight(gross - ded), 0);
    const rate = rateObj ? rateObj.rate : 0;
    const suggested = roundMoney(net * rate);
    return `
  <section class="block buying-workflow">
    <div class="buying-step">
      <div class="step-number">1</div>
      <div class="step-content">
        <h2>Add an item</h2>
        <p>Choose the grade and enter its weight. The amount calculates automatically.</p>
        <div class="form-grid buying-item-grid">
      <div class="field"><label>Metal</label>
        <select id="b_metal" onchange="updateBuyingGrades()">
          <option value="Gold" ${metal === 'Gold' ? 'selected' : ''}>Gold</option>
          <option value="Silver" ${metal === 'Silver' ? 'selected' : ''}>Silver</option>
          <option value="Platinum" ${metal === 'Platinum' ? 'selected' : ''}>Platinum</option>
        </select>
      </div>
      <div class="field"><label>Item type</label>
        <select id="b_itemtype"><option>Scrap</option><option>Jewelry</option></select>
      </div>
      <div class="field"><label>Karat / purity</label>
        <select id="b_karat" onchange="recalcBuying()">
          ${karats.length ? karats.map(k => `<option value="${k}" ${k === karat ? 'selected' : ''}>${esc(gradeLabel(metal, k))}</option>`).join('') : `<option value="">No rate set</option>`}
        </select>
        ${!karats.length ? `<span class="hint">Add a buying rate for ${metal} first.</span>` : ''}
      </div>
      <div class="field"><label>Gross weight (g)</label><input id="b_gross" type="number" min="0" step="0.01" value="${val('b_gross')}" oninput="recalcBuying()"></div>
      <div class="field"><label>Deductions (g)</label><input id="b_ded" type="number" min="0" step="0.01" value="${val('b_ded')}" oninput="recalcBuying()"></div>
        </div>

        <div class="payout-calculator">
          <div><span>Net weight</span><strong id="b_net_display">${fmtWeight(net)}</strong></div>
          <div><span id="b_rate_label">Buying rate (${Number(db.pricing.auto.payoutPct)}%)</span><strong id="b_rate_display">${rateObj ? fmtMoney(rate) + '/g' : 'No active rate'}</strong></div>
          <div class="suggested"><span>Calculated amount</span><strong id="b_suggested_display">${fmtMoney(suggested)}</strong></div>
          <div class="final-payout"><label for="b_payout">Final payout</label><div><span>₱</span><input id="b_payout" type="number" min="0" step="0.01" placeholder="${suggested.toFixed(2)}" oninput="togglePayoutOverride()"></div></div>
        </div>
        <div class="field override-reason is-hidden" id="b_override_field"><label>Why is the final payout different?</label><input id="b_override" placeholder="Enter a short reason"></div>

        <details class="buying-more">
          <summary>More details <span>optional</span></summary>
          <div class="form-grid buying-more-grid">
            <div class="field"><label>Staff member</label><input id="b_staff" placeholder="Name"></div>
            <div class="field"><label>Initial status</label><select id="b_status"><option>For Selling</option><option>For Refining</option><option>On Hold</option></select></div>
            <div class="field"><label>Remarks</label><textarea id="b_remarks" placeholder="Optional notes"></textarea></div>
          </div>
        </details>

        <div class="form-actions buying-add-action">
          <button class="btn" onclick="addPurchaseItem()">Add this item</button>
          <span class="form-note">You can add more items before paying.</span>
        </div>
      </div>
    </div>

    <div class="buying-step" id="buying_seller_step">
      <div class="step-number">2</div>
      <div class="step-content">
        <h2>Who is selling?</h2>
        <p>Enter the seller's name if available. The name can be left blank.</p>
        <div class="form-grid buying-customer-grid">
          <div class="field"><label>Seller name <span class="hint">(optional)</span></label><input id="b_seller_name" value="${esc(sellerName)}" placeholder="Enter name or leave blank" autocomplete="off"></div>
          <div class="field"><label>Purchase date</label><input id="b_date" type="date" value="${val('b_date') || todayStr()}"></div>
          <div class="field"><label>Payment method</label><select id="b_pay"><option>Cash</option><option>Bank transfer</option><option>GCash</option></select></div>
        </div>
      </div>
    </div>
  </section>

  <section class="block" id="purchase_batch_panel">${renderPurchaseBatchPanelMarkup()}</section>

  `;
}
function updateBuyingGrades() {
    const metal = val('b_metal'), select = document.getElementById('b_karat'), grades = distinctKarats(metal);
    select.innerHTML = grades.map(k => `<option value="${k}">${esc(gradeLabel(metal, k))}</option>`).join('');
    recalcBuying();
}
function recalcBuying() {
    const metal = val('b_metal'), karat = val('b_karat'), gross = parseFloat(val('b_gross')) || 0, ded = parseFloat(val('b_ded')) || 0;
    const net = Math.max(roundWeight(gross - ded), 0), rateObj = karat ? activeRate(metal, karat) : null, rate = rateObj ? rateObj.rate : 0;
    const netEl = document.getElementById('b_net_display'), rateEl = document.getElementById('b_rate_display'), rateLabel = document.getElementById('b_rate_label'), suggestedEl = document.getElementById('b_suggested_display'), payoutEl = document.getElementById('b_payout');
    if (netEl)
        netEl.textContent = fmtWeight(net);
    if (rateEl)
        rateEl.textContent = rateObj ? fmtMoney(rate) + '/g' : 'No active rate';
    if (rateLabel)
        rateLabel.textContent = `Buying rate (${Number(db.pricing.auto.payoutPct)}%)`;
    const suggested = roundMoney(net * rate);
    if (suggestedEl)
        suggestedEl.textContent = fmtMoney(suggested);
    if (payoutEl)
        payoutEl.placeholder = suggested.toFixed(2);
    togglePayoutOverride();
}
function togglePayoutOverride() {
    const payout = val('b_payout'), field = document.getElementById('b_override_field');
    if (!field)
        return;
    if (!payout) {
        field.classList.add('is-hidden');
        return;
    }
    const metal = val('b_metal'), karat = val('b_karat'), gross = parseFloat(val('b_gross')) || 0, ded = parseFloat(val('b_ded')) || 0;
    const active = karat ? activeRate(metal, karat) : null, suggested = roundMoney(Math.max(roundWeight(gross - ded), 0) * (active ? active.rate : 0));
    field.classList.toggle('is-hidden', Math.abs(parseFloat(payout) - suggested) < 0.005);
}
function purchaseItemFromForm() {
    const metal = val('b_metal'), karat = val('b_karat');
    if (!karat) {
        toast('Add a buying rate for this metal first');
        return null;
    }
    const gross = parseFloat(val('b_gross')) || 0, ded = parseFloat(val('b_ded')) || 0;
    const net = Math.max(roundWeight(gross - ded), 0);
    if (net <= 0) {
        toast('Enter a valid gross weight');
        return null;
    }
    const rateObj = activeRate(metal, karat);
    const rate = rateObj ? rateObj.rate : 0;
    const suggested = roundMoney(net * rate);
    const payoutInput = val('b_payout');
    const payout = payoutInput ? roundMoney(parseFloat(payoutInput)) : suggested;
    const overrideReason = (payout !== suggested) ? val('b_override').trim() : '';
    if (!Number.isFinite(payout) || payout < 0) {
        toast('Enter a valid final payout');
        return null;
    }
    if (payout !== suggested && !overrideReason) {
        toast('Enter an override reason — payout differs from suggested');
        return null;
    }
    return { id: uid('line'), metal, itemType: val('b_itemtype'), karat, grossWeight: gross, deductions: ded,
        netWeight: net, currentWeight: net, rate, suggestedAmount: suggested, payout, overrideReason };
}
function addPurchaseItem() {
    const item = purchaseItemFromForm();
    if (!item)
        return;
    purchaseBatch.push(item);
    ['b_gross', 'b_ded', 'b_payout', 'b_override'].forEach(id => { const e = document.getElementById(id); if (e)
        e.value = ''; });
    recalcBuying();
    renderPurchaseBatchPanel();
    openPurchaseNextStep(item);
}
function closePurchaseNextStep() { document.getElementById('purchase_next_step_modal')?.remove(); }
function continueAddingPurchaseItems() {
    closePurchaseNextStep();
    document.querySelector('.buying-workflow')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => document.getElementById('b_gross')?.focus(), 250);
}
function proceedPurchaseToPayout() { closePurchaseNextStep(); openPurchaseSummary(); }
function openPurchaseNextStep(item) {
    closePurchaseNextStep();
    const total = roundMoney(purchaseBatch.reduce((sum, line) => sum + Number(line.payout), 0));
    const totalWeight = purchaseBatch.reduce((sum, line) => sum + Number(line.netWeight), 0);
    const modal = document.createElement('div');
    modal.id = 'purchase_next_step_modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="summary-modal purchase-next-step-modal" role="dialog" aria-modal="true" aria-labelledby="purchase_next_step_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Item added</div><h2 id="purchase_next_step_title">${esc(item.metal)} ${esc(gradeLabel(item.metal, item.karat))} added</h2></div><button class="modal-close" onclick="closePurchaseNextStep()" aria-label="Close">×</button></div>
    <div class="purchase-added-item">
      <div><span>Item</span><strong>${esc(item.itemType)}</strong></div>
      <div><span>Net weight</span><strong>${fmtWeight(item.netWeight)}</strong></div>
      <div><span>Item payout</span><strong>${fmtMoney(item.payout)}</strong></div>
    </div>
    <div class="summary-grand"><div><span>${purchaseBatch.length} item${purchaseBatch.length === 1 ? '' : 's'} · ${fmtWeight(totalWeight)}</span><strong>Current payout</strong></div><div>${fmtMoney(total)}</div></div>
    <p class="purchase-next-question">Would you like to add another item for this seller or proceed to the payout?</p>
    <div class="purchase-next-actions"><button class="btn secondary" onclick="continueAddingPurchaseItems()">Add more items</button><button class="btn" onclick="proceedPurchaseToPayout()">Proceed to payout</button></div>
  </div>`;
    modal.addEventListener('click', event => { if (event.target === modal)
        closePurchaseNextStep(); });
    document.body.appendChild(modal);
    modal.querySelector('.purchase-next-actions .btn:last-child')?.focus();
}
let pendingPurchaseRemovalId = null;
function requestPurchaseItemRemoval(id) {
    const item = purchaseBatch.find(line => line.id === id);
    if (!item)
        return;
    pendingPurchaseRemovalId = id;
    closeAdminVerification();
    const modal = document.createElement('div');
    modal.id = 'admin_verification_modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<form class="summary-modal" onsubmit="verifyPurchaseItemRemoval(event)" role="dialog" aria-modal="true" aria-labelledby="admin_verification_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Protected action</div><h2 id="admin_verification_title">Admin verification</h2></div><button type="button" class="modal-close" onclick="closeAdminVerification()" aria-label="Close">×</button></div>
    <p class="form-note" style="margin:16px 0;">An administrator must approve removing <strong>${esc(item.metal)} ${esc(gradeLabel(item.metal, item.karat))}</strong> (${fmtWeight(item.netWeight)}) from the current payout.</p>
    <div class="form-grid">
      <div class="field"><label>Admin username</label><input id="verify_admin_username" autocomplete="username" value="${isAdmin() ? esc(currentUser.username) : ''}" required></div>
      <div class="field"><label>Admin password</label><input id="verify_admin_password" type="password" autocomplete="current-password" required></div>
    </div>
    <div class="form-note" id="admin_verification_error" style="color:var(--rust);min-height:18px;margin-top:10px;"></div>
    <div class="form-actions"><button type="button" class="btn secondary" onclick="closeAdminVerification()">Keep item</button><button type="submit" class="btn">Verify &amp; remove</button></div>
  </form>`;
    modal.addEventListener('click', event => { if (event.target === modal)
        closeAdminVerification(); });
    document.body.appendChild(modal);
    document.getElementById('verify_admin_password')?.focus();
}
function closeAdminVerification() { document.getElementById('admin_verification_modal')?.remove(); pendingPurchaseRemovalId = null; }
async function verifyPurchaseItemRemoval(event) {
    event.preventDefault();
    const itemId = pendingPurchaseRemovalId, errorEl = document.getElementById('admin_verification_error');
    if (!itemId)
        return;
    if (errorEl)
        errorEl.textContent = 'Verifying administrator…';
    try {
        const response = await fetch('/api/admin/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: val('verify_admin_username'), password: val('verify_admin_password') }) });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || 'Administrator verification failed');
        purchaseBatch = purchaseBatch.filter(item => item.id !== itemId);
        closeAdminVerification();
        renderPurchaseBatchPanel();
        toast(`Item removed with approval from ${result.admin.displayName}`);
    }
    catch (error) {
        if (errorEl)
            errorEl.textContent = error.message || 'Administrator verification failed';
    }
}
function renderPurchaseBatchPanel() {
    const panel = document.getElementById('purchase_batch_panel');
    if (panel)
        panel.innerHTML = renderPurchaseBatchPanelMarkup();
}
function renderPurchaseBatchPanelMarkup() {
    const total = roundMoney(purchaseBatch.reduce((sum, item) => sum + Number(item.payout), 0));
    if (!purchaseBatch.length)
        return `<h2 class="block-title">Current payout</h2><div class="empty-note">Start by adding an item above. You can review the combined total before choosing the seller.</div>`;
    return `<div class="current-payout-compact"><div><span>Current payout · ${purchaseBatch.length} item${purchaseBatch.length === 1 ? '' : 's'}</span><strong>${fmtMoney(total)}</strong></div><div class="form-actions"><button class="btn secondary" onclick="continueAddingPurchaseItems()">Add another item</button><button class="btn" onclick="openPurchaseSummary()">Proceed to payout</button></div></div>
    <details class="purchase-batch-details"><summary>View or remove ${purchaseBatch.length} item${purchaseBatch.length === 1 ? '' : 's'}</summary><div class="table-wrap"><table class="purchase-batch-table"><thead><tr><th>Item</th><th>Metal / grade</th><th class="num-col">Net weight</th><th class="num-col">Rate</th><th class="num-col">Payout</th><th></th></tr></thead><tbody>
    ${purchaseBatch.map((item, index) => `<tr><td>${index + 1}</td><td><span class="metal-tag ${item.metal.toLowerCase()}">${item.metal}</span> ${esc(gradeLabel(item.metal, item.karat))} · ${esc(item.itemType)}</td><td class="num">${fmtWeight(item.netWeight)}</td><td class="num">${fmtMoney(item.rate)}/g</td><td class="num">${fmtMoney(item.payout)}</td><td><button class="btn secondary small" onclick="requestPurchaseItemRemoval('${item.id}')">Remove</button></td></tr>`).join('')}
    </tbody></table></div></details>`;
}
function purchaseCustomer() {
    const name = val('b_seller_name').trim();
    if (!name)
        return { id: '', name: '', isNew: false };
    const existing = db.customers.find(customer => customer.name.trim().toLowerCase() === name.toLowerCase());
    if (existing)
        return { id: existing.id, name, isNew: false };
    return { id: '', name, isNew: true };
}
function focusPurchaseSeller() {
    closePurchaseSummary();
    document.getElementById('buying_seller_step')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => document.getElementById('b_seller_name')?.focus(), 250);
}
function openPurchaseSummary() {
    if (!purchaseBatch.length) {
        toast('Add at least one item');
        return;
    }
    const customer = purchaseCustomer();
    closePurchaseSummary();
    const total = roundMoney(purchaseBatch.reduce((sum, item) => sum + Number(item.payout), 0));
    const totalWeight = purchaseBatch.reduce((sum, item) => sum + Number(item.netWeight), 0);
    const modal = document.createElement('div');
    modal.id = 'purchase_summary_modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="summary-modal" role="dialog" aria-modal="true" aria-labelledby="purchase_summary_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Combined payout</div><h2 id="purchase_summary_title">${customer.name ? esc(customer.name) : 'Walk-in seller'}</h2></div><button class="modal-close" onclick="closePurchaseSummary()" aria-label="Close">×</button></div>
    <div class="summary-lines">${purchaseBatch.map((item, index) => `<div class="summary-line"><div><strong>${index + 1}. ${esc(item.metal)} ${esc(gradeLabel(item.metal, item.karat))}</strong><span>${esc(item.itemType)} · ${fmtWeight(item.netWeight)} × ${fmtMoney(item.rate)}/g</span></div><strong>${fmtMoney(item.payout)}</strong></div>`).join('')}</div>
    <div class="summary-grand"><div><span>${purchaseBatch.length} item${purchaseBatch.length === 1 ? '' : 's'} · ${fmtWeight(totalWeight)}</span><strong>Grand total</strong></div><div>${fmtMoney(total)}</div></div>
    <div class="summary-meta">Seller: ${customer.name ? esc(customer.name) : '<strong>Not provided</strong>'} · ${fmtDate(val('b_date') || todayStr())} · ${esc(val('b_pay'))}${val('b_staff').trim() ? ` · Staff: ${esc(val('b_staff').trim())}` : ''}</div>
    <div class="form-actions"><button class="btn secondary" onclick="closePurchaseSummary()">Back to items</button><button class="btn secondary" onclick="commitPurchaseBatch(false)">Record only</button><button class="btn" onclick="commitPurchaseBatch(true)">Confirm &amp; view receipt</button></div>
  </div>`;
    modal.addEventListener('click', event => { if (event.target === modal)
        closePurchaseSummary(); });
    document.body.appendChild(modal);
}
function closePurchaseSummary() { document.getElementById('purchase_summary_modal')?.remove(); }
async function commitPurchaseBatch(printAfter = false) {
    if (!purchaseBatch.length)
        return;
    const customer = purchaseCustomer();
    let customerId = customer.id;
    if (customer.isNew) {
        customerId = uid('cust');
        db.customers.push({ id: customerId, name: customer.name, contact: '', notes: '' });
    }
    const batchId = uid('buy');
    const shared = { date: val('b_date') || todayStr(), customerId, customerName: customer.name, paymentMethod: val('b_pay'), staff: val('b_staff').trim(),
        status: val('b_status'), remarks: val('b_remarks').trim(), batchId };
    purchaseBatch.forEach(item => db.stock.push({ ...item, ...shared, id: uid('stk'), cost: item.payout }));
    const count = purchaseBatch.length, total = roundMoney(purchaseBatch.reduce((sum, item) => sum + Number(item.payout), 0));
    purchaseBatch = [];
    closePurchaseSummary();
    await saveDB();
    render();
    if (printAfter)
        openPurchaseReceipt(batchId);
    toast(`${count} items recorded · ${fmtMoney(total)}`);
}
function receiptNumber(value) {
    return Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function purchaseReceiptMarkup(items) {
    const first = items[0], total = roundMoney(items.reduce((sum, item) => sum + Number(item.payout), 0));
    const itemLines = items.map(item => `<div class="receipt-item"><div class="receipt-item-name">${esc(item.metal)} ${esc(gradeLabel(item.metal, item.karat))} · ${esc(item.itemType)}</div><div class="receipt-calc">${receiptNumber(item.netWeight)}g × ${receiptNumber(item.rate)} = ${receiptNumber(item.payout)}</div></div>`).join('');
    return `<header><div class="receipt-shop">ZP GOLD &amp; SILVER</div><div class="receipt-address">Barcelona St, Zone II<br>Zamboanga City</div></header><div class="receipt-rule"></div>
    <div class="receipt-meta"><span>Date:</span><strong>${esc(fmtDate(first.date))}</strong><span>Client:</span><strong>${esc(first.customerName || 'Walk-in')}</strong></div><div class="receipt-rule"></div>
    ${itemLines}<div class="receipt-total"><span>TOTAL</span><span>PHP ${receiptNumber(total)}</span></div><div class="receipt-rule"></div>
    <div class="receipt-meta"><span>Paid:</span><strong>${esc(first.paymentMethod || '—')}</strong>${first.staff ? `<span>Staff:</span><strong>${esc(first.staff)}</strong>` : ''}</div>
    <div class="receipt-reference">Ref: ${esc(first.batchId || first.id)}</div><div class="receipt-thanks">Thank you.</div>
    <footer class="receipt-quote">“Because gold is honest money it is disliked by dishonest men.”</footer>`;
}
function cleanupThermalPrintState() {
    document.body.classList.remove('printing-thermal-receipt');
    document.getElementById('thermal_print_page_style')?.remove();
}
function closePurchaseReceipt() { cleanupThermalPrintState(); document.getElementById('purchase_receipt_modal')?.remove(); }
function setReceiptPaperSize(value) {
    const receipt = document.getElementById('receipt_preview_paper');
    receipt?.classList.toggle('paper-80', String(value) === '80');
}
function openPurchaseReceipt(batchId) {
    const items = db.stock.filter(item => (item.batchId || item.id) === batchId);
    if (!items.length) {
        toast('Receipt record not found');
        return;
    }
    closePurchaseReceipt();
    const modal = document.createElement('div');
    modal.id = 'purchase_receipt_modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="receipt-preview-modal" role="dialog" aria-modal="true" aria-labelledby="receipt_preview_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Thermal receipt preview</div><h2 id="receipt_preview_title">Buying receipt</h2></div><button class="modal-close" onclick="closePurchaseReceipt()" aria-label="Close">×</button></div>
    <div class="receipt-preview-stage"><div class="thermal-receipt" id="receipt_preview_paper">${purchaseReceiptMarkup(items)}</div></div>
    <div class="receipt-preview-controls"><div class="field"><label for="receipt_paper_size">Thermal paper width</label><select id="receipt_paper_size" onchange="setReceiptPaperSize(this.value)"><option value="58">58 mm</option><option value="80">80 mm</option></select></div>
    <div class="form-actions"><button class="btn secondary" onclick="closePurchaseReceipt()">Close</button><button class="btn" onclick="printPurchaseReceipt('${batchId}')">Print receipt</button></div></div>
  </div>`;
    modal.addEventListener('click', event => { if (event.target === modal)
        closePurchaseReceipt(); });
    document.body.appendChild(modal);
}
function printPurchaseReceipt(batchId) {
    const items = db.stock.filter(item => (item.batchId || item.id) === batchId);
    if (!items.length) {
        toast('Receipt record not found');
        return;
    }
    const paperWidth = Number(val('receipt_paper_size')) === 80 ? 80 : 58;
    document.getElementById('thermal_print_page_style')?.remove();
    const pageStyle = document.createElement('style');
    pageStyle.id = 'thermal_print_page_style';
    pageStyle.textContent = `@page{size:${paperWidth}mm auto;margin:2mm}`;
    document.head.appendChild(pageStyle);
    document.body.classList.add('printing-thermal-receipt');
    window.addEventListener('afterprint', cleanupThermalPrintState, { once: true });
    window.print();
}
/* ============================= INVENTORY ============================= */
let invFilter = { metal: 'All', karat: 'All', type: 'All', status: 'All' };
let inventoryWeekOffset = 0;
let inventorySelectedDate = todayStr();
const inventoryMoveSelection = new Set();
const liquidationSelection = new Set();
const liquidationDraft = new Map();
let liquidationTotalSoldDraft = '';
let pendingInventoryMove = null;
let combineLiquidationMetal = '';
const combineLiquidationDates = new Set();
function inventoryWeekRange(offset = inventoryWeekOffset) {
    const today = new Date(todayStr() + 'T00:00:00');
    const mondayIndex = (today.getDay() + 6) % 7;
    const start = new Date(today);
    start.setDate(today.getDate() - mondayIndex + (offset * 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const asKey = date => { const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 10); };
    return { start: asKey(start), end: asKey(end) };
}
function clearInventoryLiquidationSelection() { inventoryMoveSelection.clear(); }
function dateKeyPlusDays(dateKey, days) {
    const date = new Date(dateKey + 'T00:00:00');
    date.setDate(date.getDate() + days);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}
function changeInventoryWeek(delta) {
    inventoryWeekOffset += delta;
    inventorySelectedDate = inventoryWeekRange().start;
    render();
}
function selectInventoryDate(date) {
    inventorySelectedDate = date;
    render();
    requestAnimationFrame(() => openInventoryFilterModal());
}
function closeInventoryFilterModal() { document.getElementById('inventory_filter_modal')?.remove(); }
function inventoryFilterKaratsForDate(metal) {
    return Array.from(new Set(db.stock.filter(item => item.date === inventorySelectedDate && (metal === 'All' || item.metal === metal)).map(item => item.karat)));
}
function updateInventoryFilterModalKarats() {
    const metal = val('modal_inv_metal'), select = document.getElementById('modal_inv_karat');
    if (!select)
        return;
    const current = select.value || invFilter.karat, karats = inventoryFilterKaratsForDate(metal);
    select.innerHTML = `<option value="All">All purities</option>${karats.map(karat => `<option value="${esc(karat)}">${esc(karat)}</option>`).join('')}`;
    select.value = karats.includes(current) ? current : 'All';
}
function openInventoryFilterModal() {
    closeInventoryFilterModal();
    const dayStock = db.stock.filter(item => item.date === inventorySelectedDate);
    const available = dayStock.filter(selectableInventory);
    const karats = inventoryFilterKaratsForDate(invFilter.metal);
    const modal = document.createElement('div');
    modal.id = 'inventory_filter_modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="summary-modal inventory-filter-modal" role="dialog" aria-modal="true" aria-labelledby="inventory_filter_title">
    <div class="summary-modal-head"><div><div class="eyebrow">${new Date(inventorySelectedDate + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long' })} · ${fmtDate(inventorySelectedDate)}</div><h2 id="inventory_filter_title">Filter this day's stock</h2></div><button class="modal-close" onclick="closeInventoryFilterModal()" aria-label="Close">×</button></div>
    <p class="move-confirmation-intro">This date has <strong>${dayStock.length} stock record${dayStock.length === 1 ? '' : 's'}</strong>, with <strong>${available.length} currently available</strong>. Choose what you want to see.</p>
    <div class="form-grid inventory-filter-modal-grid">
      <div class="field"><label for="modal_inv_metal">Metal</label><select id="modal_inv_metal" onchange="updateInventoryFilterModalKarats()">${['All', 'Gold', 'Silver', 'Platinum'].map(metal => `<option value="${metal}" ${invFilter.metal === metal ? 'selected' : ''}>${metal === 'All' ? 'All metals' : metal}</option>`).join('')}</select></div>
      <div class="field"><label for="modal_inv_karat">Karat / purity</label><select id="modal_inv_karat"><option value="All">All purities</option>${karats.map(karat => `<option value="${esc(karat)}" ${invFilter.karat === karat ? 'selected' : ''}>${esc(karat)}</option>`).join('')}</select></div>
      <div class="field"><label for="modal_inv_type">Item type</label><select id="modal_inv_type">${['All', 'Jewelry', 'Scrap'].map(type => `<option value="${type}" ${invFilter.type === type ? 'selected' : ''}>${type === 'All' ? 'All item types' : type}</option>`).join('')}</select></div>
      <div class="field"><label for="modal_inv_status">Status</label><select id="modal_inv_status">${['All', 'For Selling', 'For Refining', 'On Hold', 'Liquidated', 'Refined', 'Sold'].map(status => `<option value="${status}" ${invFilter.status === status ? 'selected' : ''}>${status === 'All' ? 'All statuses' : status}</option>`).join('')}</select></div>
    </div>
    <div class="inventory-filter-help"><strong>Tip:</strong> Choose “All” to include every record from ${fmtDate(inventorySelectedDate)}.</div>
    <div class="form-actions inventory-filter-modal-actions"><button class="btn secondary" onclick="showAllInventoryForSelectedDate()">Show all stock</button><button class="btn" onclick="applyInventoryDateFilters()">Apply filters</button></div>
  </div>`;
    modal.addEventListener('click', event => { if (event.target === modal)
        closeInventoryFilterModal(); });
    document.body.appendChild(modal);
}
function finishInventoryDateFilter() {
    closeInventoryFilterModal();
    render();
    requestAnimationFrame(() => document.getElementById('inventory_stock_list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
function showAllInventoryForSelectedDate() {
    invFilter = { metal: 'All', karat: 'All', type: 'All', status: 'All' };
    finishInventoryDateFilter();
}
function applyInventoryDateFilters() {
    invFilter = { metal: val('modal_inv_metal'), karat: val('modal_inv_karat'), type: val('modal_inv_type'), status: val('modal_inv_status') };
    finishInventoryDateFilter();
}
function selectableInventory(item) { return Number(item.currentWeight) > 0 && (item.status === 'For Selling' || item.status === 'For Refining'); }
function movableInventory(item) { return selectableInventory(item) && !liquidationSelection.has(item.id); }
function selectedInventoryForMove() { return db.stock.filter(item => inventoryMoveSelection.has(item.id) && movableInventory(item)); }
function selectedInventoryForLiquidation() { return db.stock.filter(item => liquidationSelection.has(item.id) && selectableInventory(item)); }
function inventoryPercentagePool() {
    return db.stock.filter(item => item.date === inventorySelectedDate && movableInventory(item) &&
        (invFilter.metal === 'All' || item.metal === invFilter.metal) &&
        (invFilter.karat === 'All' || item.karat === invFilter.karat) &&
        (invFilter.type === 'All' || item.itemType === invFilter.type) &&
        (invFilter.status === 'All' || item.status === invFilter.status));
}
function percentageStockCount(percentage, total) { return total ? Math.max(1, Math.ceil(total * (Number(percentage) / 100))) : 0; }
function toggleInventoryForLiquidation(id, checked) {
    const item = db.stock.find(stock => stock.id === id);
    if (!item || !movableInventory(item))
        return;
    if (checked)
        inventoryMoveSelection.add(id);
    else
        inventoryMoveSelection.delete(id);
    const selected = selectedInventoryForMove();
    const buttons = document.querySelectorAll('.inventory-move-liquidation');
    const count = document.getElementById('inventory_liq_count');
    buttons.forEach(button => button.disabled = !inventoryPercentagePool().length);
    if (count)
        count.textContent = String(selected.length);
}
function syncInventoryMoveCheckboxes() {
    document.querySelectorAll('[data-inventory-move-id]').forEach(input => {
        input.checked = inventoryMoveSelection.has(input.dataset.inventoryMoveId);
    });
    const count = document.getElementById('inventory_liq_count');
    if (count)
        count.textContent = String(selectedInventoryForMove().length);
}
function closeInventoryMoveConfirmation() {
    document.getElementById('inventory_move_confirmation')?.remove();
    pendingInventoryMove = null;
}
function moveInventorySelectionToLiquidation(percentage) {
    const portion = Number(percentage);
    if (![50, 100].includes(portion)) {
        toast('Choose Move 50% or Move 100%');
        return;
    }
    const pool = inventoryPercentagePool();
    const required = percentageStockCount(portion, pool.length);
    if (!pool.length) {
        toast('There are no eligible stock records for this date and filter');
        return;
    }
    inventoryMoveSelection.clear();
    pool.slice(0, required).forEach(item => inventoryMoveSelection.add(item.id));
    const selected = selectedInventoryForMove();
    if (selected.length !== required) {
        toast('The requested stock records are no longer available. Refresh Inventory and try again.');
        return;
    }
    if (selected.some(item => !pool.some(poolItem => poolItem.id === item.id))) {
        toast('All selected records must belong to the displayed date and filter');
        return;
    }
    syncInventoryMoveCheckboxes();
    requestAnimationFrame(() => requestAnimationFrame(() => openInventoryMoveReview(selected, { percentage: portion, total: pool.length, automatic: true })));
}
function moveCheckedInventoryToLiquidation() {
    const selected = selectedInventoryForMove();
    if (!selected.length) {
        toast('Check at least one inventory record first');
        return;
    }
    openInventoryMoveReview(selected, { total: selected.length, automatic: false });
}
function availableCombineDates(metal) {
    const groups = new Map();
    db.stock.filter(item => movableInventory(item) && item.metal === metal).forEach(item => {
        const group = groups.get(item.date) || { date: item.date, count: 0, weight: 0, cost: 0 };
        group.count += 1;
        group.weight += Number(item.currentWeight);
        group.cost += Number(item.cost);
        groups.set(item.date, group);
    });
    return Array.from(groups.values()).sort((a, b) => b.date.localeCompare(a.date));
}
function closeCombineLiquidationDateSelection() {
    document.getElementById('combine_liquidation_dates')?.remove();
    combineLiquidationDates.clear();
}
function toggleCombineLiquidationDate(date, checked) {
    if (checked)
        combineLiquidationDates.add(date);
    else
        combineLiquidationDates.delete(date);
    renderCombineLiquidationDateChoices();
}
function changeCombineLiquidationMetal(metal) {
    combineLiquidationMetal = metal;
    combineLiquidationDates.clear();
    const choices = availableCombineDates(metal);
    if (choices.some(choice => choice.date === inventorySelectedDate))
        combineLiquidationDates.add(inventorySelectedDate);
    renderCombineLiquidationDateChoices();
}
function renderCombineLiquidationDateChoices() {
    const container = document.getElementById('combine_liquidation_date_choices');
    if (!container)
        return;
    const choices = availableCombineDates(combineLiquidationMetal);
    const chosen = choices.filter(choice => combineLiquidationDates.has(choice.date));
    const count = chosen.reduce((sum, choice) => sum + choice.count, 0);
    const weight = chosen.reduce((sum, choice) => sum + choice.weight, 0);
    container.innerHTML = `
    <div class="combine-date-list">
      ${choices.map(choice => `<label class="combine-date-option ${combineLiquidationDates.has(choice.date) ? 'selected' : ''}">
        <input type="checkbox" ${combineLiquidationDates.has(choice.date) ? 'checked' : ''} onchange="toggleCombineLiquidationDate('${choice.date}',this.checked)">
        <span><strong>${new Date(choice.date + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long' })}</strong><small>${fmtDate(choice.date)}</small></span>
        <span class="num"><strong>${choice.count} record${choice.count === 1 ? '' : 's'}</strong><small>${fmtWeight(choice.weight)} · ${fmtMoney(choice.cost)}</small></span>
      </label>`).join('') || '<div class="empty-note">No eligible inventory dates are available for this metal.</div>'}
    </div>
    <div class="move-confirmation-summary combine-date-summary">
      <div><span>Dates selected</span><strong>${chosen.length}</strong></div>
      <div><span>Stock records</span><strong>${count}</strong></div>
      <div><span>Total weight</span><strong>${fmtWeight(weight)}</strong></div>
    </div>`;
    const button = document.getElementById('confirm_combine_dates');
    if (button)
        button.disabled = !chosen.length;
}
function openCombineLiquidationDateSelection() {
    const available = db.stock.filter(movableInventory);
    if (!available.length) {
        toast('There are no eligible inventory records to combine');
        return;
    }
    const selected = selectedInventoryForMove();
    const selectedMetals = Array.from(new Set(selected.map(item => item.metal)));
    const metals = Array.from(new Set(available.map(item => item.metal)));
    combineLiquidationMetal = selectedMetals.length === 1 ? selectedMetals[0] : (invFilter.metal !== 'All' && metals.includes(invFilter.metal) ? invFilter.metal : metals[0]);
    combineLiquidationDates.clear();
    selected.filter(item => item.metal === combineLiquidationMetal).forEach(item => combineLiquidationDates.add(item.date));
    const choices = availableCombineDates(combineLiquidationMetal);
    if (!combineLiquidationDates.size) {
        if (choices.some(choice => choice.date === inventorySelectedDate))
            combineLiquidationDates.add(inventorySelectedDate);
        else if (choices[0])
            combineLiquidationDates.add(choices[0].date);
    }
    const modal = document.createElement('div');
    modal.id = 'combine_liquidation_dates';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="inventory-move-modal combine-date-modal" role="dialog" aria-modal="true" aria-labelledby="combine_liquidation_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Combine for liquidation</div><h2 id="combine_liquidation_title">Select purchase dates</h2></div><button class="modal-close" onclick="closeCombineLiquidationDateSelection()" aria-label="Close">×</button></div>
    <p class="move-confirmation-intro">Choose one or more dates. The system will automatically select every available stock record for the chosen metal on those dates and combine them into one liquidation batch.</p>
    <div class="field combine-metal-field"><label for="combine_liquidation_metal">Metal</label><select id="combine_liquidation_metal" onchange="changeCombineLiquidationMetal(this.value)">${metals.map(metal => `<option value="${esc(metal)}" ${metal === combineLiquidationMetal ? 'selected' : ''}>${esc(metal)}</option>`).join('')}</select></div>
    <div id="combine_liquidation_date_choices"></div>
    <div class="move-confirmation-note"><strong>Nothing is sold yet.</strong><span>You can review every automatically selected item before moving the batch to Selective Liquidation.</span></div>
    <div class="form-actions"><button class="btn secondary" onclick="closeCombineLiquidationDateSelection()">Cancel</button><button class="btn" id="confirm_combine_dates" onclick="confirmCombineLiquidationDates()">Review selected dates</button></div>
  </div>`;
    modal.addEventListener('click', event => { if (event.target === modal)
        closeCombineLiquidationDateSelection(); });
    document.body.appendChild(modal);
    renderCombineLiquidationDateChoices();
}
function confirmCombineLiquidationDates() {
    const dates = new Set(combineLiquidationDates);
    if (!dates.size) {
        toast('Select at least one purchase date');
        return;
    }
    const selected = db.stock.filter(item => movableInventory(item) && item.metal === combineLiquidationMetal && dates.has(item.date));
    if (!selected.length) {
        toast('The chosen dates no longer have eligible stock records');
        return;
    }
    inventoryMoveSelection.clear();
    selected.forEach(item => inventoryMoveSelection.add(item.id));
    closeCombineLiquidationDateSelection();
    openInventoryMoveReview(selected, { total: selected.length, automatic: true, combineDates: true });
}
function liquidateInventoryItem(id) {
    const item = db.stock.find(stock => stock.id === id);
    if (!item || !movableInventory(item)) {
        toast('This inventory item is no longer available');
        return;
    }
    inventoryMoveSelection.clear();
    inventoryMoveSelection.add(id);
    openInventoryMoveReview([item], { total: 1, automatic: false, individual: true });
}
function openInventoryMoveReview(selected, context) {
    const metals = Array.from(new Set(selected.map(item => item.metal)));
    if (metals.length !== 1) {
        toast('Choose only one metal at a time. Gold, silver, and platinum use separate liquidation batches.');
        return;
    }
    const dates = Array.from(new Set(selected.map(item => item.date))).sort();
    const dateLabel = dates.length === 1 ? fmtDate(dates[0]) : `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`;
    const selectionLabel = context.individual ? 'Individual item' : context.automatic ? `${context.percentage}% · ${selected.length} of ${context.total}` : `${selected.length} selected record${selected.length === 1 ? '' : 's'}`;
    const mode = context.individual ? 'individual' : dates.length > 1 ? 'combined' : 'selected';
    pendingInventoryMove = { percentage: context.percentage ?? null, total: context.total, ids: selected.map(item => item.id), dates, metal: metals[0], mode };
    const totalWeight = selected.reduce((sum, item) => sum + Number(item.currentWeight), 0);
    const totalCost = selected.reduce((sum, item) => sum + Number(item.cost), 0);
    const modal = document.createElement('div');
    modal.id = 'inventory_move_confirmation';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="inventory-move-modal" role="dialog" aria-modal="true" aria-labelledby="inventory_move_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Review inventory movement</div><h2 id="inventory_move_title">Move ${selected.length} stock record${selected.length === 1 ? '' : 's'}?</h2></div><button class="modal-close" onclick="closeInventoryMoveConfirmation()" aria-label="Close">×</button></div>
    <p class="move-confirmation-intro">${context.combineDates ? `The system automatically selected every eligible ${esc(metals[0])} stock record from the ${dates.length} chosen purchase date${dates.length === 1 ? '' : 's'}.` : context.automatic ? `The system automatically selected ${selected.length} eligible stock record${selected.length === 1 ? '' : 's'} for this percentage.` : context.individual ? 'This item will be prepared as an individual liquidation.' : dates.length > 1 ? 'Items from different purchase dates will be combined into one liquidation batch.' : 'The checked records will be combined into one liquidation batch.'} Review the items below before confirming. This step does not sell the stock or deduct its weight.</p>
    <div class="move-confirmation-summary">
      <div><span>Purchase date${dates.length === 1 ? '' : 's'}</span><strong>${dateLabel}</strong></div>
      <div><span>Selection</span><strong>${selectionLabel}</strong></div>
      <div><span>Total weight</span><strong>${fmtWeight(totalWeight)}</strong></div>
      <div><span>Inventory cost</span><strong>${fmtMoney(totalCost)}</strong></div>
    </div>
    <div class="table-wrap move-confirmation-items"><table><thead><tr><th>Inventory item</th><th>Customer</th><th>Status</th><th>Weight moving</th><th>Cost</th></tr></thead><tbody>
      ${selected.map(item => `<tr><td><strong>${esc(item.metal)} ${esc(item.karat)}</strong><br><span class="form-note">${esc(item.itemType)}${item.remarks ? ' · ' + esc(item.remarks) : ''}</span></td><td>${esc(item.customerName || '—')}</td><td>${statusPill(item.status)}</td><td class="num"><strong>${fmtWeight(item.currentWeight)}</strong><br><span class="form-note">full available weight</span></td><td class="num">${fmtMoney(item.cost)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="move-confirmation-note"><strong>What happens next?</strong><span>These records will appear in Selective Liquidation as one batch. Enter one total PHP sold amount, then confirm the final liquidation.</span></div>
    <div class="form-actions"><button class="btn secondary" onclick="closeInventoryMoveConfirmation()">Cancel</button><button class="btn" onclick="confirmInventoryMoveToLiquidation()">Confirm &amp; open liquidation</button></div>
  </div>`;
    modal.addEventListener('click', event => { if (event.target === modal)
        closeInventoryMoveConfirmation(); });
    document.body.appendChild(modal);
    modal.querySelector('.btn:last-child')?.focus();
}
function confirmInventoryMoveToLiquidation() {
    const pending = pendingInventoryMove;
    if (!pending) {
        closeInventoryMoveConfirmation();
        return;
    }
    const selected = pending.ids.map(id => db.stock.find(item => item.id === id)).filter(item => item && selectableInventory(item));
    if (selected.length !== pending.ids.length) {
        closeInventoryMoveConfirmation();
        toast('One or more selected records are no longer available. Review the inventory again.');
        render();
        return;
    }
    liqMetal = pending.metal;
    liqKarat = 'All';
    liqStatus = 'All';
    selected.forEach(item => {
        liquidationSelection.add(item.id);
        liquidationDraft.set(item.id, { weight: Number(item.currentWeight).toFixed(2) });
    });
    const message = pending.mode === 'individual' ? '1 item prepared for individual liquidation' : pending.mode === 'combined' ? `${selected.length} records from ${pending.dates.length} dates combined for liquidation` : pending.percentage ? `${pending.percentage}% of the stock records prepared: ${selected.length} of ${pending.total}` : `${selected.length} records prepared for liquidation`;
    inventoryMoveSelection.clear();
    closeInventoryMoveConfirmation();
    goTab('liquidation');
    toast(message);
}
function renderInventory() {
    const week = inventoryWeekRange();
    if (inventorySelectedDate < week.start || inventorySelectedDate > week.end)
        inventorySelectedDate = week.start;
    const dates = Array.from({ length: 7 }, (_, index) => dateKeyPlusDays(week.start, index));
    const dailyRows = dates.map(date => {
        const stock = db.stock.filter(item => item.date === date), available = stock.filter(selectableInventory);
        return { date, stock, available, weight: available.reduce((sum, item) => sum + Number(item.currentWeight), 0), cost: available.reduce((sum, item) => sum + Number(item.cost), 0) };
    });
    const selectedDay = dailyRows.find(day => day.date === inventorySelectedDate) || dailyRows[0];
    const percentagePool = inventoryPercentagePool();
    const selectedMoveCount = selectedInventoryForMove().length;
    const hasMovableStock = db.stock.some(movableInventory);
    const activeFilterLabels = [invFilter.metal, invFilter.karat, invFilter.type, invFilter.status].filter(value => value !== 'All');
    const rows = selectedDay.stock.filter(s => (invFilter.metal === 'All' || s.metal === invFilter.metal) &&
        (invFilter.karat === 'All' || s.karat === invFilter.karat) &&
        (invFilter.type === 'All' || s.itemType === invFilter.type) &&
        (invFilter.status === 'All' || s.status === invFilter.status)).sort((a, b) => b.date.localeCompare(a.date));
    const groups = {};
    selectedDay.available.forEach(s => {
        if (s.currentWeight <= 0 || s.status === 'Sold' || s.status === 'Liquidated')
            return;
        const key = [s.metal, s.karat, s.itemType, s.status].join(' · ');
        groups[key] = groups[key] || { weight: 0, cost: 0 };
        groups[key].weight += Number(s.currentWeight);
        groups[key].cost += Number(s.cost);
    });
    return `
  <section class="block">
    <div class="page-head" style="margin-bottom:14px;"><div><p class="eyebrow">Monday through Sunday</p><h2 class="block-title" style="margin:0;">Inventory by purchase date</h2><p class="form-note">Choose a dated day to see and select its stock.</p></div><div class="form-actions" style="margin:0;"><button class="btn secondary small" onclick="changeInventoryWeek(-1)">Previous Monday–Sunday</button><button class="btn secondary small" onclick="changeInventoryWeek(1)">Next Monday–Sunday</button></div></div>
    <div class="inventory-days">
      ${dailyRows.map(day => `<button class="inventory-day ${day.date === inventorySelectedDate ? 'active' : ''}" onclick="selectInventoryDate('${day.date}')"><strong>${new Date(day.date + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long' })}</strong><span>${fmtDate(day.date)}</span><small>${day.stock.length} record${day.stock.length === 1 ? '' : 's'}<br>${fmtWeight(day.weight)} available</small></button>`).join('')}
    </div>
    <h2 class="block-title">${new Date(selectedDay.date + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long' })}, ${fmtDate(selectedDay.date)}</h2>
    <div class="stat-row">
      <div class="stat"><div class="label">Purchases recorded</div><div class="value">${selectedDay.stock.length}</div><div class="sub">inventory lines received on this date</div></div>
      <div class="stat"><div class="label">Available stock lines</div><div class="value">${selectedDay.available.length}</div><div class="sub">eligible for selling or refining</div></div>
      <div class="stat"><div class="label">Available weight</div><div class="value">${fmtWeight(selectedDay.weight)}</div><div class="sub">remaining from this date's purchases</div></div>
      <div class="stat"><div class="label">Remaining cost</div><div class="value">${fmtMoney(selectedDay.cost)}</div><div class="sub">carrying cost for this purchase date</div></div>
    </div>
    <h2 class="block-title" style="margin-top:20px;">Stock by metal, assay, type &amp; status</h2>
    <div class="stat-row">
      ${Object.keys(groups).length ? Object.entries(groups).map(([k, v]) => `<div class="stat"><div class="label">${k}</div><div class="value">${fmtWeight(v.weight)}</div><div class="sub">${fmtMoney(v.cost)} cost</div></div>`).join('')
        : `<div class="empty-note" style="flex:1;">No available inventory was purchased on ${fmtDate(selectedDay.date)}.</div>`}
    </div>
  </section>

  <section class="block" id="inventory_stock_list">
    <div class="inventory-stock-head"><div><h2 class="block-title">Stock records</h2><p class="form-note">${activeFilterLabels.length ? `Showing: ${activeFilterLabels.map(esc).join(' · ')}` : 'Showing all records'} for ${fmtDate(selectedDay.date)}.</p></div><button class="btn secondary small" onclick="openInventoryFilterModal()">Change filters</button></div>
    ${isAdmin() ? `<div class="inventory-action-panel"><div class="inventory-action-status"><strong>${percentagePool.length} eligible on this date</strong><span><span id="inventory_liq_count">${selectedMoveCount}</span> checked across dates${percentagePool.length ? '' : ' · choose another date or change filters'}</span></div><div class="inventory-action-buttons">${[50, 100].map(percent => `<button class="btn ${percent === 100 ? '' : 'secondary'} small inventory-move-liquidation" onclick="moveInventorySelectionToLiquidation(${percent})" ${percentagePool.length ? '' : 'disabled'}>Move ${percent}% (${percentageStockCount(percent, percentagePool.length)})</button>`).join('')}<button class="btn secondary small" onclick="moveCheckedInventoryToLiquidation()" ${selectedMoveCount ? '' : 'disabled'}>Liquidate checked</button><button class="btn secondary small" onclick="openCombineLiquidationDateSelection()" ${hasMovableStock ? '' : 'disabled'}>Combine dates</button><button class="btn secondary small" onclick="prepareInventoryForRefining()" ${selectedMoveCount ? '' : 'disabled'}>Refine checked</button></div></div>` : ''}
    ${tableOrEmpty(rows, s => `<tr>${isAdmin() ? `<td><input type="checkbox" data-inventory-move-id="${s.id}" aria-label="${liquidationSelection.has(s.id) ? 'Already moved' : 'Select'} ${esc(s.metal)} ${esc(s.karat)} from ${esc(s.customerName)}" onchange="toggleInventoryForLiquidation('${s.id}',this.checked)" ${inventoryMoveSelection.has(s.id) ? 'checked' : ''} ${movableInventory(s) ? '' : 'disabled'}></td>` : ''}<td>${fmtDate(s.date)}</td><td>${esc(s.customerName)}</td><td><span class="metal-tag ${s.metal.toLowerCase()}">${s.metal}</span> ${esc(s.karat)}</td>
      <td>${esc(s.itemType)}</td><td class="num">${fmtWeight(s.currentWeight)}</td><td class="num">${fmtMoney(s.cost)}</td><td>${statusPill(s.status)}</td><td>${esc(s.remarks || '—')}</td>${isAdmin() ? `<td><div class="form-actions">${movableInventory(s) ? `<button class="btn secondary small" onclick="liquidateInventoryItem('${s.id}')">Liquidate item</button>` : ''}${adminEditButton('Inventory', s.id)}</div></td>` : ''}</tr>`, [...(isAdmin() ? ['Select'] : []), 'Date', 'Customer', 'Metal / karat', 'Type', 'Current weight', 'Cost', 'Status', 'Remarks', ...(isAdmin() ? ['Actions'] : [])], `No stock matches this filter on ${fmtDate(selectedDay.date)}.`)}
  </section>
  `;
}
let editingInventoryId = null;
function openInventoryEdit(id) {
    const item = db.stock.find(s => s.id === id);
    if (!item || !adminEditGuard())
        return;
    editingInventoryId = id;
    const statuses = ['For Selling', 'For Refining', 'On Hold', 'Liquidated', 'Refined', 'Sold'];
    openAdminEditModal('Edit purchase / inventory record', `<div class="form-grid">
    <div class="field"><label>Date</label><input id="edit_inventory_date" type="date" value="${esc(item.date || todayStr())}"></div>
    <div class="field"><label>Classification</label><select id="edit_inventory_status">${statuses.map(status => `<option ${item.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></div>
    <div class="field"><label>Current weight (g)</label><input id="edit_inventory_weight" type="number" min="0" max="${Number(item.netWeight)}" step="0.01" value="${Number(item.currentWeight)}"></div>
    <div class="field"><label>Remaining cost (PHP)</label><input id="edit_inventory_cost" type="number" min="0" step="0.01" value="${Number(item.cost)}"></div>
    <div class="field"><label>Payment method</label><input id="edit_inventory_payment" value="${esc(item.paymentMethod || '')}"></div>
    <div class="field"><label>Staff member</label><input id="edit_inventory_staff" value="${esc(item.staff || '')}"></div>
    <div class="field"><label>Item type</label><select id="edit_inventory_type"><option ${item.itemType === 'Jewelry' ? 'selected' : ''}>Jewelry</option><option ${item.itemType === 'Scrap' ? 'selected' : ''}>Scrap</option></select></div>
    <div class="field span-2"><label>Remarks</label><textarea id="edit_inventory_remarks">${esc(item.remarks || '')}</textarea></div>
  </div><p class="form-note">Original metal, purity, purchase weight, rate, and payout remain locked to preserve the audit trail.</p>`, 'saveInventoryEdit', 'deleteInventoryRecord');
}
async function saveInventoryEdit() {
    if (!adminEditGuard())
        return;
    const item = db.stock.find(s => s.id === editingInventoryId);
    if (!item)
        return;
    const weight = Number(val('edit_inventory_weight')), cost = Number(val('edit_inventory_cost')), status = val('edit_inventory_status');
    if (!val('edit_inventory_date')) {
        toast('Date is required');
        return;
    }
    if (!Number.isFinite(weight) || weight < 0 || weight > Number(item.netWeight)) {
        toast('Current weight must be between 0 and the original net weight');
        return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
        toast('Enter a valid remaining cost');
        return;
    }
    if (weight === 0 && !['Liquidated', 'Refined', 'Sold'].includes(status)) {
        toast('Choose Liquidated, Refined, or Sold when the remaining weight is zero');
        return;
    }
    if (weight > 0 && ['Liquidated', 'Refined', 'Sold'].includes(status)) {
        toast('Liquidated, Refined, or Sold inventory must have zero remaining weight');
        return;
    }
    Object.assign(item, { date: val('edit_inventory_date'), status, currentWeight: roundWeight(weight), cost: roundMoney(cost), paymentMethod: val('edit_inventory_payment').trim(), staff: val('edit_inventory_staff').trim(), itemType: val('edit_inventory_type'), remarks: val('edit_inventory_remarks').trim() });
    closeAdminEditModal();
    await saveDB();
    render();
    toast('Inventory record updated');
}
async function deleteInventoryRecord() {
    if (!adminEditGuard())
        return;
    const item = db.stock.find(s => s.id === editingInventoryId);
    if (!item)
        return;
    const linked = db.liquidations.some(record => (record.lines || []).some(line => line.itemId === item.id)) ||
        db.refiningBatches.some(record => (record.itemIds || []).includes(item.id) || record.outputItemId === item.id) || db.retailSales.some(record => record.itemId === item.id);
    if (linked) {
        toast('This item is linked to a completed transaction. Delete that transaction first.');
        return;
    }
    if (!confirm(`Delete this ${item.metal} ${item.karat} inventory record? This cannot be undone.`))
        return;
    db.stock = db.stock.filter(s => s.id !== item.id);
    closeAdminEditModal();
    await saveDB();
    render();
    toast('Inventory record deleted');
}
/* ============================= LIQUIDATION ============================= */
let liqMetal = 'Gold', liqStatus = 'All', liqKarat = 'All';
function renderLiquidation() {
    const eligible = selectedInventoryForLiquidation();
    if (eligible.length)
        liqMetal = eligible[0].metal;
    return `
  <section class="block">
    <h2 class="block-title">1. Inventory moved for liquidation</h2>
    <p class="form-note">Only records moved from the dated Inventory screen appear here. Return to Inventory to add other stock records.</p>
    ${eligible.length ? `
    <div class="item-check-wrap liquidation-items">
      <div class="item-check-row head"><span></span><span>Item</span><span>Available</span><span>Cost</span><span>Status</span><span>Release wt (g)</span></div>
      ${eligible.map(s => {
        const draft = liquidationDraft.get(s.id) || { weight: Number(s.currentWeight).toFixed(2) };
        return `
        <div class="item-check-row" data-item="${s.id}">
          <button class="btn danger small" style="padding:4px 7px;" aria-label="Remove ${esc(s.karat)} from liquidation" onclick="removeStagedLiquidationItem('${s.id}')">×</button>
          <span>${fmtDate(s.date)} · ${esc(s.karat)} ${esc(s.itemType)} · ${esc(s.customerName)}</span>
          <span class="num">${fmtWeight(s.currentWeight)}</span>
          <span class="num">${fmtMoney(s.cost)}</span>
          <span>${statusPill(s.status)}</span>
          <input type="number" min="0" step="0.01" max="${s.currentWeight}" class="liq-wt" id="liqwt_${s.id}" value="${esc(draft.weight)}" readonly>
        </div>`;
    }).join('')}
    </div>
    ` : `<div class="empty-note">No stock has been moved from Inventory.<div class="form-actions" style="justify-content:center;"><button class="btn" onclick="goTab('inventory')">Open Inventory</button></div></div>`}
  </section>

  ${eligible.length ? `
  <section class="block">
    <h2 class="block-title">2. Batch details</h2>
    <div class="form-grid">
      <div class="field"><label>Buyer / refiner</label><input id="lq_buyer" placeholder="Name"></div>
      <div class="field"><label>Release date</label><input id="lq_date" type="date" value="${todayStr()}"></div>
      <div class="field"><label>Payment status</label><select id="lq_payment"><option>Pending</option><option>Partially Paid</option><option>Paid</option></select></div>
      <div class="field"><label>Total sold (PHP)</label><input id="lq_total_sold" inputmode="decimal" value="${esc(liquidationTotalSoldDraft)}" placeholder="0" oninput="formatMoneyEntry(this);liquidationTotalSoldDraft=this.value;updateLiquidationPreview()"></div>
      <div class="field span-2"><label>Remarks</label><input id="lq_remarks" placeholder="Optional"></div>
    </div>
    <div class="stat-row" style="margin-top:16px;">
      <div class="stat"><div class="label">Selected weight</div><div class="value" id="liq_preview_weight">0.00 g</div></div>
      <div class="stat"><div class="label">Liquidation proceeds</div><div class="value" id="liq_preview_proceeds">PHP 0.00</div></div>
      <div class="stat"><div class="label">Selected inventory cost</div><div class="value" id="liq_preview_cost">PHP 0.00</div></div>
      <div class="stat"><div class="label">Profit</div><div class="value" id="liq_preview_margin">PHP 0.00</div><div class="sub" id="liq_preview_margin_pct">0.00% profit margin</div></div>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="submitLiquidation()">Record liquidation</button>
      <span class="form-note">Enter one total PHP amount for the entire batch. Profit and profit margin are calculated automatically.</span>
    </div>
  </section>
  ` : ''}

  `;
}
function removeStagedLiquidationItem(id) {
    liquidationSelection.delete(id);
    liquidationDraft.delete(id);
    render();
}
function updateLiquidationDraft(id) {
    liquidationDraft.set(id, { weight: val('liqwt_' + id) });
    updateLiquidationPreview();
}
function liquidationAmountLabel(record) {
    const amounts = new Map();
    (record.lines || []).forEach(line => {
        const assay = line.assay || (db.stock.find(item => item.id === line.itemId) || {}).karat || 'Item';
        const amount = Number(line.sellingAmount ?? line.proceeds ?? (Number(line.weight) * Number(line.sellingRate || record.sellingRate))) || 0;
        amounts.set(assay, (amounts.get(assay) || 0) + amount);
    });
    if (!amounts.size && Number(record.proceeds) > 0)
        return esc(fmtMoney(record.proceeds));
    return amounts.size ? Array.from(amounts.entries()).map(([assay, amount]) => `${esc(assay)}: ${esc(fmtMoney(amount))}`).join('<br>') : '—';
}
function liquidationPreviewValues() {
    let totalWeight = 0, totalCost = 0, totalProceeds = 0, selected = 0;
    document.querySelectorAll('.item-check-row[data-item]').forEach(row => {
        const id = row.dataset.item;
        const item = db.stock.find(s => s.id === id);
        if (!item)
            return;
        const enteredWeight = Number(val('liqwt_' + id));
        let weight = Math.min(Math.max(enteredWeight || 0, 0), Number(item.currentWeight));
        if (Number(item.currentWeight) - weight <= 0.005)
            weight = Number(item.currentWeight);
        if (weight <= 0)
            return;
        selected++;
        totalWeight += weight;
        totalCost += (weight / Number(item.currentWeight)) * Number(item.cost);
    });
    totalProceeds = Math.max(parseMoneyEntry(val('lq_total_sold') || liquidationTotalSoldDraft), 0);
    return { selected, totalWeight, totalCost, totalProceeds, margin: totalProceeds - totalCost };
}
function updateLiquidationPreview() {
    const preview = liquidationPreviewValues();
    const weight = document.getElementById('liq_preview_weight'), proceeds = document.getElementById('liq_preview_proceeds');
    const cost = document.getElementById('liq_preview_cost'), margin = document.getElementById('liq_preview_margin');
    const marginPct = document.getElementById('liq_preview_margin_pct');
    if (weight)
        weight.textContent = fmtWeight(preview.totalWeight);
    if (proceeds)
        proceeds.textContent = fmtMoney(preview.totalProceeds);
    if (cost)
        cost.textContent = fmtMoney(preview.totalCost);
    if (margin) {
        margin.textContent = fmtMoney(preview.margin);
        margin.style.color = preview.margin >= 0 ? 'var(--sage)' : 'var(--rust)';
    }
    if (marginPct)
        marginPct.textContent = `${preview.totalCost ? (preview.margin / preview.totalCost * 100).toFixed(2) : '0.00'}% profit margin`;
}
function closeLiquidationDetails() { document.getElementById('liquidation_details_modal')?.remove(); }
function openLiquidationDetails(id) {
    if (!isAdmin())
        return;
    const record = db.liquidations.find(item => item.id === id);
    if (!record)
        return;
    const lines = record.lines || [];
    const profit = Number(record.margin) || 0;
    const profitMargin = Number(record.cost) > 0 ? (profit / Number(record.cost)) * 100 : 0;
    const modal = document.createElement('div');
    modal.id = 'liquidation_details_modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="inventory-move-modal" role="dialog" aria-modal="true" aria-labelledby="liquidation_details_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Liquidation batch details</div><h2 id="liquidation_details_title">${esc(record.id)}</h2></div><button class="modal-close" onclick="closeLiquidationDetails()" aria-label="Close">×</button></div>
    <div class="move-confirmation-summary" style="margin-top:16px;">
      <div><span>Date</span><strong>${fmtDate(record.date)}</strong></div><div><span>Buyer</span><strong>${esc(record.buyer)}</strong></div>
      <div><span>Items</span><strong>${lines.length || record.itemCount || 0}</strong></div><div><span>Status</span><strong>${esc(record.paymentStatus || '—')}</strong></div>
      <div><span>Total weight</span><strong>${fmtWeight(record.releasedWeight)}</strong></div><div><span>Total cost</span><strong>${fmtMoney(record.cost)}</strong></div>
      <div><span>Total sold</span><strong>${fmtMoney(record.proceeds)}</strong></div><div><span>Profit</span><strong>${fmtMoney(profit)} · ${profitMargin.toFixed(2)}%</strong></div>
    </div>
    ${lines.length ? `<div class="table-wrap move-confirmation-items"><table><thead><tr><th>Inventory item</th><th>Customer</th><th>Weight</th><th>Cost</th><th>Total sold</th></tr></thead><tbody>${lines.map(line => {
        const item = db.stock.find(stock => stock.id === line.itemId) || {};
        const amount = Number(line.sellingAmount ?? line.proceeds ?? (Number(line.weight) * Number(line.sellingRate || record.sellingRate))) || 0;
        return `<tr><td><strong>${esc(item.metal || record.metal)} ${esc(line.assay || item.karat || '')}</strong><br><span class="form-note">${esc(item.itemType || 'Inventory item')} · ${esc(line.itemId)}</span></td><td>${esc(item.customerName || '—')}</td><td class="num">${fmtWeight(line.weight)}</td><td class="num">${fmtMoney(line.costPortion)}</td><td class="num">${fmtMoney(amount)}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty-note">Detailed item links are unavailable for this older liquidation record.</div>'}
    ${record.remarks ? `<p class="move-confirmation-note"><strong>Notes</strong><span>${esc(record.remarks)}</span></p>` : ''}
    <div class="form-actions"><button class="btn secondary" onclick="closeLiquidationDetails()">Close</button></div>
  </div>`;
    modal.addEventListener('click', event => { if (event.target === modal)
        closeLiquidationDetails(); });
    document.body.appendChild(modal);
}
async function submitLiquidation() {
    const rows = Array.from(document.querySelectorAll('.item-check-row[data-item]'));
    if (!rows.length) {
        toast('Move stock records from Inventory first');
        return;
    }
    const buyer = val('lq_buyer').trim(), date = val('lq_date');
    if (!buyer) {
        toast('Enter a buyer or refiner name');
        return;
    }
    if (!date) {
        toast('Enter the release date');
        return;
    }
    const totalSold = parseMoneyEntry(val('lq_total_sold'));
    if (totalSold <= 0) {
        toast('Enter the total PHP sold amount for this batch');
        return;
    }
    const prepared = [];
    for (const row of rows) {
        const id = row.dataset.item;
        const item = db.stock.find(s => s.id === id);
        const wtInput = document.getElementById('liqwt_' + id);
        let w = parseFloat(wtInput.value) || 0;
        if (w <= 0) {
            toast(`Enter a release weight for ${item.karat}`);
            return;
        }
        if (w > item.currentWeight + 0.0001) {
            toast('Release weight exceeds available for one item');
            return;
        }
        if (item.currentWeight - w <= 0.005)
            w = Number(item.currentWeight);
        const costPortion = (w / item.currentWeight) * item.cost;
        prepared.push({ item, w, costPortion, previousStatus: item.status });
    }
    const beforeState = JSON.parse(JSON.stringify(db));
    const preparedWeight = prepared.reduce((sum, entry) => sum + entry.w, 0);
    const preparedCost = prepared.reduce((sum, entry) => sum + entry.costPortion, 0);
    let totalWeight = 0, totalCost = 0, allocatedSold = 0, lines = [];
    for (let index = 0; index < prepared.length; index++) {
        const { item, w, costPortion, previousStatus } = prepared[index];
        const ratio = preparedCost > 0 ? costPortion / preparedCost : w / preparedWeight;
        const sellingAmount = index === prepared.length - 1 ? roundMoney(totalSold - allocatedSold) : roundMoney(totalSold * ratio);
        allocatedSold = roundMoney(allocatedSold + sellingAmount);
        const rate = sellingAmount / w;
        item.currentWeight = +(item.currentWeight - w).toFixed(4);
        item.cost = +(item.cost - costPortion).toFixed(2);
        if (item.currentWeight <= 0.005) {
            item.currentWeight = 0;
            item.cost = 0;
            item.status = 'Liquidated';
        }
        totalWeight += w;
        totalCost += costPortion;
        lines.push({ itemId: item.id, assay: item.karat, weight: roundWeight(w), sellingAmount, sellingRate: roundMoney(rate), proceeds: sellingAmount, costPortion: roundMoney(costPortion), previousStatus });
    }
    const uniqueRates = Array.from(new Set(lines.map(line => line.sellingRate)));
    db.liquidations.push({ id: nextSequenceId('L', db.liquidations), date, metal: liqMetal, buyer, itemCount: lines.length, sellingRate: uniqueRates.length === 1 ? uniqueRates[0] : null, releasedWeight: roundWeight(totalWeight),
        proceeds: roundMoney(totalSold), paymentStatus: val('lq_payment'), cost: roundMoney(totalCost), margin: roundMoney(totalSold - totalCost), profitMargin: totalCost ? roundMoney((totalSold - totalCost) / totalCost * 100) : 0, lines, remarks: val('lq_remarks').trim(), createdBy: currentUser?.displayName || '' });
    const saved = await saveDB();
    if (!saved) {
        db = beforeState;
        render();
        toast('Liquidation was not recorded; all inventory changes were rolled back');
        return;
    }
    lines.forEach(line => { liquidationSelection.delete(line.itemId); liquidationDraft.delete(line.itemId); });
    liquidationTotalSoldDraft = '';
    render();
    toast(`Liquidation ${db.liquidations[db.liquidations.length - 1].id} recorded`);
}
let editingLiquidationId = null;
function openLiquidationEdit(id) {
    const record = db.liquidations.find(l => l.id === id);
    if (!record || !adminEditGuard())
        return;
    editingLiquidationId = id;
    const amountFields = (record.lines || []).length
        ? record.lines.map((line, index) => {
            const item = db.stock.find(stock => stock.id === line.itemId);
            const assay = line.assay || item?.karat || 'Item';
            const amount = Number(line.sellingAmount ?? line.proceeds ?? (Number(line.weight) * Number(line.sellingRate || record.sellingRate))) || 0;
            return `<div class="field"><label>${esc(assay)} · ${fmtWeight(line.weight)} total sold (PHP)</label><input id="edit_liquidation_line_amount_${index}" inputmode="decimal" value="${moneyEntryValue(amount)}" oninput="formatMoneyEntry(this)"></div>`;
        }).join('')
        : `<div class="field"><label>Total sold (PHP)</label><input id="edit_liquidation_amount" inputmode="decimal" value="${moneyEntryValue(record.proceeds)}" oninput="formatMoneyEntry(this)"></div>`;
    openAdminEditModal('Edit liquidation', `<div class="form-grid">
    <div class="field"><label>Release date</label><input id="edit_liquidation_date" type="date" value="${esc(record.date || todayStr())}"></div>
    <div class="field"><label>Buyer / refiner</label><input id="edit_liquidation_buyer" value="${esc(record.buyer || '')}"></div>
    ${amountFields}
    <div class="field"><label>Payment status</label><select id="edit_liquidation_payment">${['Pending', 'Partially Paid', 'Paid'].map(status => `<option ${record.paymentStatus === status ? 'selected' : ''}>${status}</option>`).join('')}</select></div>
    <div class="field span-2"><label>Remarks</label><textarea id="edit_liquidation_remarks">${esc(record.remarks || '')}</textarea></div>
  </div><p class="form-note">Released weights and inventory costs remain locked. Batch proceeds and profit are recalculated from the total PHP sold amounts.</p>`, 'saveLiquidationEdit', 'deleteLiquidationRecord');
}
async function saveLiquidationEdit() {
    if (!adminEditGuard())
        return;
    const record = db.liquidations.find(l => l.id === editingLiquidationId);
    if (!record)
        return;
    const buyer = val('edit_liquidation_buyer').trim(), date = val('edit_liquidation_date');
    if (!date || !buyer) {
        toast('Date and buyer are required');
        return;
    }
    if ((record.lines || []).length) {
        const amounts = [];
        for (let index = 0; index < record.lines.length; index++) {
            const line = record.lines[index], amount = parseMoneyEntry(val('edit_liquidation_line_amount_' + index));
            if (!Number.isFinite(amount) || amount <= 0) {
                toast(`Enter a valid total sold amount for ${line.assay || 'each item'}`);
                return;
            }
            amounts.push(roundMoney(amount));
        }
        let proceeds = 0;
        const rates = [];
        record.lines.forEach((line, index) => { line.sellingAmount = amounts[index]; line.proceeds = amounts[index]; line.sellingRate = roundMoney(amounts[index] / Number(line.weight)); rates.push(line.sellingRate); proceeds += line.proceeds; });
        const uniqueRates = Array.from(new Set(rates));
        record.sellingRate = uniqueRates.length === 1 ? uniqueRates[0] : null;
        record.proceeds = roundMoney(proceeds);
    }
    else {
        const amount = parseMoneyEntry(val('edit_liquidation_amount'));
        if (!Number.isFinite(amount) || amount <= 0) {
            toast('Enter a valid total sold amount');
            return;
        }
        record.proceeds = roundMoney(amount);
        record.sellingRate = roundMoney(amount / Number(record.releasedWeight));
    }
    record.date = date;
    record.buyer = buyer;
    record.paymentStatus = val('edit_liquidation_payment');
    record.remarks = val('edit_liquidation_remarks').trim();
    record.margin = roundMoney(record.proceeds - Number(record.cost));
    record.profitMargin = Number(record.cost) > 0 ? roundMoney(record.margin / Number(record.cost) * 100) : 0;
    closeAdminEditModal();
    await saveDB();
    render();
    toast('Liquidation updated');
}
async function deleteLiquidationRecord() {
    if (!adminEditGuard())
        return;
    const record = db.liquidations.find(l => l.id === editingLiquidationId);
    if (!record)
        return;
    const items = (record.lines || []).map(line => ({ line, item: db.stock.find(s => s.id === line.itemId) }));
    if (items.some(entry => !entry.item)) {
        toast('Cannot reverse this liquidation because an inventory item is missing');
        return;
    }
    if (items.some(entry => entry.item.status === 'Sold' || db.retailSales.some(sale => sale.itemId === entry.item.id))) {
        toast('Delete the later retail sale before reversing this liquidation');
        return;
    }
    if (items.some(entry => db.refiningBatches.some(batch => (batch.itemIds || []).includes(entry.item.id)))) {
        toast('Delete the later refining batch before reversing this liquidation');
        return;
    }
    if (items.some(({ line, item }) => Number(item.currentWeight) + Number(line.weight || 0) > Number(item.netWeight) + 0.005)) {
        toast('Inventory weight has changed and this liquidation cannot be reversed safely');
        return;
    }
    if (!confirm(`Delete this liquidation for ${record.buyer} and restore ${fmtWeight(record.releasedWeight)} to inventory?`))
        return;
    items.forEach(({ line, item }) => {
        item.currentWeight = roundWeight(Number(item.currentWeight) + Number(line.weight || 0));
        item.cost = roundMoney(Number(item.cost) + Number(line.costPortion || 0));
        if (item.currentWeight > 0 && item.status === 'Liquidated')
            item.status = line.previousStatus || (item.itemType === 'Scrap' ? 'For Refining' : 'For Selling');
    });
    db.liquidations = db.liquidations.filter(l => l.id !== record.id);
    closeAdminEditModal();
    await saveDB();
    render();
    toast('Liquidation deleted and inventory restored');
}
/* ============================= REFINING ============================= */
let refMetal = 'Gold';
const refiningSelection = new Set();
function toggleRefiningSelection(id, checked) {
    if (checked)
        refiningSelection.add(id);
    else
        refiningSelection.delete(id);
    updateRefiningCombinedSummary();
}
function changeRefiningMetal(metal) { refMetal = metal; refiningSelection.clear(); render(); }
function selectedRefiningItems() {
    return db.stock.filter(item => refiningSelection.has(item.id) && item.metal === refMetal && item.status === 'For Refining' && Number(item.currentWeight) > 0 && !liquidationSelection.has(item.id));
}
function updateRefiningCombinedSummary() {
    const items = selectedRefiningItems();
    const weight = items.reduce((sum, item) => sum + Number(item.currentWeight), 0);
    const cost = items.reduce((sum, item) => sum + Number(item.cost || 0), 0);
    const countEl = document.getElementById('rf_selected_count'), weightEl = document.getElementById('rf_selected_weight'), costEl = document.getElementById('rf_selected_cost');
    if (countEl)
        countEl.textContent = String(items.length);
    if (weightEl)
        weightEl.textContent = fmtWeight(weight);
    if (costEl)
        costEl.textContent = fmtMoney(cost);
}
function prepareInventoryForRefining() {
    const selected = selectedInventoryForMove();
    if (!selected.length) {
        toast('Check at least one For Refining inventory record first');
        return;
    }
    if (selected.some(item => item.status !== 'For Refining')) {
        toast('Only records classified as For Refining can enter a refining batch');
        return;
    }
    const metals = Array.from(new Set(selected.map(item => item.metal)));
    if (metals.length !== 1) {
        toast('A refining batch can contain only one metal');
        return;
    }
    refMetal = metals[0];
    refiningSelection.clear();
    selected.forEach(item => refiningSelection.add(item.id));
    inventoryMoveSelection.clear();
    goTab('refining');
    toast(`${selected.length} ${selected.length === 1 ? 'item' : 'items'} prepared for a refining batch`);
}
function renderRefining() {
    const eligible = db.stock.filter(s => s.metal === refMetal && s.status === 'For Refining' && s.currentWeight > 0 && !liquidationSelection.has(s.id));
    Array.from(refiningSelection).forEach(id => { if (!eligible.some(item => item.id === id))
        refiningSelection.delete(id); });
    const selected = selectedRefiningItems();
    const selectedWeight = selected.reduce((sum, item) => sum + Number(item.currentWeight), 0);
    const selectedCost = selected.reduce((sum, item) => sum + Number(item.cost || 0), 0);
    const outputPurities = distinctKarats(refMetal);
    return `
  <section class="block">
    <h2 class="block-title">1. Select items to combine</h2>
    <p class="form-note">Check every processed item that will become one refined inventory record.</p>
    <div class="filter-row">
      <div class="field"><label>Metal</label><select onchange="changeRefiningMetal(this.value)">
        ${['Gold', 'Silver', 'Platinum'].map(m => `<option ${refMetal === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
    </div>
    ${eligible.length ? `
    <div class="item-check-row head"><span></span><span>Item</span><span>Weight</span><span>Cost</span><span></span><span></span></div>
    ${eligible.map(s => `<div class="item-check-row" data-item="${s.id}">
      <input type="checkbox" class="ref-chk" onchange="toggleRefiningSelection('${s.id}',this.checked)" ${refiningSelection.has(s.id) ? 'checked' : ''}>
      <span>${fmtDate(s.date)} · ${esc(s.karat)} · ${esc(s.customerName)}</span>
      <span class="num">${fmtWeight(s.currentWeight)}</span><span class="num">${fmtMoney(s.cost)}</span><span></span><span></span>
      </div>`).join('')}
    ` : `<div class="empty-note">No ${refMetal.toLowerCase()} stock marked "For Refining".</div>`}
  </section>

  <section class="block">
    <h2 class="block-title">2. Create one refined item</h2>
    <p class="form-note">The selected records will be closed as Refined. Their costs are added together and carried into one finished item.</p>
    <div class="refining-combine-summary">
      <div><span>Selected items</span><strong id="rf_selected_count">${selected.length}</strong></div>
      <div><span>Total input weight</span><strong id="rf_selected_weight">${fmtWeight(selectedWeight)}</strong></div>
      <div><span>Combined inventory cost</span><strong id="rf_selected_cost">${fmtMoney(selectedCost)}</strong></div>
      <div class="combine-arrow" aria-hidden="true">→</div>
      <div class="combined-output-label"><span>Result</span><strong>1 refined item</strong></div>
    </div>
    <div class="form-grid refining-simple-output">
      <div class="field"><label>Output purity / karat</label><select id="rf_purity" required>
        <option value="">— select purity —</option>${outputPurities.map(purity => `<option value="${esc(purity)}">${esc(purity)}</option>`).join('')}
      </select></div>
      <div class="field"><label>Final refined weight (g)</label><input id="rf_returned" type="number" min="0.01" step="0.01" placeholder="e.g. 10.00"></div>
    </div>
    <div class="form-actions">
      <button class="btn" onclick="submitRefining()">Combine into one item</button>
      <span class="form-note">Example: 10K + 12K + 14K → one 24K item. The total cost is carried automatically.</span>
    </div>
  </section>

  <section class="block">
    <h2 class="block-title">Refining history</h2>
    ${tableOrEmpty(db.refiningBatches.slice().sort((a, b) => b.date.localeCompare(a.date)), r => `<tr><td><strong>${esc(r.id)}</strong></td><td>${fmtDate(r.date)}</td><td><span class="metal-tag ${r.metal.toLowerCase()}">${r.metal}</span></td><td>${esc(r.refiner)}</td><td>${esc(r.staff || '—')}</td><td class="num">${(r.itemIds || []).length}</td>
      <td class="num">${fmtWeight(r.inputWeight)}</td><td class="num">${fmtMoney(r.inputCost)}</td><td>${esc(r.outputPurity || '—')} · ${fmtWeight(r.outputWeight ?? r.returnedMetal)}</td><td class="num">${fmtMoney(r.outputCost)}</td><td>${esc(r.status || 'Completed')}</td>${isAdmin() ? `<td>${adminEditButton('Refining', r.id)}</td>` : ''}</tr>`, ['ID', 'Date', 'Metal', 'Refiner', 'Staff', 'Items', 'Input wt', 'Input cost', 'Output', 'Output value', 'Status', ...(isAdmin() ? ['Actions'] : [])], 'No refining batches recorded yet.')}
  </section>
  `;
}
let pendingRefiningBatch = null;
function closeRefiningConfirmation() { document.getElementById('refining_confirmation_modal')?.remove(); pendingRefiningBatch = null; }
function submitRefining() {
    const chosen = selectedRefiningItems().map(item => item.id);
    if (!chosen.length) {
        toast('Select at least one item for refining');
        return;
    }
    const date = todayStr(), refiner = 'In-house refining', outputPurity = val('rf_purity');
    if (!outputPurity) {
        toast('Select the output purity or karat');
        return;
    }
    const returned = Number(val('rf_returned'));
    if (!Number.isFinite(returned) || returned <= 0) {
        toast('Enter the output weight returned to inventory');
        return;
    }
    const items = chosen.map(id => db.stock.find(s => s.id === id)).filter(Boolean);
    if (items.length !== chosen.length || items.some(item => item.status !== 'For Refining' || Number(item.currentWeight) <= 0 || liquidationSelection.has(item.id))) {
        toast('One or more selected items are no longer available for refining');
        return;
    }
    const inputWeight = items.reduce((sum, item) => sum + Number(item.currentWeight), 0);
    const inputCost = items.reduce((sum, item) => sum + Number(item.cost || 0), 0);
    const outputCost = roundMoney(inputCost), outputWeight = roundWeight(returned), outputStatus = 'For Selling';
    const remarks = `Combined from ${chosen.length} refined item${chosen.length === 1 ? '' : 's'}`;
    pendingRefiningBatch = { chosen, date, refiner, outputPurity, expected: outputWeight, actual: outputWeight, charges: 0, outputWeight, outputCost, outputStatus, remarks, metal: refMetal, inputWeight: roundWeight(inputWeight), inputCost: roundMoney(inputCost) };
    const modal = document.createElement('div');
    modal.id = 'refining_confirmation_modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="inventory-move-modal" role="dialog" aria-modal="true" aria-labelledby="refining_confirmation_title">
    <div class="summary-modal-head"><div><div class="eyebrow">Confirm combined refined item</div><h2 id="refining_confirmation_title">${items.length} ${items.length === 1 ? 'item' : 'items'} will become 1 item</h2></div><button class="modal-close" onclick="closeRefiningConfirmation()" aria-label="Close">×</button></div>
    <p class="move-confirmation-intro">The original records will be marked Refined and replaced by one available ${esc(refMetal)} ${esc(outputPurity)} inventory item.</p>
    <div class="move-confirmation-summary"><div><span>Input items</span><strong>${items.length}</strong></div><div><span>Total input weight</span><strong>${fmtWeight(inputWeight)}</strong></div><div><span>Combined cost</span><strong>${fmtMoney(inputCost)}</strong></div><div><span>New inventory item</span><strong>${esc(outputPurity)} · ${fmtWeight(outputWeight)}</strong></div></div>
    <div class="table-wrap move-confirmation-items"><table><thead><tr><th>Input item</th><th>Customer</th><th>Weight</th><th>Cost</th></tr></thead><tbody>${items.map(item => `<tr><td><strong>${esc(item.metal)} ${esc(item.karat)}</strong><br><span class="form-note">${esc(item.itemType)} · ${fmtDate(item.date)}</span></td><td>${esc(item.customerName || '—')}</td><td class="num">${fmtWeight(item.currentWeight)}</td><td class="num">${fmtMoney(item.cost)}</td></tr>`).join('')}</tbody></table></div>
    <div class="form-actions"><button class="btn secondary" onclick="closeRefiningConfirmation()">Cancel</button><button class="btn" onclick="confirmRefiningBatch()">Confirm &amp; create one item</button></div>
  </div>`;
    modal.addEventListener('click', event => { if (event.target === modal)
        closeRefiningConfirmation(); });
    document.body.appendChild(modal);
}
async function confirmRefiningBatch() {
    const pending = pendingRefiningBatch;
    if (!pending)
        return;
    const items = pending.chosen.map(id => db.stock.find(s => s.id === id)).filter(Boolean);
    if (items.length !== pending.chosen.length || items.some(item => item.status !== 'For Refining' || Number(item.currentWeight) <= 0 || liquidationSelection.has(item.id))) {
        closeRefiningConfirmation();
        toast('One or more input items changed. Review the batch again.');
        render();
        return;
    }
    const itemSnapshots = items.map(item => ({ itemId: item.id, currentWeight: Number(item.currentWeight), status: item.status, cost: Number(item.cost) || 0 }));
    const beforeState = JSON.parse(JSON.stringify(db));
    items.forEach(item => { item.currentWeight = 0; item.cost = 0; item.status = 'Refined'; });
    const batchId = nextSequenceId('R', db.refiningBatches), outputItemId = uid('stk');
    const { date, refiner, outputPurity, outputWeight, outputCost, outputStatus, remarks, metal, inputWeight, inputCost, expected, actual, charges } = pending;
    db.stock.push({ id: outputItemId, date, customerId: '', customerName: `Refining output · ${refiner}`, metal, itemType: 'Scrap', karat: outputPurity,
        grossWeight: outputWeight, deductions: 0, netWeight: outputWeight, currentWeight: outputWeight, rate: roundMoney(outputCost / outputWeight),
        suggestedAmount: 0, payout: 0, overrideReason: '', paymentMethod: 'Refining transfer', staff: currentUser?.displayName || refiner,
        status: outputStatus, remarks: remarks || `Consolidated from ${pending.chosen.length} refining items`, cost: outputCost, sourceRefiningBatchId: batchId });
    db.refiningBatches.push({ id: batchId, date, metal, refiner, staff: currentUser?.displayName || '', status: 'Completed', itemIds: pending.chosen, itemSnapshots, outputItemId, outputMetal: metal, outputPurity, outputWeight,
        outputStatus, inputCost: roundMoney(inputCost), outputCost, inputWeight: roundWeight(inputWeight), expectedYield: roundWeight(expected), actualYield: roundWeight(actual),
        variance: roundWeight(actual - expected), refiningCharges: roundMoney(charges), returnedMetal: outputWeight, remarks });
    const itemCount = pending.chosen.length;
    const saved = await saveDB();
    if (!saved) {
        db = beforeState;
        closeRefiningConfirmation();
        render();
        toast('Refining batch was not recorded; all inventory changes were rolled back');
        return;
    }
    refiningSelection.clear();
    closeRefiningConfirmation();
    render();
    toast(`${batchId}: ${itemCount} ${itemCount === 1 ? 'item' : 'items'} consolidated into 1 inventory item`);
}
let editingRefiningId = null;
function openRefiningEdit(id) {
    const record = db.refiningBatches.find(r => r.id === id);
    if (!record || !adminEditGuard())
        return;
    editingRefiningId = id;
    const outputLocked = Boolean(record.outputItemId);
    openAdminEditModal('Edit refining batch', `<div class="form-grid">
    <div class="field"><label>Date</label><input id="edit_refining_date" type="date" value="${esc(record.date || todayStr())}"></div>
    <div class="field"><label>Refiner</label><input id="edit_refining_refiner" value="${esc(record.refiner || '')}"></div>
    <div class="field"><label>Expected yield (g)</label><input id="edit_refining_expected" type="number" min="0" step="0.01" value="${Number(record.expectedYield) || 0}"></div>
    <div class="field"><label>Actual yield (g)</label><input id="edit_refining_actual" type="number" min="0" step="0.01" value="${Number(record.actualYield) || 0}" ${outputLocked ? 'readonly' : ''}></div>
    <div class="field"><label>Refining charges (PHP)</label><input id="edit_refining_charges" type="number" min="0" step="0.01" value="${Number(record.refiningCharges) || 0}" ${outputLocked ? 'readonly' : ''}></div>
    <div class="field"><label>Output weight (g)</label><input id="edit_refining_returned" type="number" min="0" step="0.01" value="${Number(record.outputWeight ?? record.returnedMetal) || 0}" ${outputLocked ? 'readonly' : ''}></div>
    <div class="field span-2"><label>Remarks</label><textarea id="edit_refining_remarks">${esc(record.remarks || '')}</textarea></div>
  </div><p class="form-note">${outputLocked ? 'Output purity, weight, charges, and input items are locked because they define the consolidated inventory item.' : 'Input items and input weight remain locked. Variance is recalculated automatically.'}</p>`, 'saveRefiningEdit', 'deleteRefiningRecord');
}
async function saveRefiningEdit() {
    if (!adminEditGuard())
        return;
    const record = db.refiningBatches.find(r => r.id === editingRefiningId);
    if (!record)
        return;
    const expected = Number(val('edit_refining_expected')), actual = Number(val('edit_refining_actual')), charges = Number(val('edit_refining_charges')), returned = Number(val('edit_refining_returned'));
    if (!val('edit_refining_date') || !val('edit_refining_refiner').trim()) {
        toast('Date and refiner are required');
        return;
    }
    if ([expected, actual, charges, returned].some(value => !Number.isFinite(value) || value < 0)) {
        toast('Yield, charges, and returned metal must be valid non-negative values');
        return;
    }
    const date = val('edit_refining_date'), refiner = val('edit_refining_refiner').trim(), remarks = val('edit_refining_remarks').trim();
    Object.assign(record, { date, refiner, expectedYield: roundWeight(expected), actualYield: roundWeight(actual), variance: roundWeight(actual - expected), refiningCharges: roundMoney(charges), returnedMetal: roundWeight(returned), remarks });
    const outputItem = record.outputItemId ? db.stock.find(item => item.id === record.outputItemId) : null;
    if (outputItem) {
        outputItem.date = date;
        outputItem.customerName = `Refining output · ${refiner}`;
        if (remarks)
            outputItem.remarks = remarks;
    }
    closeAdminEditModal();
    await saveDB();
    render();
    toast('Refining batch updated');
}
async function deleteRefiningRecord() {
    if (!adminEditGuard())
        return;
    const record = db.refiningBatches.find(r => r.id === editingRefiningId);
    if (!record)
        return;
    const snapshots = (record.itemSnapshots?.length ? record.itemSnapshots : (record.itemIds || []).map(itemId => {
        const item = db.stock.find(s => s.id === itemId);
        const previouslyReleased = db.liquidations.reduce((sum, batch) => sum + (batch.lines || []).filter(line => line.itemId === itemId).reduce((lineSum, line) => lineSum + Number(line.weight || 0), 0), 0);
        return { itemId, currentWeight: Math.max(0, (Number(item?.netWeight) || 0) - previouslyReleased), status: 'For Refining' };
    }));
    const items = snapshots.map(snapshot => ({ snapshot, item: db.stock.find(s => s.id === snapshot.itemId) }));
    if (items.some(entry => !entry.item)) {
        toast('Cannot reverse this batch because an inventory item is missing');
        return;
    }
    const outputItem = record.outputItemId ? db.stock.find(item => item.id === record.outputItemId) : null;
    if (record.outputItemId && !outputItem) {
        toast('Cannot reverse this batch because its output inventory item is missing');
        return;
    }
    if (outputItem) {
        const usedInLiquidation = db.liquidations.some(batch => (batch.lines || []).some(line => line.itemId === outputItem.id));
        const usedInRefining = db.refiningBatches.some(batch => batch.id !== record.id && (batch.itemIds || []).includes(outputItem.id));
        const usedInRetail = db.retailSales.some(sale => sale.itemId === outputItem.id);
        if (usedInLiquidation || usedInRefining || usedInRetail) {
            toast('Delete the later transaction using the refined output before reversing this batch');
            return;
        }
        if (Math.abs(Number(outputItem.currentWeight) - Number(record.outputWeight ?? record.returnedMetal)) > 0.005 || Math.abs(Number(outputItem.cost) - Number(record.outputCost)) > 0.01) {
            toast('The refined output inventory has changed and this batch cannot be reversed safely');
            return;
        }
    }
    if (items.some(entry => entry.item.status === 'Sold' || db.retailSales.some(sale => sale.itemId === entry.item.id))) {
        toast('Delete the later retail sale before reversing this refining batch');
        return;
    }
    if (items.some(entry => Number(entry.item.currentWeight) !== 0 || !['Refined', 'Liquidated'].includes(entry.item.status))) {
        toast('Inventory has changed and this refining batch cannot be reversed safely');
        return;
    }
    if (!confirm(`Delete this refining batch for ${record.refiner}, remove its output item, and restore ${items.length} input ${items.length === 1 ? 'item' : 'items'}?`))
        return;
    if (outputItem)
        db.stock = db.stock.filter(item => item.id !== outputItem.id);
    items.forEach(({ snapshot, item }) => { item.currentWeight = roundWeight(snapshot.currentWeight); item.cost = roundMoney(snapshot.cost ?? item.cost); item.status = snapshot.status || 'For Refining'; });
    db.refiningBatches = db.refiningBatches.filter(r => r.id !== record.id);
    closeAdminEditModal();
    await saveDB();
    render();
    toast('Refining batch deleted and inventory restored');
}
/* ============================= RETAIL SALES ============================= */
let lastRetailSaleId = null;
function renderRetail() {
    const eligible = db.stock.filter(s => s.status === 'For Selling' && s.itemType === 'Jewelry' && s.currentWeight > 0);
    return `
  <section class="block">
    <h2 class="block-title">Sell a jewelry item</h2>
    <div class="form-grid">
      <div class="field span-2"><label>Item</label>
        <select id="rt_item">
          <option value="">— choose item —</option>
          ${eligible.map(s => `<option value="${s.id}">${fmtDate(s.date)} · ${s.metal} ${esc(s.karat)} · ${fmtWeight(s.currentWeight)} · cost ${fmtMoney(s.cost)}</option>`).join('')}
        </select>
        ${!eligible.length ? `<span class="hint">No jewelry currently marked "For Selling".</span>` : ''}
      </div>
      <div class="field"><label>Buyer name</label><input id="rt_buyer" placeholder="Walk-in customer"></div>
      <div class="field"><label>Sale date</label><input id="rt_date" type="date" value="${todayStr()}"></div>
      <div class="field"><label>Sale price (PHP)</label><input id="rt_price" type="number" min="0" step="0.01"></div>
    </div>
    <div class="form-actions"><button class="btn" onclick="submitRetail()">Record sale</button></div>
  </section>

  <section class="block">
    <h2 class="block-title">Retail sales history</h2>
    ${tableOrEmpty(db.retailSales.slice().sort((a, b) => b.date.localeCompare(a.date)), r => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.buyer)}</td><td class="num">${fmtMoney(r.salePrice)}</td>
      <td class="num">${fmtMoney(r.cost)}</td><td class="num" style="color:${r.margin >= 0 ? 'var(--sage)' : 'var(--rust)'}">${fmtMoney(r.margin)}</td><td><div class="form-actions"><button class="btn secondary small" onclick="printRetailSummary('${r.id}')">Summary</button>${adminEditButton('Retail', r.id)}</div></td></tr>`, ['Date', 'Buyer', 'Sale price', 'Cost', 'Margin', 'Actions'], 'No retail sales recorded yet.')}
  </section>
  `;
}
function submitRetail() {
    const itemId = val('rt_item');
    if (!itemId) {
        toast('Choose an item to sell');
        return;
    }
    const item = db.stock.find(s => s.id === itemId);
    const price = parseFloat(val('rt_price'));
    if (!price || price <= 0) {
        toast('Enter a valid sale price');
        return;
    }
    const buyer = val('rt_buyer').trim() || 'Walk-in';
    const soldWeight = Number(item.currentWeight);
    item.status = 'Sold';
    item.currentWeight = 0;
    const sale = { id: uid('rtl'), date: val('rt_date'), itemId, buyer, salePrice: price, cost: item.cost, margin: +(price - item.cost).toFixed(2),
        itemSummary: `${item.metal} ${item.karat} ${item.itemType}`, weight: soldWeight };
    db.retailSales.push(sale);
    lastRetailSaleId = sale.id;
    saveDB();
    render();
    toast('Sale recorded');
}
let editingRetailId = null;
function openRetailEdit(id) {
    const record = db.retailSales.find(r => r.id === id);
    if (!record || !adminEditGuard())
        return;
    editingRetailId = id;
    openAdminEditModal('Edit retail sale', `<div class="form-grid">
    <div class="field"><label>Sale date</label><input id="edit_retail_date" type="date" value="${esc(record.date || todayStr())}"></div>
    <div class="field"><label>Buyer</label><input id="edit_retail_buyer" value="${esc(record.buyer || '')}"></div>
    <div class="field span-2"><label>Sale price (PHP)</label><input id="edit_retail_price" type="number" min="0" step="0.01" value="${Number(record.salePrice)}"></div>
  </div><p class="form-note">The sold item and inventory cost remain locked. Margin is recalculated automatically.</p>`, 'saveRetailEdit', 'deleteRetailRecord');
}
async function saveRetailEdit() {
    if (!adminEditGuard())
        return;
    const record = db.retailSales.find(r => r.id === editingRetailId);
    if (!record)
        return;
    const price = Number(val('edit_retail_price')), buyer = val('edit_retail_buyer').trim();
    if (!val('edit_retail_date') || !buyer) {
        toast('Date and buyer are required');
        return;
    }
    if (!Number.isFinite(price) || price <= 0) {
        toast('Enter a valid sale price');
        return;
    }
    record.date = val('edit_retail_date');
    record.buyer = buyer;
    record.salePrice = roundMoney(price);
    record.margin = roundMoney(price - Number(record.cost));
    closeAdminEditModal();
    await saveDB();
    render();
    toast('Retail sale updated');
}
async function deleteRetailRecord() {
    if (!adminEditGuard())
        return;
    const record = db.retailSales.find(r => r.id === editingRetailId);
    if (!record)
        return;
    const item = db.stock.find(s => s.id === record.itemId);
    if (!item) {
        toast('Cannot reverse this sale because its inventory item is missing');
        return;
    }
    if (item.status !== 'Sold' || Number(item.currentWeight) !== 0) {
        toast('Inventory has changed and this retail sale cannot be reversed safely');
        return;
    }
    if (!confirm(`Delete this retail sale to ${record.buyer} and return the item to available inventory?`))
        return;
    const previouslyReleased = db.liquidations.reduce((sum, batch) => sum + (batch.lines || []).filter(line => line.itemId === item.id).reduce((lineSum, line) => lineSum + Number(line.weight || 0), 0), 0);
    item.currentWeight = roundWeight(Math.min(Number(record.weight) || Number(item.netWeight), Math.max(0, Number(item.netWeight) - previouslyReleased)));
    item.status = 'For Selling';
    db.retailSales = db.retailSales.filter(r => r.id !== record.id);
    closeAdminEditModal();
    await saveDB();
    render();
    toast('Retail sale deleted and item restored');
}
function printRetailSummary(id) {
    const sale = db.retailSales.find(r => r.id === id), item = sale && db.stock.find(s => s.id === sale.itemId);
    if (!sale) {
        toast('Sale summary not found');
        return;
    }
    const summary = sale.itemSummary || (item ? `${item.metal} ${item.karat} ${item.itemType}` : 'Jewelry item');
    const weight = sale.weight || (item && item.netWeight) || 0;
    const w = window.open('', '_blank', 'width=620,height=700');
    if (!w) {
        toast('Allow pop-ups to open the transaction summary');
        return;
    }
    w.document.write(`<!doctype html><html><head><title>Retail Sale ${esc(sale.id)}</title><style>body{font-family:Arial,sans-serif;max-width:620px;margin:45px auto;color:#222}h1{font-family:Georgia,serif}table{width:100%;border-collapse:collapse;margin-top:24px}td{padding:10px;border-bottom:1px solid #ddd}td:last-child{text-align:right}.foot{margin-top:35px;font-size:12px;color:#666}@media print{button{display:none}}</style></head><body><h1>ZPP Gold Trading</h1><p>Retail transaction summary</p><table><tr><td>Reference</td><td>${esc(sale.id)}</td></tr><tr><td>Date</td><td>${esc(fmtDate(sale.date))}</td></tr><tr><td>Buyer</td><td>${esc(sale.buyer)}</td></tr><tr><td>Item</td><td>${esc(summary)}</td></tr><tr><td>Weight</td><td>${esc(fmtWeight(weight))}</td></tr><tr><td>Sale price</td><td>${esc(fmtMoney(sale.salePrice))}</td></tr></table><p class="foot">This summary records the selected jewelry item removed from available inventory.</p><button onclick="window.print()">Print</button></body></html>`);
    w.document.close();
}
/* ============================= USER ACCOUNTS ============================= */
function renderUsers() {
    if (!isAdmin())
        return '<div class="empty-note">Administrator access required.</div>';
    return `
  <section class="block">
    <h2 class="block-title">Create an account</h2>
    <div class="form-grid">
      <div class="field"><label>Account holder</label><input id="usr_name" placeholder="Full name"></div>
      <div class="field"><label>Username</label><input id="usr_username" autocomplete="off" placeholder="e.g. juan.santos"></div>
      <div class="field"><label>Temporary password</label><input id="usr_password" type="password" autocomplete="new-password" placeholder="At least 8 characters"></div>
      <div class="field"><label>Role and access</label><select id="usr_role" onchange="updateRoleDescription()"><option value="staff">Staff — limited access</option><option value="admin">Admin — full access</option></select><span class="hint" id="usr_role_description">Can view rates, override grades, record purchases, view inventory, and manage customers.</span></div>
    </div>
    <div class="form-actions"><button class="btn" onclick="createUserAccount()">Create account</button><span class="form-note">Only administrators can create accounts or grant administrator access.</span></div>
  </section>
  <section class="block">
    <h2 class="block-title">Accounts</h2>
    <div id="user_accounts_table">${renderUserAccountsTable()}</div>
  </section>`;
}
function renderUserAccountsTable() {
    return tableOrEmpty(userAccounts, user => `<tr><td>${esc(user.displayName)}</td><td>${esc(user.username)}</td><td>${esc(user.role)}</td><td>${user.active ? 'Active' : 'Disabled'}</td><td>${esc(new Date(user.createdAt).toLocaleDateString('en-PH'))}</td><td>${adminEditButton('User', user.id)}</td></tr>`, ['Name', 'Username', 'Role', 'Status', 'Created', 'Actions'], 'Loading accounts…');
}
async function loadUserAccounts() {
    if (!isAdmin())
        return;
    try {
        const response = await fetch('/api/users', { cache: 'no-store' });
        if (!response.ok)
            throw new Error('Could not load accounts');
        userAccounts = (await response.json()).users || [];
        const container = document.getElementById('user_accounts_table');
        if (container)
            container.innerHTML = renderUserAccountsTable();
    }
    catch (error) {
        toast(error.message || 'Could not load accounts');
    }
}
function updateRoleDescription() {
    const description = document.getElementById('usr_role_description');
    if (description)
        description.textContent = val('usr_role') === 'admin'
            ? 'Full access to pricing, purchases, inventory, liquidation, refining, retail sales, reports, and user accounts.'
            : 'Can view rates, override grades, record purchases, view inventory, and manage customers.';
}
async function createUserAccount() {
    const displayName = val('usr_name').trim(), username = val('usr_username').trim(), password = val('usr_password'), role = val('usr_role');
    try {
        const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName, username, password, role }) });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || 'Could not create account');
        toast(`${role === 'admin' ? 'Admin' : 'Staff'} account ${result.user.username} created`);
        ['usr_name', 'usr_username', 'usr_password'].forEach(id => { const input = document.getElementById(id); if (input)
            input.value = ''; });
        await loadUserAccounts();
    }
    catch (error) {
        toast(error.message || 'Could not create account');
    }
}
let editingUserId = null;
function openUserEdit(id) {
    const account = userAccounts.find(user => user.id === id);
    if (!account || !adminEditGuard())
        return;
    editingUserId = id;
    openAdminEditModal('Edit user account', `<div class="form-grid">
    <div class="field"><label>Account holder</label><input id="edit_user_name" value="${esc(account.displayName)}"></div>
    <div class="field"><label>Username</label><input value="${esc(account.username)}" disabled><span class="hint">Usernames cannot be changed.</span></div>
    <div class="field"><label>Role and access</label><select id="edit_user_role"><option value="staff" ${account.role === 'staff' ? 'selected' : ''}>Staff — limited access</option><option value="admin" ${account.role === 'admin' ? 'selected' : ''}>Admin — full access</option></select></div>
    <div class="field"><label>Account status</label><select id="edit_user_active"><option value="true" ${account.active ? 'selected' : ''}>Active</option><option value="false" ${!account.active ? 'selected' : ''}>Disabled</option></select></div>
    <div class="field span-2"><label>Reset password <span class="hint">optional</span></label><input id="edit_user_password" type="password" autocomplete="new-password" placeholder="Leave blank to keep the current password"></div>
  </div><p class="form-note">Role and status changes take effect on the server. A disabled user is signed out on their next request.</p>`, 'saveUserEdit', 'deleteUserRecord');
}
async function saveUserEdit() {
    if (!adminEditGuard())
        return;
    const account = userAccounts.find(user => user.id === editingUserId);
    if (!account)
        return;
    const displayName = val('edit_user_name').trim(), role = val('edit_user_role'), active = val('edit_user_active') === 'true', password = val('edit_user_password');
    if (!displayName) {
        toast('Account holder name is required');
        return;
    }
    if (password && password.length < 8) {
        toast('New password must be at least 8 characters');
        return;
    }
    try {
        const response = await fetch(`/api/users/${encodeURIComponent(account.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName, role, active, password }) });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || 'Could not update account');
        closeAdminEditModal();
        if (currentUser?.id === account.id) {
            currentUser = { ...currentUser, displayName: result.user.displayName };
            showApp();
        }
        await loadUserAccounts();
        toast('User account updated');
    }
    catch (error) {
        toast(error.message || 'Could not update account');
    }
}
async function deleteUserRecord() {
    if (!adminEditGuard())
        return;
    const account = userAccounts.find(user => user.id === editingUserId);
    if (!account)
        return;
    if (account.id === currentUser?.id) {
        toast('You cannot delete the account currently signed in');
        return;
    }
    if (!confirm(`Permanently delete the account "${account.username}"?`))
        return;
    try {
        const response = await fetch(`/api/users/${encodeURIComponent(account.id)}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error || 'Could not delete account');
        closeAdminEditModal();
        await loadUserAccounts();
        toast('User account deleted');
    }
    catch (error) {
        toast(error.message || 'Could not delete account');
    }
}
/* ============================= REPORTS ============================= */
function toCSV(rows, columns) {
    const head = columns.map(c => c.label).join(',');
    const body = rows.map(r => columns.map(c => {
        let v = typeof c.get === 'function' ? c.get(r) : r[c.key];
        v = (v == null ? '' : String(v)).replace(/"/g, '""');
        return `"${v}"`;
    }).join(',')).join('\n');
    return head + '\n' + body;
}
function downloadCSV(filename, csv) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
function exportStock() {
    downloadCSV('zpp_inventory.csv', toCSV(db.stock, [
        { label: 'Date', key: 'date' }, { label: 'Customer', key: 'customerName' }, { label: 'Metal', key: 'metal' }, { label: 'Karat', key: 'karat' },
        { label: 'Item type', key: 'itemType' }, { label: 'Gross weight', key: 'grossWeight' }, { label: 'Deductions', key: 'deductions' },
        { label: 'Net weight', key: 'netWeight' }, { label: 'Current weight', key: 'currentWeight' }, { label: 'Rate', key: 'rate' },
        { label: 'Payout', key: 'payout' }, { label: 'Cost remaining', key: 'cost' }, { label: 'Status', key: 'status' }, { label: 'Staff', key: 'staff' }
    ]));
}
function exportLiquidations() {
    downloadCSV('zpp_liquidations.csv', toCSV(db.liquidations, [
        { label: 'Liquidation ID', key: 'id' }, { label: 'Date', key: 'date' }, { label: 'Metal', key: 'metal' }, { label: 'Buyer/Refiner', key: 'buyer' }, { label: 'Number of items', get: record => (record.lines || []).length || record.itemCount || 0 }, { label: 'Released weight', key: 'releasedWeight' },
        { label: 'Total sold by item', get: record => (record.lines || []).map(line => `${line.assay || 'Item'}: ${Number(line.sellingAmount ?? line.proceeds) || 0}`).join(' | ') },
        { label: 'Total sold', key: 'proceeds' }, { label: 'Payment status', key: 'paymentStatus' }, { label: 'Total cost', key: 'cost' }, { label: 'Profit', key: 'margin' }
    ]));
}
function exportRefining() {
    downloadCSV('zpp_refining.csv', toCSV(db.refiningBatches, [
        { label: 'Refining ID', key: 'id' }, { label: 'Date', key: 'date' }, { label: 'Metal', key: 'metal' }, { label: 'Refiner', key: 'refiner' }, { label: 'Staff', key: 'staff' },
        { label: 'Input item IDs', get: r => (r.itemIds || []).join(' | ') }, { label: 'Input weight', key: 'inputWeight' }, { label: 'Input cost', key: 'inputCost' },
        { label: 'Expected yield', key: 'expectedYield' }, { label: 'Actual yield', key: 'actualYield' }, { label: 'Variance', key: 'variance' },
        { label: 'Charges', key: 'refiningCharges' }, { label: 'Output purity', key: 'outputPurity' }, { label: 'Output weight', get: r => r.outputWeight ?? r.returnedMetal },
        { label: 'Output inventory cost', key: 'outputCost' }, { label: 'Status', key: 'status' }, { label: 'Notes', key: 'remarks' }
    ]));
}
function exportPurchases() {
    downloadCSV('zpp_purchase_history.csv', toCSV(db.stock.filter(s => !s.sourceRefiningBatchId), [
        { label: 'Date', key: 'date' }, { label: 'Seller', key: 'customerName' }, { label: 'Metal', key: 'metal' }, { label: 'Karat / purity', key: 'karat' },
        { label: 'Item type', key: 'itemType' }, { label: 'Net weight', key: 'netWeight' }, { label: 'Rate', key: 'rate' }, { label: 'Payout', key: 'payout' },
        { label: 'Payment method', key: 'paymentMethod' }, { label: 'Staff', key: 'staff' }, { label: 'Status', key: 'status' }
    ]));
}
function exportRetail() {
    downloadCSV('zpp_retail_sales.csv', toCSV(db.retailSales, [
        { label: 'Date', key: 'date' }, { label: 'Buyer', key: 'buyer' }, { label: 'Sale price', key: 'salePrice' }, { label: 'Cost', key: 'cost' }, { label: 'Margin', key: 'margin' }
    ]));
}
function exportCustomers() {
    downloadCSV('zpp_customers.csv', toCSV(db.customers, [
        { label: 'Name', key: 'name' }, { label: 'Contact', key: 'contact' }, { label: 'Notes', key: 'notes' }
    ]));
}
function exportRates() {
    downloadCSV('zpp_rate_history.csv', toCSV(visiblePricingHistory(), [
        { label: 'Effective date', key: 'effectiveDate' }, { label: 'Entered by', key: 'enteredBy' },
        { label: 'Gold 24K base', get: h => h.snapshot.gold.base }, { label: 'Silver base', get: h => h.snapshot.silver.base }, { label: 'Platinum base', get: h => h.snapshot.platinum.base }
    ]));
}
function renderLiquidationHistory() {
    return `<section class="block">
    <div class="batch-head"><div><h2 class="block-title">Liquidation history</h2><p class="form-note">Administrator record of all completed liquidation batches.</p></div><button class="btn small" onclick="exportLiquidations()">Download liquidation CSV</button></div>
    ${dashboardReportSearch('Search ID, date, buyer, metal, or status', db.liquidations.length)}
    ${tableOrEmpty(db.liquidations.slice().sort((a, b) => b.date.localeCompare(a.date)), l => `<tr data-dashboard-search="${dashboardSearchValue(l.id, l.date, fmtDate(l.date), l.buyer, l.metal, l.paymentStatus)}"><td><button class="link-button" onclick="openLiquidationDetails('${l.id}')">${esc(l.id)}</button></td><td>${fmtDate(l.date)}</td><td>${esc(l.buyer)}</td><td class="num">${(l.lines || []).length || l.itemCount || 0}</td>
      <td class="num">${fmtMoney(l.cost)}</td><td class="num">${fmtMoney(l.proceeds)}</td><td class="num" style="color:${l.margin >= 0 ? 'var(--sage)' : 'var(--rust)'}">${fmtMoney(l.margin)}</td><td>${esc(l.paymentStatus || '—')}</td><td><div class="form-actions"><button class="btn secondary small" onclick="openLiquidationDetails('${l.id}')">Details</button>${adminEditButton('Liquidation', l.id)}</div></td></tr>`, ['ID', 'Date', 'Buyer / refiner', 'Items', 'Total cost', 'Total sold', 'Profit', 'Status', 'Actions'], 'No liquidations recorded yet.')}
  </section>`;
}
function renderReports() {
    const purchases = db.stock.filter(s => !s.sourceRefiningBatchId).slice().sort((a, b) => b.date.localeCompare(a.date));
    const purchaseWeight = purchases.reduce((sum, item) => sum + Number(item.netWeight || 0), 0);
    const purchasePayout = purchases.reduce((sum, item) => sum + Number(item.payout || 0), 0);
    const readyStock = db.stock.filter(s => (s.status === 'For Selling' || s.status === 'For Refining') && s.currentWeight > 0);
    const purchaseReport = `<div id="dashboard_report_content" class="dashboard-report-content">
  <section class="block recent-purchases purchase-history">
    <div class="batch-head"><div><h2 class="block-title">Purchase history</h2><p class="form-note">All recorded purchases are kept here in one view.</p></div><button class="btn small" onclick="exportPurchases()">Download purchase CSV</button></div>
    ${dashboardReportSearch('Search seller, date, metal, purity, status, or staff', purchases.length)}
    <div class="stat-row" style="margin:16px 0;">
      <div class="stat"><div class="label">Items purchased</div><div class="value">${purchases.length}</div></div>
      <div class="stat"><div class="label">Total net weight</div><div class="value">${fmtWeight(purchaseWeight)}</div></div>
      <div class="stat"><div class="label">Total payout</div><div class="value">${fmtMoney(purchasePayout)}</div></div>
    </div>
    ${tableOrEmpty(purchases, s => `<tr data-dashboard-search="${dashboardSearchValue(s.date, fmtDate(s.date), s.customerName, s.metal, s.karat, s.itemType, s.status, s.staff, s.batchId)}"><td data-label="Date">${fmtDate(s.date)}</td><td data-label="Seller">${esc(s.customerName)}</td><td data-label="Item"><span class="metal-tag ${s.metal.toLowerCase()}">${s.metal}</span> ${esc(s.karat)} · ${esc(s.itemType)}</td>
      <td data-label="Net weight" class="num">${fmtWeight(s.netWeight)}</td><td data-label="Payout" class="num">${fmtMoney(s.payout)}</td><td data-label="Status">${statusPill(s.status)}</td>
      <td data-label="Details"><div class="purchase-details"><span class="hint">${esc(s.staff || 'No staff recorded')}</span><div class="form-actions"><button class="btn secondary small" onclick="openPurchaseReceipt('${s.batchId || s.id}')">Receipt</button>${adminEditButton('Inventory', s.id)}</div></div></td></tr>`, ['Date', 'Seller', 'Item', 'Net weight', 'Payout', 'Status', 'Details'], 'No purchases recorded yet.')}
  </section>
  <section class="block">
    <h2 class="block-title">Customer history (all sellers)</h2>
    ${tableOrEmpty(db.customers, c => {
        const hist = db.stock.filter(s => s.customerId === c.id);
        const totalW = hist.reduce((a, s) => a + Number(s.netWeight), 0);
        const totalP = hist.reduce((a, s) => a + Number(s.payout), 0);
        return `<tr><td>${esc(c.name)}</td><td class="num">${hist.length}</td><td class="num">${fmtWeight(totalW)}</td><td class="num">${fmtMoney(totalP)}</td></tr>`;
    }, ['Customer', 'Transactions', 'Total weight sold', 'Total payout'], 'No customers on file yet.')}
  </section></div>`;
    const liquidationReport = `<div id="dashboard_report_content" class="dashboard-report-content">${renderLiquidationHistory()}</div>`;
    const readinessReport = `<div id="dashboard_report_content" class="dashboard-report-content"><section class="block">
    <div class="batch-head"><div><h2 class="block-title">Liquidation readiness</h2><p class="form-note">Available inventory that can be prepared for selling or refining.</p></div><button class="btn small" onclick="goTab('inventory')">Open inventory</button></div>
    ${dashboardReportSearch('Search date, metal, purity, item type, or status', readyStock.length)}
    ${tableOrEmpty(readyStock, s => `<tr data-dashboard-search="${dashboardSearchValue(s.date, fmtDate(s.date), s.metal, s.karat, s.itemType, s.status, s.customerName)}"><td>${fmtDate(s.date)}</td><td><span class="metal-tag ${s.metal.toLowerCase()}">${s.metal}</span> ${esc(s.karat)}</td><td>${esc(s.itemType)}</td>
      <td class="num">${fmtWeight(s.currentWeight)}</td><td>${statusPill(s.status)}</td></tr>`, ['Date', 'Metal / karat', 'Type', 'Weight available', 'Status'], 'Nothing is currently eligible for liquidation.')}
  </section></div>`;
    const selectedReport = dashboardReportPanel === 'purchases' ? purchaseReport : dashboardReportPanel === 'liquidations' ? liquidationReport : dashboardReportPanel === 'readiness' ? readinessReport : '';
    return `<section class="block dashboard-report-menu">
    <div><h2 class="block-title">Dashboard records</h2><p class="form-note">Open only the report you need. Select the active button again to close it.</p></div>
    <div class="dashboard-report-buttons">
      <button class="btn ${dashboardReportPanel === 'purchases' ? '' : 'secondary'}" aria-pressed="${dashboardReportPanel === 'purchases'}" onclick="toggleDashboardReport('purchases')"><span>Purchase history</span><strong>${purchases.length}</strong></button>
      <button class="btn ${dashboardReportPanel === 'liquidations' ? '' : 'secondary'}" aria-pressed="${dashboardReportPanel === 'liquidations'}" onclick="toggleDashboardReport('liquidations')"><span>Liquidation history</span><strong>${db.liquidations.length}</strong></button>
      <button class="btn ${dashboardReportPanel === 'readiness' ? '' : 'secondary'}" aria-pressed="${dashboardReportPanel === 'readiness'}" onclick="toggleDashboardReport('readiness')"><span>Liquidation readiness</span><strong>${readyStock.length}</strong></button>
    </div>
  </section>
  ${selectedReport}
  <section class="block export-ledger-compact">
    <details><summary>Export ledger data</summary><div class="stat-row">
      <div class="stat"><div class="label">Inventory ledger</div><button class="btn small" style="margin-top:8px;" onclick="exportStock()">Download CSV</button></div>
      <div class="stat"><div class="label">Liquidation history</div><button class="btn small" style="margin-top:8px;" onclick="exportLiquidations()">Download CSV</button></div>
      <div class="stat"><div class="label">Refining history</div><button class="btn small" style="margin-top:8px;" onclick="exportRefining()">Download CSV</button></div>
      <div class="stat"><div class="label">Retail sales</div><button class="btn small" style="margin-top:8px;" onclick="exportRetail()">Download CSV</button></div>
      <div class="stat"><div class="label">Customers</div><button class="btn small" style="margin-top:8px;" onclick="exportCustomers()">Download CSV</button></div>
      <div class="stat"><div class="label">Rate history</div><button class="btn small" style="margin-top:8px;" onclick="exportRates()">Download CSV</button></div>
    </div></details>
  </section>`;
}
/* ============================= INIT ============================= */
initializeAuth();
