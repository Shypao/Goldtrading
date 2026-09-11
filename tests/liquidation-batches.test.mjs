import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadInventoryApi() {
  const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
    .replace(/initializeAuth\(\);\s*$/, '');
  const appended = [];
  const document = {
    body: { appendChild(element) { appended.push(element); } },
    createElement() {
      return {
        addEventListener() {},
        querySelector() { return { focus() {} }; },
        remove() {}
      };
    },
    getElementById() { return null; }
  };
  const context = vm.createContext({ console, document, appended });
  vm.runInContext(`${source}\n;globalThis.inventoryTestApi = {
    activeInventoryRecord,
    cashflowCardMarkup,
    toggleCashflowCard,
    cashflowDetailSnapshot,
    ensureShape,
    renderBuying,
    renderFeaturedBox,
    renderInventory,
    renderLiquidation,
    rateSheetGoldGradeKeys() {
      const grades = typeof rateSheetGoldGrades === 'function'
        ? rateSheetGoldGrades()
        : GOLD_GRADES.filter(grade => grade.key !== '24K' && grade.key !== '18K-BUO');
      return Array.from(grades, grade => grade.key);
    },
    rateSheetSectionMargins() {
      return { desktop: rateSheetSectionMargin(false), phone: rateSheetSectionMargin(true) };
    },
    prepareLiquidationBatches(items) {
      let message = '';
      const originalToast = toast;
      toast = value => { message = value; };
      pendingInventoryMove = null;
      pendingLiquidationBatchSetup = null;
      openInventoryMoveReview(items, { total: items.length, automatic: false });
      if (pendingInventoryMove) confirmInventoryMoveToLiquidation();
      toast = originalToast;
      return JSON.parse(JSON.stringify({ pending: pendingLiquidationBatchSetup, message }));
    },
    openSaleModal(id) {
      appended.length = 0;
      openCompleteLiquidationBatch(id);
      return appended.at(-1)?.innerHTML || '';
    },
    openCashflowResetModal() {
      appended.length = 0;
      if (typeof openCashflowResetConfirmation === 'function') openCashflowResetConfirmation();
      return appended.at(-1)?.innerHTML || '';
    },
    profitPreview(cost, total) {
      const elements = {
        complete_batch_total: { value: total },
        complete_batch_profit: { textContent: '', style: {} },
        complete_batch_profit_margin: { textContent: '', style: {} }
      };
      const originalGetElementById = document.getElementById;
      document.getElementById = id => elements[id] || null;
      updateCompleteLiquidationProfit(cost);
      document.getElementById = originalGetElementById;
      return JSON.parse(JSON.stringify({
        profit: elements.complete_batch_profit,
        margin: elements.complete_batch_profit_margin
      }));
    },
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
  assert.match(html, /Total inventory cost/);
  assert.doesNotMatch(html, /Buyer offer/i);
  assert.match(html, /PHP 500/);
  assert.match(html, /PHP 800/);
});

test('a mixed Gold and Silver selection prepares separate metal batches', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  const gold = state.stock[0];
  const silver = { ...state.stock[0], id: 'stock-on-hand-silver', metal: 'Silver', karat: '999', customerName: 'Silver Seller' };
  state.stock = [gold, silver];
  state.liquidationBatches = [];
  api.setState(state);

  const result = api.prepareLiquidationBatches([gold, silver]);

  assert.equal(result.message, '');
  assert.deepEqual(JSON.parse(JSON.stringify(result.pending.groups)), [
    { metal: 'Gold', ids: ['stock-on-hand'] },
    { metal: 'Silver', ids: ['stock-on-hand-silver'] }
  ]);
});

test('record sale modal shows live profit margin fields without buyer offer', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());

  const html = api.openSaleModal('LB-0001');

  assert.match(html, /Total sold \(PHP\)/);
  assert.match(html, /id="complete_batch_profit"/);
  assert.match(html, /id="complete_batch_profit_margin"/);
  assert.match(html, /Profit margin/);
  assert.doesNotMatch(html, /Buyer offer/i);
  assert.match(html, /id="complete_batch_total"[^>]*value=""/);

  const gain = api.profitPreview(500, '650');
  assert.equal(gain.profit.textContent, 'PHP 150');
  assert.equal(gain.margin.textContent, '30.00%');
  assert.equal(gain.profit.style.color, 'var(--sage)');

  const loss = api.profitPreview(500, '400');
  assert.equal(loss.profit.textContent, 'PHP -100');
  assert.equal(loss.margin.textContent, '-20.00%');
  assert.equal(loss.profit.style.color, 'var(--rust)');
});

test('cash-on-hand card never converts a missing synced balance into zero', async () => {
  const api = await loadInventoryApi();
  api.setCashflow({ date: api.today(), configured: true, cashOnHand: null, cashIn: 0, cashOut: 0 });

  assert.match(api.cashflowCardMarkup(), /<strong>Not set<\/strong>/);
});

test('admin can open a confirmation before resetting IN and OUT counters', async () => {
  const api = await loadInventoryApi();
  api.setCashflow({ date: api.today(), configured: true, cashOnHand: 0, cashIn: 66572, cashOut: 23043 });

  const card = api.cashflowCardMarkup();
  const modal = api.openCashflowResetModal();

  assert.match(card, /Reset IN \/ OUT/);
  assert.match(modal, /Reset IN and OUT to PHP 0/);
  assert.match(modal, /does not delete buying transactions/i);
  assert.match(modal, /Confirm reset/);
});

test('cashflow card can minimize its actions and daily stat blocks', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());

  assert.match(api.cashflowCardMarkup(), />Minimize</);
  assert.match(api.cashflowCardMarkup(), /cashflow-stats/);
  api.toggleCashflowCard();
  const minimized = api.cashflowCardMarkup();
  assert.match(minimized, /is-minimized/);
  assert.match(minimized, />Expand</);
  assert.doesNotMatch(minimized, /cashflow-stats/);
  assert.doesNotMatch(minimized, /View cash flow/);
  assert.match(minimized, /cashflow-flow-strip/);
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

test('downloadable rate sheets omit 73 percent without removing it from website grades', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());

  assert.equal(api.rateSheetGoldGradeKeys().includes('73%'), false);
  assert.match(api.renderBuying(), /73%/);
});

test('downloadable rate sheets add section spacing before Silver and Platinum', async () => {
  const api = await loadInventoryApi();
  const margins = api.rateSheetSectionMargins();

  assert.equal(margins.desktop, 30);
  assert.equal(margins.phone, 56);
});

test('featured buying range offers the saved customer names in a dropdown', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.customers = [{ id: 'cust-1', name: 'Maria Santos', contact: '', notes: '' }];
  state.pricing.featured = null;
  api.setState(state);

  const html = api.renderFeaturedBox();

  assert.match(html, /id="fx_customer"/);
  assert.match(html, /Customer name \(optional\)/);
  assert.match(html, /Maria Santos/);
});

test('featured buying range shows the saved customer and remark without an edit button after pinning', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.customers = [{ id: 'cust-1', name: 'Maria Santos', contact: '', notes: '' }];
  state.pricing.featured = { metal: 'Gold', key: '18K', low: 6200, high: 6400, remarks: 'Clean items only', customerId: 'cust-1', customerName: 'Maria Santos' };
  api.setState(state);

  const html = api.renderFeaturedBox();

  assert.match(html, /Clean items only/);
  assert.match(html, /Maria Santos/);
  assert.doesNotMatch(html, /openFeaturedRemarksEditor/);
  assert.match(html, />Unpin</);
});
