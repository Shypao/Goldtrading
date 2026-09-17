import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const indexPath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../public/app.js', import.meta.url);

async function receiptMarkup(items) {
  const source = (await readFile(appPath, 'utf8')).replace(/initializeAuth\(\);\s*$/, '');
  const context = vm.createContext({ console });
  vm.runInContext(`${source}\n;globalThis.renderReceiptForTest = items => purchaseReceiptMarkup(items);`, context);
  return context.renderReceiptForTest(items);
}

function receiptItem(overrides = {}) {
  return {
    id: 'stk-1', batchId: 'buy-2026-test', date: '2026-09-17', customerName: 'Walk-in Customer',
    paymentMethod: 'Cash', staff: 'AMLC', metal: 'Gold', karat: '18K', itemType: 'Scrap',
    netWeight: 1, rate: 6571, payout: 6571, ...overrides,
  };
}

test('thermal receipt measures a compact upright page instead of using an invalid auto page length', async () => {
  const [indexSource, appSource] = await Promise.all([readFile(indexPath, 'utf8'), readFile(appPath, 'utf8')]);
  assert.match(appSource, /function measureThermalReceiptHeight/);
  assert.match(appSource, /getBoundingClientRect\(\)\.height \* 25\.4 \/ 96 \+ 2/);
  assert.match(appSource, /@page\{size:\$\{paperWidth\}mm \$\{receiptHeight\}mm;margin:0\}/);
  assert.doesNotMatch(appSource, /@page\{size:\$\{paperWidth\}mm auto/);
  assert.match(appSource, /writing-mode:horizontal-tb!important;direction:ltr!important/);
  assert.match(appSource, /transform:none!important;rotate:none!important/);
  assert.match(appSource, /height:auto;min-height:0;margin:0!important;padding:0!important/);
  assert.match(appSource, /height:auto;min-height:0;margin:0!important/);
  assert.doesNotMatch(appSource, /rotate\((?:90|-90)deg\)/);
  assert.match(indexSource, /body\.printing-thermal-receipt #purchase_receipt_modal\{[^}]*display:block;[^}]*height:auto;[^}]*min-height:0/);
});

test('print button uses a top-aligned receipt-only document instead of the centered application modal', async () => {
  const appSource = await readFile(appPath, 'utf8');
  assert.match(appSource, /function thermalReceiptPrintDocument/);
  assert.match(appSource, /window\.open\(['"]['"]\s*,\s*['"]zpp_thermal_receipt['"]/);
  assert.match(appSource, /html,body\{width:\$\{paperWidth\}mm;height:auto;min-height:0;margin:0!important;padding:0!important/);
  assert.match(appSource, /\.thermal-receipt\{width:\$\{receiptWidth\}mm;height:auto;min-height:0;margin:0!important/);
  assert.match(appSource, /const receiptWidth\s*=\s*paperWidth\s*===\s*80\s*\?\s*72\s*:\s*48/);
  assert.doesNotMatch(appSource.slice(appSource.indexOf('function printPurchaseReceipt'), appSource.indexOf('/* ============================= INVENTORY')), /document\.body\.classList\.add\(['"]printing-thermal-receipt/);
});

test('receipt paper selector remembers the configured 58 mm or 80 mm printer width', async () => {
  const appSource = await readFile(appPath, 'utf8');
  assert.match(appSource, /localStorage\.setItem\(['"]thermalReceiptPaperWidth['"]/);
  assert.match(appSource, /localStorage\.getItem\(['"]thermalReceiptPaperWidth['"]/);
  assert.match(appSource, /58 mm \(VOZY P50\)/);
});

test('receipt has fixed description, quantity, weight, and amount columns', async () => {
  const [indexSource, markup] = await Promise.all([readFile(indexPath, 'utf8'), receiptMarkup([receiptItem()])]);
  assert.match(markup, /ITEM \/ DESCRIPTION/);
  assert.match(markup, /<th>QTY<\/th><th>WEIGHT<\/th><th>AMOUNT<\/th>/);
  assert.match(markup, /class="receipt-description">Gold 18K · Scrap/);
  assert.match(markup, /class="receipt-item-rate">Rate: PHP 6,571\/g/);
  assert.match(markup, /class="receipt-qty">1<\/td>/);
  assert.match(markup, /class="receipt-weight">1g<\/td>/);
  assert.match(markup, /class="receipt-amount">6,571<\/td>/);
  assert.match(indexSource, /\.receipt-items\{[^}]*table-layout:fixed/);
  assert.match(indexSource, /\.receipt-description\{[^}]*overflow-wrap:anywhere/);
  assert.match(indexSource, /\.receipt-qty,[^}]*text-align:right;white-space:nowrap/);
});

test('single-item receipt preserves transaction, payment, and footer data compactly', async () => {
  const markup = await receiptMarkup([receiptItem()]);
  assert.match(markup, /ZP GOLD &amp; SILVER/);
  assert.match(markup, /Customer:<\/span><strong>Walk-in Customer<\/strong>/);
  assert.match(markup, /Transaction No\.:<\/span><strong>buy-2026-test<\/strong>/);
  assert.match(markup, /<span>TOTAL<\/span><span>PHP 6,571<\/span>/);
  assert.match(markup, /<span>PAID:<\/span><strong>PHP 6,571<\/strong>/);
  assert.match(markup, /<span>CHANGE:<\/span><strong>PHP 0<\/strong>/);
  assert.match(markup, /<span>METHOD:<\/span><strong>Cash<\/strong>/);
  assert.match(markup, /Thank you!/);
  assert.doesNotMatch(markup, /<footer/);
});

test('six items, long descriptions, decimal weights, and large totals keep separate aligned cells', async () => {
  const items = Array.from({ length: 6 }, (_, index) => receiptItem({
    id: `stk-${index + 1}`,
    itemType: index === 2 ? 'Very long assorted jewelry description that must wrap safely' : 'Scrap',
    netWeight: index === 0 ? 0.13 : 1234.5 + index,
    payout: index === 5 ? 1234567 : 10000 * (index + 1),
  }));
  const markup = await receiptMarkup(items);
  assert.equal((markup.match(/<tr class="receipt-item">/g) || []).length, 6);
  assert.match(markup, /Very long assorted jewelry description that must wrap safely<small class="receipt-item-rate">Rate: PHP 6,571\/g<\/small><\/td><td class="receipt-qty">1/);
  assert.match(markup, /class="receipt-weight">0\.13g<\/td>/);
  assert.match(markup, /class="receipt-weight">1,235\.5g<\/td>/);
  assert.match(markup, /class="receipt-amount">1,234,567<\/td>/);
  assert.match(markup, /<span>TOTAL<\/span><span>PHP 1,384,567<\/span>/);
});

test('58 mm receipt keeps padding inside the paper and uses strong black print text', async () => {
  const source = await readFile(indexPath, 'utf8');
  assert.match(source, /\.thermal-receipt\{[^}]*box-sizing:border-box;[^}]*width:58mm;[^}]*height:auto;[^}]*padding:5mm/);
  assert.match(source, /body\.printing-thermal-receipt \.thermal-receipt\.paper-80\{[^}]*height:auto;[^}]*color:#000;[^}]*font-family:"Courier New",Courier,monospace;[^}]*font-weight:700/);
  assert.match(source, /print-color-adjust:exact/);
});
