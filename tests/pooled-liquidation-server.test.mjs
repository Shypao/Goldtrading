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
  return { customers: [], stock: [], inventoryPools: [], liquidationBatches: [], liquidations: [], refiningBatches: [], retailSales: [], pricingHistory: [], pricing: null };
}

function preparePartialItem(state, request) {
  const script = `
    import { preparePartialItemLiquidationBatch } from './src/server.ts';
    try {
      const result = preparePartialItemLiquidationBatch(${JSON.stringify(state)}, ${JSON.stringify(request)}, 'Admin');
      process.stdout.write(JSON.stringify(result));
    } catch (error) {
      process.stderr.write(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  `;
  return spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, ZPP_UPSTREAM_URL: 'http://unused.invalid' }
  });
}

function prepareCompletion(state, request) {
  const script = `
    import { prepareCompletedLiquidation } from './src/server.ts';
    try {
      const result = prepareCompletedLiquidation(${JSON.stringify(state)}, ${JSON.stringify(request)}, 'Admin');
      process.stdout.write(JSON.stringify(result));
    } catch (error) {
      process.stderr.write(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  `;
  return spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, ZPP_UPSTREAM_URL: 'http://unused.invalid' }
  });
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

test('atomic partial item batch preparation ignores unrelated legacy records', () => {
  const state = emptyState();
  state.stock.push(
    { id: 'target', metal: 'Gold', karat: '18K', itemType: 'Scrap', status: 'Available', netWeight: 10, currentWeight: 10, payout: 1000, cost: 1000 },
    { id: 'legacy-unrelated', status: 'old invalid status' }
  );

  const result = preparePartialItem(state, {
    itemId: 'target', weight: 4, buyer: 'Gold Buyer', name: '18K partial batch', notes: 'Test'
  });

  assert.equal(result.status, 0, result.stderr);
  const prepared = JSON.parse(result.stdout);
  assert.equal(prepared.item.currentWeight, 6);
  assert.equal(prepared.item.cost, 600);
  assert.equal(prepared.batch.buyer, 'Gold Buyer');
  assert.equal(prepared.batch.metal, 'Gold');
  assert.deepEqual(prepared.batch.lines, [
    { itemId: 'target', previousStatus: 'Available', weight: 4, cost: 400, pooledAllocation: true }
  ]);
});

test('atomic partial item batch preparation rejects excessive weight', () => {
  const state = emptyState();
  state.stock.push({ id: 'target', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', netWeight: 10, currentWeight: 10, payout: 1000, cost: 1000 });

  const result = preparePartialItem(state, {
    itemId: 'target', weight: 11, buyer: 'Silver Buyer', name: '925 partial batch'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /between 0\.01 g and 10\.00 g/);
});

test('atomic liquidation completion records a sale without validating unrelated legacy records', () => {
  const state = emptyState();
  state.stock.push(
    { id: 'target', metal: 'Gold', karat: '0.01%', itemType: 'Scrap', status: 'For Liquidation', liquidationBatchId: 'LB-0001', netWeight: 1, currentWeight: 1, payout: 1, cost: 1 },
    { id: 'legacy-unrelated', status: 'old invalid status' }
  );
  state.liquidationBatches.push({
    id: 'LB-0001', name: '0.01% purity partial batch', buyer: 'test', metal: 'Gold',
    lines: [{ itemId: 'target', previousStatus: 'Available', weight: 1, cost: 1 }]
  });

  const result = prepareCompletion(state, {
    batchId: 'LB-0001', date: '2026-09-17', totalSold: 2, paymentStatus: 'Pending', notes: 'test'
  });

  assert.equal(result.status, 0, result.stderr);
  const prepared = JSON.parse(result.stdout);
  assert.equal(prepared.deletedBatchId, 'LB-0001');
  assert.equal(prepared.liquidation.id, 'L-0001');
  assert.equal(prepared.liquidation.proceeds, 2);
  assert.equal(prepared.liquidation.margin, 1);
  assert.equal(prepared.updatedItems[0].status, 'Liquidated');
  assert.equal(prepared.updatedItems[0].currentWeight, 0);
  assert.equal('liquidationBatchId' in prepared.updatedItems[0], false);
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

test('server validates an independent manual pool and its remaining balance', () => {
  const state = emptyState();
  state.stock.push(
    { id: 'a', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 1000, currentWeight: 0, payout: 100000, cost: 0 },
    { id: 'b', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-0001', netWeight: 2000, currentWeight: 2000, payout: 200000, cost: 200000 }
  );
  state.inventoryPools.push({ id: 'POOL-0001', name: 'Silver reserve', metal: 'Silver', karat: '925', itemIds: ['a', 'b'], originalWeight: 3000, originalCost: 300000, remainingWeight: 2000, remainingCost: 200000, onHold: true, status: 'ON HOLD' });
  state.liquidations.push({ id: 'L-0001', poolId: 'POOL-0001', poolName: 'Silver reserve', metal: 'Silver', releasedWeight: 1000, cost: 100000, proceeds: 110000, lines: [{ itemId: 'a', weight: 1000, costPortion: 100000, pooledAllocation: true }] });

  const result = validate(state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});

test('server accepts a manual pool containing mixed metals and purities', () => {
  const state = emptyState();
  state.stock.push(
    { id: 'gold', metal: 'Gold', karat: '18K', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-MIXED', netWeight: 100, currentWeight: 100, payout: 500000, cost: 500000 },
    { id: 'silver', metal: 'Silver', karat: '925', itemType: 'Scrap', status: 'Available', inventoryPoolId: 'POOL-MIXED', netWeight: 900, currentWeight: 900, payout: 90000, cost: 90000 }
  );
  state.inventoryPools.push({ id: 'POOL-MIXED', name: 'Mixed reserve', metal: 'Mixed', karat: 'Mixed', itemIds: ['gold', 'silver'], originalWeight: 1000, originalCost: 590000, remainingWeight: 1000, remainingCost: 590000, onHold: true, status: 'ON HOLD' });

  const result = validate(state);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'ok');
});
