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
    matchingBuyingCustomerNames(query) {
      return Array.from(matchingBuyingCustomers(query), customer => customer.name);
    },
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
    openBatchEdit(id) {
      appended.length = 0;
      openLiquidationBatchEdit(id);
      return appended.at(-1)?.innerHTML || '';
    },
    appendToBatch(batchId, itemIds) {
      const batch = db.liquidationBatches.find(record => record.id === batchId);
      const items = itemIds.map(id => db.stock.find(item => item.id === id)).filter(Boolean);
      appendItemsToLiquidationBatch(batch, items);
      return JSON.parse(JSON.stringify({ batch, items, batchCount: db.liquidationBatches.length }));
    },
    allocatePool(itemIds, weight) {
      const items = itemIds.map(id => db.stock.find(item => item.id === id)).filter(Boolean);
      const prepared = preparePooledInventoryAllocation(items, weight);
      if (prepared) prepared.poolItems = items;
      const applied = applyPooledInventoryAllocation(prepared);
      return JSON.parse(JSON.stringify({ prepared, applied, items }));
    },
    restorePool(lines) {
      lines.forEach(restorePooledLiquidationLine);
      return JSON.parse(JSON.stringify(db.stock));
    },
    syncPool(id) {
      const pool = db.inventoryPools.find(item => item.id === id);
      const snapshot = syncInventoryPool(pool);
      return JSON.parse(JSON.stringify({ pool, snapshot }));
    },
    renderPools() {
      return renderInventoryPools();
    },
    openItemLiquidation(id) {
      appended.length = 0;
      liquidateInventoryItem(id);
      return appended.at(-1)?.innerHTML || '';
    },
    prepareItemLiquidation(id, weight) {
      const item = db.stock.find(record => record.id === id);
      return JSON.parse(JSON.stringify(preparePooledInventoryAllocation(item ? [item] : [], weight)));
    },
    async createItemLiquidation({ id, weight, buyer, name, type = 'partial' }) {
      const values = {
        inventory_item_liquidation_id: id,
        inventory_item_liquidation_type: type,
        inventory_item_liquidation_weight: String(weight),
        inventory_item_liquidation_buyer: buyer,
        inventory_item_liquidation_name: name,
        inventory_item_liquidation_notes: ''
      };
      const originalGetElementById = document.getElementById;
      const originalSaveDB = saveDB;
      const originalGoTab = goTab;
      const originalRender = render;
      const originalToast = toast;
      document.getElementById = key => key in values ? { value: values[key] } : null;
      saveDB = async () => true;
      goTab = () => {};
      render = () => {};
      toast = () => {};
      await createInventoryItemLiquidationBatch();
      document.getElementById = originalGetElementById;
      saveDB = originalSaveDB;
      goTab = originalGoTab;
      render = originalRender;
      toast = originalToast;
      return JSON.parse(JSON.stringify(db));
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
    },
    cashflowDate(value) {
      return typeof cashflowDateStr === 'function' ? cashflowDateStr(new Date(value)) : null;
    }
  };`, context);
  return context.inventoryTestApi;
}

test('cashflow day rolls over at 4:00 AM Manila time', async () => {
  const api = await loadInventoryApi();
  assert.equal(api.cashflowDate('2026-09-12T19:59:59.000Z'), '2026-09-12');
  assert.equal(api.cashflowDate('2026-09-12T20:00:00.000Z'), '2026-09-13');
});

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
    inventoryPools: [],
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

test('a mixed Gold and Silver selection stays in one liquidation batch', async () => {
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
    { metal: 'Mixed', ids: ['stock-on-hand', 'stock-on-hand-silver'] }
  ]);
});

test('editing a batch offers available inventory from other metals', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock.push({ id: 'stock-silver-new', date: '2026-09-12', customerName: 'New Silver Seller', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', currentWeight: 4, netWeight: 4, cost: 300 });
  api.setState(state);

  const html = api.openBatchEdit('LB-0001');

  assert.match(html, /\+ Add New Item/);
  assert.match(html, /Current batch items/);
  assert.match(html, /New Silver Seller/);
  assert.match(html, /Available Gold, Silver, or Platinum inventory/);
});

test('adding Silver to a Gold batch converts it to Mixed and preserves both lines', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock.push({ id: 'stock-silver-new', date: '2026-09-12', customerName: 'Silver Seller', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', currentWeight: 4, netWeight: 4, cost: 300 });
  api.setState(state);

  const result = api.appendToBatch('LB-0001', ['stock-silver-new']);

  assert.equal(result.batch.metal, 'Mixed');
  assert.deepEqual(JSON.parse(JSON.stringify(result.batch.lines.map(line => line.itemId))), ['stock-transit-a', 'stock-silver-new']);
  assert.equal(result.items[0].status, 'For Liquidation');
  assert.equal(result.items[0].liquidationBatchId, 'LB-0001');
});

test('partial pooled Silver liquidation uses mean cost and keeps the running balance', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'silver-a', date: '2026-09-10', customerName: 'Seller A', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', netWeight: 1000, currentWeight: 1000, payout: 95000, cost: 95000 },
    { id: 'silver-b', date: '2026-09-11', customerName: 'Seller B', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', netWeight: 1440, currentWeight: 1440, payout: 149194, cost: 149194 }
  ];
  state.liquidationBatches = [];
  api.setState(state);

  const result = api.allocatePool(['silver-a', 'silver-b'], 1000);

  assert.equal(result.applied, true);
  assert.equal(result.prepared.totalWeight, 2440);
  assert.equal(result.prepared.totalCost, 244194);
  assert.equal(result.prepared.weight, 1000);
  assert.equal(result.prepared.cost, 100079.51);
  assert.equal(result.prepared.remainingWeight, 1440);
  assert.equal(result.prepared.remainingCost, 144114.49);
  assert.equal(result.items.reduce((sum, item) => sum + item.currentWeight, 0), 1440);
  assert.equal(result.items.reduce((sum, item) => sum + item.cost, 0), 144114.49);
  assert.equal(result.items.reduce((sum, item) => sum + item.netWeight, 0), 2440);
  assert.equal(result.items.reduce((sum, item) => sum + item.payout, 0), 244194);

  const restored = api.restorePool(result.prepared.allocations);
  assert.equal(restored.reduce((sum, item) => sum + item.currentWeight, 0), 2440);
  assert.equal(restored.reduce((sum, item) => sum + item.cost, 0), 244194);
});

test('Liquidate item opens a partial-or-entire modal before moving inventory', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  api.setState(state);

  const html = api.openItemLiquidation('stock-on-hand');

  assert.match(html, /Partial liquidation/);
  assert.match(html, /Entire item/);
  assert.match(html, /Weight for liquidation \(g\)/);
  assert.match(html, /Cost for liquidation/);
  assert.match(html, /Weight remaining/);
  assert.match(html, /Assigned buyer/);
  assert.match(html, /Create liquidation batch/);
});

test('partial item liquidation assigns proportional cost and preserves the remainder', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  api.setState(state);

  const prepared = api.prepareItemLiquidation('stock-on-hand', 4);

  assert.equal(prepared.weight, 4);
  assert.equal(prepared.cost, 400);
  assert.equal(prepared.remainingWeight, 6);
  assert.equal(prepared.remainingCost, 600);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.allocations)), [
    { itemId: 'stock-on-hand', previousStatus: 'Available', weight: 4, cost: 400, pooledAllocation: true }
  ]);
});

test('confirming partial item liquidation creates an open batch and keeps the balance in inventory', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.liquidationBatches = [];
  api.setState(state);

  const result = await api.createItemLiquidation({
    id: 'stock-on-hand', weight: 4, buyer: 'Test Buyer', name: '18K partial batch'
  });

  assert.equal(result.liquidationBatches.length, 1);
  assert.equal(result.liquidationBatches[0].buyer, 'Test Buyer');
  assert.deepEqual(JSON.parse(JSON.stringify(result.liquidationBatches[0].lines)), [
    { itemId: 'stock-on-hand', previousStatus: 'Available', weight: 4, cost: 400, pooledAllocation: true }
  ]);
  const remaining = result.stock.find(item => item.id === 'stock-on-hand');
  assert.equal(remaining.currentWeight, 6);
  assert.equal(remaining.cost, 600);
  assert.equal(remaining.status, 'Available');
  assert.equal(result.liquidations.length, 0);
});

test('a manually created On Hold pool stays On Hold after partial liquidation', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'pool-a', date: '2026-09-10', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 1000, currentWeight: 1000, payout: 100000, cost: 100000 },
    { id: 'pool-b', date: '2026-09-11', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 2000, currentWeight: 2000, payout: 200000, cost: 200000 }
  ];
  state.inventoryPools = [{ id: 'POOL-0001', name: 'Silver reserve', metal: 'Silver', karat: '925', itemIds: ['pool-a', 'pool-b'], originalWeight: 3000, originalCost: 300000, onHold: true }];
  state.liquidationBatches = [];
  api.setState(state);

  const allocation = api.allocatePool(['pool-a', 'pool-b'], 1000);
  const result = api.syncPool('POOL-0001');

  assert.equal(allocation.prepared.cost, 100000);
  assert.equal(result.pool.status, 'ON HOLD');
  assert.equal(result.pool.remainingWeight, 2000);
  assert.equal(result.pool.remainingCost, 200000);
  const html = api.renderPools();
  assert.match(html, /Silver reserve/);
  assert.match(html, /ON HOLD/);
  assert.match(html, /PARTIALLY LIQUIDATED/);
  assert.match(html, />Partial liquidation</);
  assert.match(html, />Entire pool</);
});

test('manual pools remain independent when one pool is partially liquidated', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'a-1', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 3000, currentWeight: 3000, payout: 300000, cost: 300000 },
    { id: 'a-2', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 1, currentWeight: 1, payout: 100, cost: 100 },
    { id: 'b-1', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0002', netWeight: 1000, currentWeight: 1000, payout: 100000, cost: 100000 },
    { id: 'b-2', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0002', netWeight: 500, currentWeight: 500, payout: 50000, cost: 50000 }
  ];
  state.inventoryPools = [
    { id: 'POOL-0001', name: 'Pool A', metal: 'Silver', karat: '925', itemIds: ['a-1', 'a-2'], originalWeight: 3001, originalCost: 300100, onHold: true },
    { id: 'POOL-0002', name: 'Pool B', metal: 'Silver', karat: '925', itemIds: ['b-1', 'b-2'], originalWeight: 1500, originalCost: 150000, onHold: false }
  ];
  state.liquidationBatches = [];
  api.setState(state);

  api.allocatePool(['a-1', 'a-2'], 1000);
  const poolA = api.syncPool('POOL-0001');
  const poolB = api.syncPool('POOL-0002');

  assert.equal(poolA.pool.remainingWeight, 2001);
  assert.equal(poolB.pool.remainingWeight, 1500);
  assert.equal(poolB.pool.remainingCost, 150000);
  assert.equal(poolB.pool.status, 'ACTIVE');
});

test('a manual pool may combine mixed metals and purities', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.stock = [
    { id: 'mixed-gold', metal: 'Gold', karat: '18K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0003', netWeight: 100, currentWeight: 100, payout: 500000, cost: 500000 },
    { id: 'mixed-silver', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0003', netWeight: 900, currentWeight: 900, payout: 90000, cost: 90000 }
  ];
  state.inventoryPools = [{ id: 'POOL-0003', name: 'Mixed reserve', metal: 'Mixed', karat: 'Mixed', itemIds: ['mixed-gold', 'mixed-silver'], originalWeight: 1000, originalCost: 590000, onHold: true }];
  api.setState(state);

  const allocation = api.allocatePool(['mixed-gold', 'mixed-silver'], 500);
  const result = api.syncPool('POOL-0003');

  assert.equal(allocation.prepared.cost, 295000);
  assert.equal(result.pool.remainingWeight, 500);
  assert.equal(result.pool.remainingCost, 295000);
  assert.match(api.renderPools(), /Mixed metals \/ purities/);
});

test('inventory offers manual Pool selected and removes automatic pool/date grouping actions', async () => {
  const api = await loadInventoryApi();
  api.setState(stateFixture());
  const html = api.renderInventory();
  assert.match(html, /Pool selected/);
  assert.doesNotMatch(html, /Pool Gold \/ Silver/);
  assert.doesNotMatch(html, />Combine dates</);
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

test('featured buying range does not include customer selection', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.customers = [{ id: 'cust-1', name: 'Maria Santos', contact: '', notes: '' }];
  state.pricing.featured = null;
  api.setState(state);

  const html = api.renderFeaturedBox();

  assert.doesNotMatch(html, /fx_customer/);
  assert.doesNotMatch(html, /Customer name/);
  assert.doesNotMatch(html, /Maria Santos/);
});

test('Buying customer information uses a searchable custom suggestion list', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.customers = [{ id: 'cust-1', name: 'Maria Santos', contact: '', notes: '' }, { id: 'cust-2', name: 'Mario Reyes', contact: '', notes: '' }];
  api.setState(state);

  const html = api.renderBuying();

  assert.match(html, /Customer Information/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /id="b_customer_suggestions"/);
  assert.match(html, /Leave blank for a walk-in seller/);
  assert.doesNotMatch(html, /<datalist|id="b_customer_choice"/);
  assert.equal(api.matchingBuyingCustomerNames('mari').join('|'), 'Maria Santos|Mario Reyes');
  assert.equal(api.matchingBuyingCustomerNames('unknown').length, 0);
});

test('featured buying range still displays its saved remarks', async () => {
  const api = await loadInventoryApi();
  const state = stateFixture();
  state.pricing.featured = { metal: 'Gold', key: '18K', low: 6200, high: 6400, remarks: 'Clean items only' };
  api.setState(state);

  const html = api.renderFeaturedBox();

  assert.match(html, /Clean items only/);
  assert.doesNotMatch(html, /openFeaturedRemarksEditor/);
  assert.match(html, />Unpin</);
});
