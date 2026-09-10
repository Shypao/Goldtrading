import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadInventoryApi() {
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
    .replace(/initializeAuth\(\);\s*$/, '');
  const context = vm.createContext({ console, document: { getElementById() { return null; } } });
  vm.runInContext(`${source}\n;globalThis.inventoryTestApi = {
    activeInventoryRecord,
    cashflowCardMarkup,
    cashflowDetailSnapshot,
    ensureShape,
    renderBuying,
    renderInventory,
    renderLiquidation,
    setState(state) {
      db = state;
      currentUser = { role: 'admin', displayName: 'Admin' };
      inventorySelectedDate = 'All';
      inventorySearch = '';
      invFilter = { metal: 'All', karat: 'All', type: 'All', status: 'All' };
    },
    setCashflow(snapshot) {
      currentCashflow = snapshot;
      currentUser = { role: 'admin', displayName: 'Admin' };
    },
    setCashflowHistory(snapshot, date) {
      cashflowHistorySnapshot = snapshot;
      cashflowHistoryDate = date;
    },
    setBuyingDraft(form) {
      buyingDraftForm = form;
    },
    today() {
      return todayStr();
    }
  };`, context);
  return context.inventoryTestApi;
}

function stateFixture() {
  return {
    customers: [],
    stock: [
      { id: 'stock-on-hand', date: '2026-09-11', customerName: 'On Hand Seller', metal: 'Gold', karat: '18K', itemType: 'Jewelry', status: 'Available', currentWeight: 10, netWeight: 10, cost: 1000, remarks: '' },
      { id: 'stock-transit-a', date: '2026-09-11', customerName: 'Transit Seller A', metal: 'Gold', karat: '18K', itemType: 'Jewelry', status: 'For Liquidation', liquidationBatchId: 'LB-0001', currentWeight: 5, netWeight: 5, cost: 500, remarks: '' },
      { id: 'stock-transit-b', date: '2026-09-11', customerName: 'Transit Seller B', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'For Liquidation', liquidationBatchId: 'LB-0002', currentWeight: 20, netWeight: 20, cost: 800, remarks: '' }
    ],
    liquidationBatches: [
      { id: 'LB-0001', name: '18K batch', buyer: 'Gold Buyer', metal: 'Gold', buyerOffer: 650, createdAt: '2026-09-11T08:00:00.000Z', lines: [{ itemId: 'stock-transit-a', previousStatus: 'Available', weight: 5, cost: 500 }] },
      { id: 'LB-0002', name: 'Silver batch', buyer: 'Silver Buyer', metal: 'Silver', buyerOffer: 900, createdAt: '2026-09-11T09:00:00.000Z', lines: [{ itemId: 'stock-transit-b', previousStatus: 'For Refining', weight: 20, cost: 800 }] }
    ],
    liquidations: [],
    refiningBatches: [],
    retailSales: [],
    pricingHistory: [],
    pricing: { gold: { base: 0, overrides: {} }, silver: { base: 0, overrides: {} }, platinum: { base: 0, overrides: {} }, auto: {}, gradeMultipliers: {}, dailyFormula: { baseRates: {} } }
  };
}

test('legacy For Selling inventory migrates to Available', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock[0].status = 'For Selling';
  api.setState(state);
  api.ensureShape();

  assert.equal(state.stock[0].status, 'Available');
});

test('For Liquidation records are excluded from Current Inventory', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  api.setState(state);

  assert.equal(api.activeInventoryRecord(state.stock[0]), true);
  assert.equal(api.activeInventoryRecord(state.stock[1]), false);
  const html = api.renderInventory();
  assert.match(html, /On Hand Seller/);
  assert.doesNotMatch(html, /Transit Seller A/);
  assert.doesNotMatch(html, /Transit Seller B/);
  assert.match(html, />1<\/div><div class="sub">active records across all dates/);
});

test('Liquidation view renders independent batches and their totals', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());
  const html = api.renderLiquidation();

  assert.match(html, /18K batch/);
  assert.match(html, /Gold Buyer/);
  assert.match(html, /Silver batch/);
  assert.match(html, /Silver Buyer/);
  assert.match(html, /Batch grand total · buyer offer/);
  assert.match(html, /PHP 500/);
  assert.match(html, /PHP 800/);
});

test('cash-on-hand card never converts a missing synced balance into zero', async () => {
  const api = await loadInventoryApi();
  api.setCashflow({ date: api.today(), configured: true, cashOnHand: null, cashIn: 0, cashOut: 0 });

  assert.match(api.cashflowCardMarkup(), /<strong>Not set<\/strong>/);
});

test('cashflow details can use a retrieved historical daily snapshot', async () => {
  const api = await loadInventoryApi();
  api.setCashflow({ date: api.today(), configured: true, cashOnHand: 900 });
  api.setCashflowHistory({ date: '2026-09-09', configured: true, cashOnHand: 1250, transactions: [], adjustments: [] }, '2026-09-09');

  assert.equal(api.cashflowDetailSnapshot().date, '2026-09-09');
  assert.equal(api.cashflowDetailSnapshot().cashOnHand, 1250);
});

test('buying form replaces a legacy stale draft rate with the active daily rate', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.pricing.gold.base = 8000;
  state.pricing.dailyFormula = { effectiveDate: api.today(), baseRates: { Gold: 8500 } };
  api.setState(state);
  api.setBuyingDraft({ b_metal: 'Gold', b_karat: '18K', b_rate: '6000' });

  assert.match(api.renderBuying(), /id="b_rate"[^>]*value="6375"/);
});

test('buying form preserves an intentional per-item rate override', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.pricing.gold.base = 8000;
  state.pricing.dailyFormula = { effectiveDate: api.today(), baseRates: { Gold: 8500 } };
  api.setState(state);
  api.setBuyingDraft({ b_metal: 'Gold', b_karat: '18K', b_rate: '6200', b_rate_overridden: 'true' });

  const html=api.renderBuying();
  assert.match(html, /id="b_rate"[^>]*value="6200"/);
  assert.match(html, /class="buying-rate is-overridden"/);
});
