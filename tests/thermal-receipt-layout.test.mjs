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

test('58 mm receipts use the full roll with text inside the 48 mm printable area', async () => {
  const source = await readFile(appPath, 'utf8');

  assert.match(source, /const paperPadding = paperWidth === 80 \? 4 : 5;/);
  assert.match(
    source,
    /@page\{size:\$\{paperWidth\}mm auto;margin:0\}/,
    'the receipt page should use the full selected roll width',
  );
  assert.match(
    source,
    /width:\$\{paperWidth\}mm;padding:\$\{paperPadding\}mm/,
    '58 mm paper should keep text within 5 mm internal padding on both sides',
  );
});
