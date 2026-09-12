import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadDashboardReports() {
  const appPath = new URL('../public/app.js', import.meta.url);
  const source = (await readFile(appPath, 'utf8')).replace(/initializeAuth\(\);\s*$/, '');
  const context = vm.createContext({ console });
  vm.runInContext(`${source}\n;globalThis.dashboardReportsTestApi = {
    renderReports,
    renderDashboard,
    renderInventory,
    todayStr,
    shiftDateKey,
    todayPurchaseMetalSummary,
    purchaseTotalsByPurity,
    setInventoryView(date, metal = 'All') {
      inventoryWeekOffset = 0;
      inventorySelectedDate = date;
      invFilter = { metal, karat: 'All', type: 'All', status: 'All' };
    },
    setState(state) {
      db = state.db;
      currentUser = state.currentUser;
      dashboardReportPanel = state.dashboardReportPanel;
    }
  };`, context);
  return context.dashboardReportsTestApi;
}

function testState(stock, dashboardReportPanel = '') {
  return {
    currentUser: { role: 'admin' },
    dashboardReportPanel,
    db: {
      stock,
      customers: [],
      liquidations: [],
      refiningBatches: [],
      retailSales: [],
      pricingHistory: []
    }
  };
}

test('closed dashboard reports do not format hidden purchase rows', async () => {
  const api = await loadDashboardReports();
  let formattedRows = 0;
  const purchase = {
    id: 'stock-1',
    date: '2026-09-10',
    sourceRefiningBatchId: null,
    currentWeight: 0,
    payout: 100,
    netWeight: 1,
    metal: 'Gold',
    karat: '18K',
    itemType: 'Jewelry',
    status: 'Sold',
    staff: 'Staff',
    batchId: 'batch-1',
    get customerName() {
      formattedRows += 1;
      return 'Example seller';
    }
  };

  api.setState(testState([purchase]));
  api.renderReports();

  assert.equal(formattedRows, 0);
});

test('opening purchase history formats its rows', async () => {
  const api = await loadDashboardReports();
  let formattedRows = 0;
  const purchase = {
    id: 'stock-1',
    date: '2026-09-10',
    sourceRefiningBatchId: null,
    currentWeight: 0,
    payout: 100,
    netWeight: 1,
    metal: 'Gold',
    karat: '18K',
    itemType: 'Jewelry',
    status: 'Sold',
    staff: 'Staff',
    batchId: 'batch-1',
    get customerName() {
      formattedRows += 1;
      return 'Example seller';
    }
  };

  api.setState(testState([purchase], 'purchases'));
  const html = api.renderReports();

  assert.ok(formattedRows > 0);
  assert.match(html, /Example seller/);
});

test('dashboard groups only today purchases into clickable metal totals', async () => {
  const api = await loadDashboardReports();
  const today = api.todayStr();
  const stock = [
    { id: 'gold-1', date: today, metal: 'Gold', netWeight: 2.5, payout: 12000 },
    { id: 'gold-2', date: today, metal: 'Gold', netWeight: 1.25, payout: 6000 },
    { id: 'silver-1', date: today, metal: 'Silver', netWeight: 10, payout: 1000 },
    { id: 'old-gold', date: '2000-01-01', metal: 'Gold', netWeight: 100, payout: 999999 }
  ];
  api.setState(testState(stock));

  const html = api.renderDashboard();
  const gold = api.todayPurchaseMetalSummary(stock.filter(item => item.date === today), 'Gold');

  assert.equal(gold.count, 2);
  assert.equal(gold.weight, 3.75);
  assert.equal(gold.payout, 18000);
  assert.match(html, /openTodayMetalPurchases\('Gold'\)/);
  assert.match(html, /PHP 18,000/);
  assert.match(html, /PHP 1,000/);
  assert.doesNotMatch(html, /PHP 999,999/);
});

test('liquidation readiness defaults to two weeks and sorts newest purchases first', async () => {
  const api = await loadDashboardReports();
  const today = api.todayStr();
  const yesterday = api.shiftDateKey(today, -1);
  const older = api.shiftDateKey(today, -20);
  const readyItem = (id, date, metal) => ({ id, date, metal, karat: '999', itemType: 'Scrap', status: 'Available', currentWeight: 1 });
  api.setState(testState([
    readyItem('older', older, 'Platinum'),
    readyItem('yesterday', yesterday, 'Silver'),
    readyItem('today', today, 'Gold')
  ], 'readiness'));

  const html = api.renderReports();

  assert.match(html, /Last 2 weeks/);
  assert.ok(html.indexOf('Gold') < html.indexOf('Silver'));
  assert.doesNotMatch(html, /Platinum/);
  assert.match(html, /2 of 3 eligible items/);
});

test('daily inventory totals group every purchase by purity including liquidated items', async () => {
  const api = await loadDashboardReports();
  const today = api.todayStr();
  const stock = [
    { id: 'gold-active', date: today, metal: 'Gold', karat: '18K', itemType: 'Scrap', status: 'Available', netWeight: 2.5, currentWeight: 2.5, payout: 10000, cost: 10000 },
    { id: 'gold-liquidated', date: today, metal: 'Gold', karat: '18K', itemType: 'Jewelry', status: 'Liquidated', netWeight: 1.5, currentWeight: 0, payout: 6000, cost: 6000 },
    { id: 'silver-active', date: today, metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'For Refining', netWeight: 10, currentWeight: 10, payout: 1000, cost: 1000 }
  ];
  api.setState(testState(stock));
  api.setInventoryView(today, 'Gold');

  const totals = api.purchaseTotalsByPurity(stock.filter(item => item.metal === 'Gold'));
  const html = api.renderInventory();

  assert.equal(totals.length, 1);
  assert.equal(totals[0].count, 2);
  assert.equal(totals[0].purchasedWeight, 4);
  assert.equal(totals[0].remainingWeight, 2.5);
  assert.equal(totals[0].payout, 16000);
  assert.match(html, /Purchase totals by purity/);
  assert.doesNotMatch(html, /End-of-day/);
  assert.match(html, /Today's All/);
  assert.match(html, /Today's Gold/);
  assert.match(html, /Today's Silver/);
  assert.match(html, /PHP 16,000/);
  assert.match(html, /4\.00 g/);
});
