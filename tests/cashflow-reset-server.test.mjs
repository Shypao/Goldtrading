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
