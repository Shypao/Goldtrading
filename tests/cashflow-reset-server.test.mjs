import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function calculate(totals, adjustments, baseline) {
  const script = `
    import * as server from './src/server.ts';
    const result = typeof server.cashflowMovementTotals === 'function'
      ? server.cashflowMovementTotals(${JSON.stringify(totals)}, ${JSON.stringify(adjustments)}, ${JSON.stringify(baseline)})
      : null;
    process.stdout.write(JSON.stringify(result));
  `;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, ZPP_UPSTREAM_URL: 'http://unused.invalid' }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function purchasesSinceSetting(records, date, setting) {
  const script = `
    import * as server from './src/server.ts';
    const result = typeof server.cashPurchasesSinceSetting === 'function'
      ? server.cashPurchasesSinceSetting(${JSON.stringify(records)}, ${JSON.stringify(date)}, ${JSON.stringify(setting)})
      : null;
    process.stdout.write(JSON.stringify(result));
  `;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, ZPP_UPSTREAM_URL: 'http://unused.invalid' }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function movementTotalsForRecords(records, date, adjustments, baseline) {
  const script = `
    import * as server from './src/server.ts';
    const result = typeof server.cashflowMovementTotalsForRecords === 'function'
      ? server.cashflowMovementTotalsForRecords(${JSON.stringify(records)}, ${JSON.stringify(date)}, ${JSON.stringify(adjustments)}, ${JSON.stringify(baseline)})
      : null;
    process.stdout.write(JSON.stringify(result));
  `;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, ZPP_UPSTREAM_URL: 'http://unused.invalid' }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('cashflow movement reset zeroes existing IN and OUT without hiding future movement', () => {
  const adjustments = [
    { operation: 'add', amount: 66572 },
    { operation: 'deduct', amount: 50 }
  ];
  const baseline = { cashIn: 66572, manualCashOut: 50, cashOut: 23093 };

  assert.deepEqual(calculate({ cashPurchases: 23043 }, adjustments, baseline), {
    cashIn: 0,
    manualCashOut: 0,
    cashOut: 0
  });
  assert.deepEqual(calculate({ cashPurchases: 24043 }, [...adjustments, { operation: 'add', amount: 500 }], baseline), {
    cashIn: 500,
    manualCashOut: 0,
    cashOut: 1000
  });
});

test('cash balance uses purchases after the latest Admin setting instead of a stale deleted-record baseline', () => {
  const setting = {
    balanceBase: 722764,
    cashPaidBaseline: 22816,
    setAt: '2026-09-11T05:12:40.788Z',
    setBy: 'Administrator'
  };
  const records = [
    { id: 'buy-1', date: '2026-09-11', recordedAt: '2026-09-11T13:15:17.151Z', paymentMethod: 'Cash', payout: 132747 },
    { id: 'buy-2', date: '2026-09-11', recordedAt: '2026-09-11T13:18:50.499Z', paymentMethod: 'Cash', payout: 33269 },
    { id: 'buy-3', date: '2026-09-11', recordedAt: '2026-09-11T13:30:10.863Z', paymentMethod: 'Cash', payout: 7000 }
  ];

  assert.equal(purchasesSinceSetting(records, '2026-09-11', setting), 173016);
});

test('OUT uses cash purchases after the latest reset instead of a stale deleted-record baseline', () => {
  const records = [
    { id: 'buy-1', date: '2026-09-11', recordedAt: '2026-09-11T13:15:17.151Z', paymentMethod: 'Cash', payout: 132747 },
    { id: 'buy-2', date: '2026-09-11', recordedAt: '2026-09-11T13:18:50.499Z', paymentMethod: 'Cash', payout: 33269 },
    { id: 'buy-3', date: '2026-09-11', recordedAt: '2026-09-11T13:30:10.863Z', paymentMethod: 'Cash', payout: 7000 }
  ];
  const adjustments = [
    { operation: 'add', amount: 23043, createdAt: '2026-09-11T00:20:00.000Z' },
    { operation: 'reset', amount: 0, createdAt: '2026-09-11T00:44:21.841Z' }
  ];
  const staleBaseline = { cashIn: 23043, manualCashOut: 0, cashOut: 23043 };

  assert.deepEqual(movementTotalsForRecords(records, '2026-09-11', adjustments, staleBaseline), {
    cashIn: 0,
    manualCashOut: 0,
    cashOut: 173016
  });
});
