import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadBuyingDateApi() {
  const appPath = new URL('../public/app.js', import.meta.url);
  const source = (await readFile(appPath, 'utf8')).replace(/initializeAuth\(\);\s*$/, '');
  const context = vm.createContext({ console, Intl, Date });
  vm.runInContext(`${source}\n;globalThis.buyingDateTestApi = {
    setDraft(form, savedDate) { buyingDraftForm = form; buyingDraftSavedDate = savedDate; },
    roll: rollDefaultBuyingDraftDateForward,
    form() { return buyingDraftForm; }
  };`, context);
  return context.buyingDateTestApi;
}

test('a default date from an earlier saved day advances to today', async () => {
  const api = await loadBuyingDateApi();
  api.setDraft({ b_date: '2000-01-01', b_seller_name: 'Saved seller' }, '2000-01-01');

  assert.equal(api.roll(), true);
  assert.notEqual(api.form().b_date, '2000-01-01');
  assert.equal(api.form().b_seller_name, 'Saved seller');
});

test('an intentionally selected historical date remains unchanged', async () => {
  const api = await loadBuyingDateApi();
  api.setDraft({ b_date: '1999-12-31' }, '2000-01-01');

  assert.equal(api.roll(), false);
  assert.equal(api.form().b_date, '1999-12-31');
});
