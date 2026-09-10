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
