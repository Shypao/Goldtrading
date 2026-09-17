import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function validatePurchase(current, customer, items) {
  const script = `
    import { validatePurchaseRecords } from './src/server.ts';
    try {
      validatePurchaseRecords(${JSON.stringify(current)}, ${JSON.stringify(customer)}, ${JSON.stringify(items)});
      process.stdout.write('ok');
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

function purchase(overrides={}) {
  return {
    id:'stk-new',batchId:'buy-new',customerId:'customer-existing',customerName:'Customer',
    metal:'Gold',karat:'18K',itemType:'Scrap',status:'Available',netWeight:1,currentWeight:1,
    rate:7762,payout:7762,cost:7762,date:'2026-09-17',paymentMethod:'Cash',...overrides
  };
}

test('purchase recording accepts a valid append without validating unrelated ledger records', () => {
  const current={
    customers:[{id:'customer-existing',name:'Customer'}],
    stock:[{id:'old-item',status:'legacy unrelated data'}]
  };
  const result=validatePurchase(current,null,[purchase()]);
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,'ok');
});

test('purchase recording accepts a new customer and multiple items in one transaction', () => {
  const customer={id:'customer-new',name:'New Customer',contact:'',notes:''};
  const items=[purchase({id:'stk-a',customerId:'customer-new'}),purchase({id:'stk-b',customerId:'customer-new',metal:'Silver',karat:'925',netWeight:10,currentWeight:10,rate:100,payout:1000,cost:1000})];
  const result=validatePurchase({customers:[],stock:[]},customer,items);
  assert.equal(result.status,0,result.stderr);
});

test('purchase recording rejects invalid amounts and mixed transaction IDs', () => {
  const current={customers:[{id:'customer-existing',name:'Customer'}],stock:[]};
  const badAmount=validatePurchase(current,null,[purchase({cost:1})]);
  assert.notEqual(badAmount.status,0);
  assert.match(badAmount.stderr,/Invalid purchase record/);
  const mixedBatch=validatePurchase(current,null,[purchase({id:'stk-a'}),purchase({id:'stk-b',batchId:'buy-other'})]);
  assert.notEqual(mixedBatch.status,0);
  assert.match(mixedBatch.stderr,/one transaction/);
});

test('browser purchase flow uses the atomic purchases endpoint instead of full-ledger save', async () => {
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('async function commitPurchaseBatch');
  const end=source.indexOf('function receiptWeightNumber');
  const purchaseFlow=source.slice(start,end);
  assert.match(purchaseFlow,/savePurchaseRecords\(newCustomer, newItems\)/);
  assert.match(purchaseFlow,/fetch\(['"]\/api\/purchases['"]/);
  assert.doesNotMatch(purchaseFlow,/const saved = await saveDB\(\)/);
});
