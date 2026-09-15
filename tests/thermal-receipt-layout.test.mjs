import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexPath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../public/app.js', import.meta.url);

test('thermal receipt width includes its padding so printed totals are not clipped', async () => {
  const source = await readFile(indexPath, 'utf8');

  assert.match(
    source,
    /\.thermal-receipt\{[^}]*box-sizing:border-box;[^}]*width:58mm;[^}]*padding:5mm;/,
    'receipt padding must remain inside the selected thermal paper width',
  );
  assert.match(
    source,
    /body\.printing-thermal-receipt \.thermal-receipt,[\s\S]*?width:100%;[^}]*padding:1mm;/,
    'print layout should fill only the printable page area',
  );
});

test('58 mm receipts keep all text inside the VOZY P50 print-head boundary', async () => {
  const source = await readFile(appPath, 'utf8');

  assert.match(source, /const receiptWidth = paperWidth === 80 \? 80 : 46;/);
  assert.match(source, /const paperPadding = paperWidth === 80 \? 4 : 2;/);
  assert.match(
    source,
    /@page\{size:\$\{paperWidth\}mm auto;margin:0\}/,
    'the receipt page should use the full selected roll width',
  );
  assert.match(
    source,
    /width:\$\{receiptWidth\}mm;padding:\$\{paperPadding\}mm/,
    'the 58 mm profile should leave a 2 mm guard inside the 48 mm print head',
  );
  assert.match(source, /\.receipt-calc\{font-size:\$\{paperWidth === 80 \? 10 : 9\}px;white-space:nowrap\}/);
  assert.match(source, /\.receipt-total\{font-size:\$\{paperWidth === 80 \? 14 : 12\}px;gap:6px\}/);
});

test('thermal receipt print text uses strong black strokes', async () => {
  const source = await readFile(indexPath, 'utf8');

  assert.match(
    source,
    /body\.printing-thermal-receipt \.thermal-receipt\.paper-80\{[^}]*color:#000;[^}]*font-family:"Courier New",Courier,monospace;[^}]*font-weight:700;[^}]*print-color-adjust:exact;/,
  );
  assert.match(
    source,
    /body\.printing-thermal-receipt \.receipt-shop,[\s\S]*?\.receipt-meta strong\{font-weight:900;\}/,
  );
});
