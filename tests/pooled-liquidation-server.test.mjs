import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function validate(state) {
  const script = `
    import { validateLedgerIntegrity } from './src/server.ts';
    try {
      validateLedgerIntegrity(${JSON.stringify(state)});
      process.stdout.write('ok');
    } catch (error) {
      process.stderr.write(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  `;
  return spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, ZPP_UPSTREAM_URL: 'http://unused.invalid' }
  });
}

function emptyState() {
  return { customers: [], stock: [], liquidationBatches: [], liquidations: [], refiningBatches: [], retailSales: [], pricingHistory: [], pricing: null };
}

test('server accepts a partial pooled liquidation while the source keeps its remaining balance', () => {
  const state = emptyState();
  state.stock.push({
    id: 'silver-source', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available',
    netWeight: 2440, currentWeight: 1440, payout: 244194, cost: 144114.49
  });
  state.liquidationBatches.push({
    id: 'LB-0001', name: '925 pooled batch', buyer: 'Silver Buyer', metal: 'Silver',
    lines: [{ itemId: 'silver-source', previousStatus: 'Available', weight: 1000, cost: 100079.51, pooledAllocation: true }]
  });

  const result = validate(state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});

test('server accepts a correctly labelled mixed-metal liquidation batch', () => {
  const state = emptyState();
  state.stock.push(
    { id: 'gold', metal: 'Gold', karat: '18K', itemType: 'Scrap', status: 'For Liquidation', liquidationBatchId: 'LB-0001', netWeight: 5, currentWeight: 5, payout: 500, cost: 500 },
    { id: 'silver', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'For Liquidation', liquidationBatchId: 'LB-0001', netWeight: 10, currentWeight: 10, payout: 800, cost: 800 }
  );
  state.liquidationBatches.push({
    id: 'LB-0001', name: 'Mixed batch', buyer: 'Buyer', metal: 'Mixed',
    lines: [
      { itemId: 'gold', previousStatus: 'Available', weight: 5, cost: 500 },
      { itemId: 'silver', previousStatus: 'Available', weight: 10, cost: 800 }
    ]
  });

  const result = validate(state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});
