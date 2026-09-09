import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createClient, type Client, type InStatement } from '@libsql/client/web';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const parentDirectory = path.resolve(currentDirectory, '..');
const projectDirectory = fs.existsSync(path.join(parentDirectory, 'public'))
  ? parentDirectory
  : path.resolve(parentDirectory, '..');
const publicDirectory = path.join(projectDirectory, 'public');
const isVercel = Boolean(process.env.VERCEL);
const dataDirectory = isVercel ? path.join('/tmp', 'zpp-gold-trading') : path.join(projectDirectory, 'data');
const databaseFile = path.join(dataDirectory, 'zpp-gold-trading.db');
const tursoDatabaseUrl = process.env.TURSO_DATABASE_URL?.trim() ?? '';
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN?.trim() ?? '';
const usesTurso = Boolean(tursoDatabaseUrl);
const host = '127.0.0.1';
const port = Number(process.env.ZPP_PORT ?? 4177);
const gramsPerTroyOunce = 31.1034768;

interface LedgerRecord { id: string; [key: string]: unknown }
interface PricingSettings { [key: string]: unknown }
interface LedgerState {
  customers: LedgerRecord[];
  stock: LedgerRecord[];
  liquidations: LedgerRecord[];
  refiningBatches: LedgerRecord[];
  retailSales: LedgerRecord[];
  pricingHistory: LedgerRecord[];
  pricing: PricingSettings | null;
  _revision?: number;
}
interface GoldApiResponse { price: number }
interface ExchangeApiResponse { rates?: { PHP?: number } }
type UserRole = 'admin' | 'staff';
interface AuthUser { id: string; username: string; displayName: string; role: UserRole }

if (!usesTurso) fs.mkdirSync(dataDirectory, { recursive: true });
const localDatabase = usesTurso ? null : new DatabaseSync(databaseFile);
const tursoClient: Client | null = usesTurso ? createClient({ url: tursoDatabaseUrl, authToken: tursoAuthToken }) : null;
const schemaStatements = [
  'CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS liquidations (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS refining_batches (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS retail_sales (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS pricing_history (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'staff')),
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`
];

type SqlArgs = Array<string | number | null>;
type SqlStatement = { sql: string; args?: SqlArgs };

async function dbRun(sql: string, args: SqlArgs = []): Promise<void> {
  if (tursoClient) { await tursoClient.execute({ sql, args }); return; }
  localDatabase!.prepare(sql).run(...args);
}

async function dbAll<T>(sql: string, args: SqlArgs = []): Promise<T[]> {
  if (tursoClient) return (await tursoClient.execute({ sql, args })).rows as unknown as T[];
  return localDatabase!.prepare(sql).all(...args) as unknown as T[];
}

async function dbGet<T>(sql: string, args: SqlArgs = []): Promise<T | undefined> {
  if (tursoClient) return (await tursoClient.execute({ sql, args })).rows[0] as unknown as T | undefined;
  return localDatabase!.prepare(sql).get(...args) as unknown as T | undefined;
}

async function dbBatch(statements: SqlStatement[]): Promise<void> {
  if (tursoClient) {
    await tursoClient.batch(statements.map(statement => ({ sql: statement.sql, args: statement.args ?? [] }) as InStatement), 'write');
    return;
  }
  localDatabase!.exec('BEGIN IMMEDIATE');
  try {
    for (const statement of statements) localDatabase!.prepare(statement.sql).run(...(statement.args ?? []));
    localDatabase!.exec('COMMIT');
  } catch (error) {
    localDatabase!.exec('ROLLBACK');
    throw error;
  }
}

function removeInventoryLocationFields(records: LedgerRecord[]): boolean {
  let changed=false;
  for (const record of records) {
    if (Object.prototype.hasOwnProperty.call(record, 'location')) {
      delete record.location;
      changed=true;
    }
  }
  return changed;
}

async function purgeStoredInventoryLocations(): Promise<void> {
  const rows = await dbAll<{ id: string; data: string }>('SELECT id, data FROM inventory');
  const cleaned=rows.map(row=>({id:row.id,record:JSON.parse(row.data) as LedgerRecord}));
  if (!removeInventoryLocationFields(cleaned.map(row=>row.record))) return;
  await dbBatch(cleaned.map(row => ({
    sql: 'UPDATE inventory SET data = ? WHERE id = ?',
    args: [JSON.stringify(row.record), row.id]
  })));
}

const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const sessionSecret = process.env.ZPP_SESSION_SECRET ?? process.env.ZPP_ADMIN_PASSWORD ?? 'zpp-local-session-secret-change-in-production';

function passwordDigest(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

async function createUser(username: string, displayName: string, role: UserRole, password: string): Promise<AuthUser> {
  const normalized = username.trim().toLowerCase();
  const salt = randomBytes(16).toString('hex');
  const id = `usr_${randomBytes(8).toString('hex')}`;
  await dbRun(`INSERT INTO users (id, username, display_name, role, password_hash, salt, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  [id, normalized, displayName.trim(), role, passwordDigest(password, salt), salt, new Date().toISOString()]);
  return { id, username: normalized, displayName: displayName.trim(), role };
}

async function ensureDefaultUsers(): Promise<void> {
  const count = Number((await dbGet<{ count: number }>('SELECT COUNT(*) AS count FROM users'))?.count ?? 0);
  if (count) return;
  await createUser('admin', 'Administrator', 'admin', process.env.ZPP_ADMIN_PASSWORD ?? 'Admin@123');
  await createUser('staff', 'Sample Staff', 'staff', process.env.ZPP_STAFF_PASSWORD ?? 'Staff@123');
}

async function initializeDatabase(): Promise<void> {
  if (tursoDatabaseUrl && !tursoAuthToken) throw new Error('TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is configured');
  if (localDatabase) {
    localDatabase.exec('PRAGMA journal_mode=WAL');
    localDatabase.exec('PRAGMA foreign_keys=ON');
  }
  for (const statement of schemaStatements) await dbRun(statement);
  await dbRun("INSERT INTO settings (key, value) VALUES ('ledger_revision', '0') ON CONFLICT(key) DO NOTHING");
  await purgeStoredInventoryLocations();
  await ensureDefaultUsers();
}

const databaseReady = initializeDatabase();

const tableMap = {
  customers: 'customers',
  stock: 'inventory',
  liquidations: 'liquidations',
  refiningBatches: 'refining_batches',
  retailSales: 'retail_sales',
  pricingHistory: 'pricing_history'
} as const;

function sendJson(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(value));
}

function cookies(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(Boolean).map(value => {
    const index = value.indexOf('=');
    return [decodeURIComponent(value.slice(0, index)), decodeURIComponent(value.slice(index + 1))];
  }));
}

function signSession(userId: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

async function sessionUser(request: IncomingMessage): Promise<AuthUser | null> {
  const token = cookies(request).zpp_session;
  if (!token) return null;
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature) return null;
  const expectedSignature = createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;
  let session: { userId: string; expiresAt: number };
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { userId: string; expiresAt: number };
  } catch {
    return null;
  }
  if (!session.userId || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
  const account = await dbGet<{
    username: string; displayName: string; role: UserRole; active: number;
  }>('SELECT username, display_name AS displayName, role, active FROM users WHERE id = ?', [session.userId]);
  if (!account?.active) return null;
  return { id: session.userId, username: account.username, displayName: account.displayName, role: account.role };
}

async function publicStateFor(user: AuthUser): Promise<LedgerState> {
  const state = await loadState();
  if (user.role === 'admin') return state;
  return { ...state, liquidations: [], refiningBatches: [], retailSales: [], pricingHistory: [] };
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
      if (body.length > 10_000_000) reject(new Error('Request is too large'));
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    request.on('error', reject);
  });
}

function isLedgerState(value: unknown): value is LedgerState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LedgerState>;
  return Object.keys(tableMap).every(key => Array.isArray(candidate[key as keyof LedgerState]));
}

function unchangedRecord(candidate: LedgerRecord, original: LedgerRecord): boolean {
  return JSON.stringify(candidate) === JSON.stringify(original);
}

async function saveStaffAdditions(candidate: LedgerState): Promise<void> {
  const current = await loadState();
  removeInventoryLocationFields(candidate.stock);
  if (!candidate.pricing || !current.pricing) throw new Error('Pricing settings are unavailable');
  const candidatePricing = JSON.parse(JSON.stringify(candidate.pricing)) as Record<string, any>;
  const currentPricing = JSON.parse(JSON.stringify(current.pricing)) as Record<string, any>;
  candidatePricing.gradeMultipliers = candidatePricing.gradeMultipliers ?? {};
  currentPricing.gradeMultipliers = currentPricing.gradeMultipliers ?? {};
  candidatePricing.dailyFormula = candidatePricing.dailyFormula ?? { effectiveDate: '', baseRates: {} };
  currentPricing.dailyFormula = currentPricing.dailyFormula ?? { effectiveDate: '', baseRates: {} };
  candidatePricing.dailyFormula.baseRates = candidatePricing.dailyFormula.baseRates ?? {};
  currentPricing.dailyFormula.baseRates = currentPricing.dailyFormula.baseRates ?? {};
  const permittedGrades: Record<string, Set<string>> = {
    gold: new Set(['24K', '23K', '22K', '21K', '20K', '18K', '18K-BUO', '17K', '16K', '14K', '12K', '10K', '9K', '8K', '5K', '98%', '73%']),
    silver: new Set(['999', '925', '900', '800', '750', '600']),
    platinum: new Set(['999', '950', '900', '850'])
  };
  const requestedOverrides: Record<string, Record<string, number>> = {};
  for (const metal of Object.keys(permittedGrades)) {
    requestedOverrides[metal] = candidatePricing[metal]?.overrides ?? {};
    for (const [grade, value] of Object.entries(requestedOverrides[metal])) {
      if (!permittedGrades[metal].has(grade) || !Number.isFinite(Number(value)) || Number(value) < 0) {
        throw new Error('Invalid staff rate override');
      }
      requestedOverrides[metal][grade] = Number(value);
    }
    candidatePricing[metal].overrides = {};
    currentPricing[metal].overrides = {};
  }
  if (JSON.stringify(candidatePricing) !== JSON.stringify(currentPricing)) {
    throw new Error('Staff may only change individual grade overrides');
  }
  const nextPricing = JSON.parse(JSON.stringify(current.pricing)) as Record<string, any>;
  for (const metal of Object.keys(permittedGrades)) nextPricing[metal].overrides = requestedOverrides[metal];
  const currentCustomers = new Map(current.customers.map(record => [record.id, record]));
  const currentStock = new Map(current.stock.map(record => [record.id, record]));
  if (current.customers.some(record => !candidate.customers.some(item => item.id === record.id && unchangedRecord(item, record))) ||
      current.stock.some(record => !candidate.stock.some(item => item.id === record.id && unchangedRecord(item, record)))) {
    throw new Error('Staff cannot edit or remove existing records');
  }
  const newCustomers = candidate.customers.filter(record => !currentCustomers.has(record.id));
  const newStock = candidate.stock.filter(record => !currentStock.has(record.id));
  const knownCustomerIds = new Set([...current.customers, ...newCustomers].map(record => record.id));
  for (const customer of newCustomers) {
    if (!customer.id || !String(customer.name ?? '').trim()) throw new Error('Invalid customer record');
  }
  for (const item of newStock) {
    const status = String(item.status ?? '');
    if (!item.id || (item.customerId && !knownCustomerIds.has(String(item.customerId))) ||
        !['Gold', 'Silver', 'Platinum'].includes(String(item.metal ?? '')) ||
        !['Jewelry', 'Scrap'].includes(String(item.itemType ?? '')) ||
        !['For Selling', 'For Refining', 'On Hold'].includes(status) ||
        Number(item.netWeight) <= 0 || Number(item.currentWeight) !== Number(item.netWeight) ||
        Number(item.payout) < 0 || Number(item.cost) !== Number(item.payout)) {
      throw new Error('Invalid purchase record');
    }
  }
  await dbBatch([
    ...newCustomers.map(record => ({ sql: 'INSERT INTO customers (id, data) VALUES (?, ?)', args: [record.id, JSON.stringify(record)] })),
    ...newStock.map(record => ({ sql: 'INSERT INTO inventory (id, data) VALUES (?, ?)', args: [record.id, JSON.stringify(record)] })),
    { sql: "INSERT INTO settings (key, value) VALUES ('pricing', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", args: [JSON.stringify(nextPricing)] },
    { sql: "INSERT INTO settings (key, value) VALUES ('ledger_revision', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", args: [String(Number(current._revision||0)+1)] }
  ]);
}

function buyingDraftKey(user: AuthUser): string {
  return `buying_draft:${user.id}`;
}

async function loadState(): Promise<LedgerState> {
  const state = {} as LedgerState;
  for (const [key, table] of Object.entries(tableMap) as Array<[keyof typeof tableMap, string]>) {
    state[key] = (await dbAll<{ data: string }>(`SELECT data FROM ${table}`))
      .map(row => JSON.parse(String((row as { data: string }).data))) as never;
  }
  const pricingRow = await dbGet<{ value: string }>("SELECT value FROM settings WHERE key = 'pricing'");
  state.pricing = pricingRow ? JSON.parse(pricingRow.value) as PricingSettings | null : null;
  const revisionRow = await dbGet<{ value: string }>("SELECT value FROM settings WHERE key = 'ledger_revision'");
  state._revision = Number(revisionRow?.value ?? 0);
  removeInventoryLocationFields(state.stock);
  return state;
}

class LedgerRevisionConflict extends Error {}

async function currentLedgerRevision(): Promise<number> {
  const row = await dbGet<{ value: string }>("SELECT value FROM settings WHERE key = 'ledger_revision'");
  return Number(row?.value ?? 0);
}

function validateLedgerIntegrity(state: LedgerState): void {
  const stockIds = new Set(state.stock.map(record => record.id));
  if (stockIds.size !== state.stock.length) throw new Error('Inventory contains duplicate record IDs');
  const consumedBy = new Map<string, string>();
  const claimInventory = (itemId: string, owner: string) => {
    if (!stockIds.has(itemId)) throw new Error(`${owner} references a missing inventory item`);
    const existing = consumedBy.get(itemId);
    if (existing) throw new Error(`Inventory item ${itemId} is already assigned to ${existing}`);
    consumedBy.set(itemId, owner);
  };
  for (const liquidation of state.liquidations) {
    const lines = Array.isArray(liquidation.lines) ? liquidation.lines as LedgerRecord[] : [];
    for (const line of lines) claimInventory(String(line.itemId ?? ''), `liquidation ${liquidation.id}`);
  }
  for (const batch of state.refiningBatches) {
    const itemIds = Array.isArray(batch.itemIds) ? batch.itemIds : [];
    for (const itemId of itemIds) claimInventory(String(itemId), `refining batch ${batch.id}`);
    if (batch.outputItemId && !stockIds.has(String(batch.outputItemId))) {
      throw new Error(`Refining batch ${batch.id} references a missing output inventory item`);
    }
  }
  for (const sale of state.retailSales) {
    if (sale.itemId) claimInventory(String(sale.itemId), `retail sale ${sale.id}`);
  }
}

async function saveState(state: LedgerState): Promise<void> {
  removeInventoryLocationFields(state.stock);
  validateLedgerIntegrity(state);
  const currentRevision=await currentLedgerRevision();
  if (!Number.isInteger(state._revision) || state._revision !== currentRevision) {
    throw new LedgerRevisionConflict('The ledger changed in another session. Refresh and try again.');
  }
  const nextRevision=currentRevision+1;
  const statements: SqlStatement[] = [];
  for (const [key, table] of Object.entries(tableMap) as Array<[keyof typeof tableMap, string]>) {
    statements.push({ sql: `DELETE FROM ${table}` });
    for (const record of state[key] as LedgerRecord[]) {
      if (!record.id) throw new Error(`${key} contains a record without an id`);
      statements.push({ sql: `INSERT INTO ${table} (id, data) VALUES (?, ?)`, args: [record.id, JSON.stringify(record)] });
    }
  }
  statements.push({
    sql: "INSERT INTO settings (key, value) VALUES ('pricing', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    args: [JSON.stringify(state.pricing)]
  });
  statements.push({
    sql: "INSERT INTO settings (key, value) VALUES ('ledger_revision', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    args: [String(nextRevision)]
  });
  await dbBatch(statements);
  state._revision=nextRevision;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { 'User-Agent': 'ZPP-Gold-Trading/1.0' } });
  if (!response.ok) throw new Error(`Market provider returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchPhilippineGoldPhpPerGram(): Promise<number | null> {
  try {
    const response = await fetch('https://www.livepriceofgold.com/philippines-gold-price-per-gram.html', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZPP-Gold-Trading/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const html = await response.text();
    const match = html.match(/Philippines Gold Price per Gram:\s*([\d,]+(?:\.\d+)?)\s+Philippine pesos/i);
    const value = match ? Number(match[1].replace(/,/g, '')) : 0;
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function createMarketProposal() {
  const [gold, silver, platinum, exchange, philippineGold] = await Promise.all([
    fetchJson<GoldApiResponse>('https://api.gold-api.com/price/XAU'),
    fetchJson<GoldApiResponse>('https://api.gold-api.com/price/XAG'),
    fetchJson<GoldApiResponse>('https://api.gold-api.com/price/XPT'),
    fetchJson<ExchangeApiResponse>('https://open.er-api.com/v6/latest/USD'),
    fetchPhilippineGoldPhpPerGram()
  ]);
  const usdPhp = Number(exchange.rates?.PHP);
  const spotUsd = { Gold: Number(gold.price), Silver: Number(silver.price), Platinum: Number(platinum.price) };
  if (!usdPhp || Object.values(spotUsd).some(value => !value)) throw new Error('Incomplete market response');
  const convertedPhp = (price: number) => +(price * usdPhp / gramsPerTroyOunce).toFixed(2);
  const marketPhp = {
    Gold: philippineGold ?? convertedPhp(spotUsd.Gold),
    Silver: convertedPhp(spotUsd.Silver),
    Platinum: convertedPhp(spotUsd.Platinum)
  };
  const now = new Date();
  const effectiveDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  return {
    effectiveDate, fetchedAt: now.toISOString(), marketPhp,
    goldSource: philippineGold ? 'LivePriceOfGold Philippines' : 'Converted international spot fallback',
    draft: { effectiveDate, gold: marketPhp.Gold, silver: marketPhp.Silver, platinum: marketPhp.Platinum }
  };
}

async function applyMarketProposal(proposal: Awaited<ReturnType<typeof createMarketProposal>>): Promise<void> {
  const state = await loadState();
  if (!state.pricing) return;
  const pricing = state.pricing as Record<string, any>;
  pricing.gold.base = proposal.draft.gold;
  pricing.silver.base = proposal.draft.silver;
  pricing.platinum.base = proposal.draft.platinum;
  pricing.effectiveDate = proposal.effectiveDate;
  pricing.auto = { ...(pricing.auto ?? {}), lastFetchDate: proposal.effectiveDate, lastAppliedDate: proposal.effectiveDate,
    lastFetchedAt: proposal.fetchedAt, marketPhp: proposal.marketPhp, goldSource: proposal.goldSource, draft: null };
  await dbRun("UPDATE settings SET value = ? WHERE key = 'pricing'", [JSON.stringify(pricing)]);
}

function serveFile(response: ServerResponse, filename: string, contentType: string): void {
  const filepath = path.join(publicDirectory, filename);
  if (!fs.existsSync(filepath)) return sendJson(response, 404, { error: 'File not found' });
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  fs.createReadStream(filepath).pipe(response);
}

export async function requestHandler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);
  try {
    await databaseReady;
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(response, 200, { ok: true, database: usesTurso ? 'turso' : databaseFile, persistent: usesTurso || !isVercel });
    }
    if (request.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJsonBody(request) as Record<string, unknown>;
      const username = String(body.username ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const row = await dbGet<{
          id: string; username: string; display_name: string; role: UserRole;
          password_hash: string; salt: string; active: number;
        }>(`SELECT id, username, display_name, role, password_hash, salt, active
        FROM users WHERE username = ?`, [username]);
      const suppliedHash = row ? passwordDigest(password, row.salt) : passwordDigest(password, 'invalid-login-salt');
      const valid = Boolean(row?.active &&
        timingSafeEqual(Buffer.from(suppliedHash, 'hex'), Buffer.from(row.password_hash, 'hex')));
      if (!valid || !row) return sendJson(response, 401, { error: 'Invalid username or password' });
      const user: AuthUser = { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
      const token = signSession(user.id, Date.now() + sessionLifetimeMs);
      const secure = isVercel ? '; Secure' : '';
      return sendJson(response, 200, { user }, { 'Set-Cookie': `zpp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` });
    }
    if (request.method === 'POST' && url.pathname === '/api/logout') {
      const secure = isVercel ? '; Secure' : '';
      return sendJson(response, 200, { ok: true }, { 'Set-Cookie': `zpp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}` });
    }
    if (request.method === 'GET' && url.pathname === '/api/session') {
      const user = await sessionUser(request);
      return user ? sendJson(response, 200, { authenticated: true, user }) : sendJson(response, 401, { authenticated: false });
    }
    const user = await sessionUser(request);
    if (url.pathname.startsWith('/api/') && !user) return sendJson(response, 401, { error: 'Sign in required' });
    if (request.method === 'GET' && url.pathname === '/api/state') return sendJson(response, 200, await publicStateFor(user!));
    if (request.method === 'GET' && url.pathname === '/api/buying-draft') {
      const row = await dbGet<{ value: string }>('SELECT value FROM settings WHERE key = ?', [buyingDraftKey(user!)]);
      if (!row) return sendJson(response, 200, { items: [], form: {} });
      try { return sendJson(response, 200, JSON.parse(row.value)); }
      catch { return sendJson(response, 200, { items: [], form: {} }); }
    }
    if (request.method === 'PUT' && url.pathname === '/api/buying-draft') {
      const body = await readJsonBody(request) as Record<string, unknown>;
      const items = Array.isArray(body.items) ? body.items : [];
      const form = body.form && typeof body.form === 'object' && !Array.isArray(body.form) ? body.form : {};
      if (items.length > 100 || items.some(item => !item || typeof item !== 'object')) {
        return sendJson(response, 400, { error: 'Invalid buying draft' });
      }
      await dbRun("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [buyingDraftKey(user!), JSON.stringify({ items, form })]);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'DELETE' && url.pathname === '/api/buying-draft') {
      await dbRun('DELETE FROM settings WHERE key = ?', [buyingDraftKey(user!)]);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/verify') {
      const body = await readJsonBody(request) as Record<string, unknown>;
      const username = String(body.username ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const row = await dbGet<{
          id: string; username: string; display_name: string; role: UserRole;
          password_hash: string; salt: string; active: number;
        }>(`SELECT id, username, display_name, role, password_hash, salt, active
        FROM users WHERE username = ?`, [username]);
      const suppliedHash = row ? passwordDigest(password, row.salt) : passwordDigest(password, 'invalid-admin-verification-salt');
      const valid = Boolean(row?.active && row.role === 'admin' &&
        timingSafeEqual(Buffer.from(suppliedHash, 'hex'), Buffer.from(row.password_hash, 'hex')));
      if (!valid || !row) return sendJson(response, 401, { error: 'Invalid administrator username or password' });
      return sendJson(response, 200, { verified: true, admin: { id: row.id, username: row.username, displayName: row.display_name } });
    }
    if (request.method === 'PUT' && url.pathname === '/api/state') {
      const body = await readJsonBody(request);
      if (!isLedgerState(body)) return sendJson(response, 400, { error: 'Invalid ledger state' });
      if (user!.role === 'admin') {
        try { await saveState(body); }
        catch (error) {
          if (error instanceof LedgerRevisionConflict) return sendJson(response, 409, { error: error.message });
          throw error;
        }
      }
      else {
        try { await saveStaffAdditions(body); }
        catch (error) { return sendJson(response, 403, { error: error instanceof Error ? error.message : 'Staff action is not permitted' }); }
      }
      return sendJson(response, 200, { ok: true, revision: await currentLedgerRevision() });
    }
    if (request.method === 'GET' && url.pathname === '/api/market') {
      const proposal = await createMarketProposal();
      if (url.searchParams.get('apply') === '1') await applyMarketProposal(proposal);
      return sendJson(response, 200, proposal);
    }
    if (request.method === 'GET' && url.pathname === '/api/users') {
      if (user!.role !== 'admin') return sendJson(response, 403, { error: 'Administrator access required' });
      const users = await dbAll(`SELECT id, username, display_name AS displayName, role, active, created_at AS createdAt
        FROM users ORDER BY role, display_name`);
      return sendJson(response, 200, { users });
    }
    if (request.method === 'POST' && url.pathname === '/api/users') {
      if (user!.role !== 'admin') return sendJson(response, 403, { error: 'Administrator access required' });
      const body = await readJsonBody(request) as Record<string, unknown>;
      const username = String(body.username ?? '').trim().toLowerCase();
      const displayName = String(body.displayName ?? '').trim();
      const password = String(body.password ?? '');
      const role = String(body.role ?? 'staff') as UserRole;
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) return sendJson(response, 400, { error: 'Username must be 3–40 letters, numbers, dots, dashes, or underscores' });
      if (!displayName) return sendJson(response, 400, { error: 'Display name is required' });
      if (password.length < 8) return sendJson(response, 400, { error: 'Password must be at least 8 characters' });
      if (!['admin', 'staff'].includes(role)) return sendJson(response, 400, { error: 'Role must be Admin or Staff' });
      try {
        const created = await createUser(username, displayName, role, password);
        return sendJson(response, 201, { user: created });
      } catch (error) {
        if (String(error).includes('UNIQUE')) return sendJson(response, 409, { error: 'Username already exists' });
        throw error;
      }
    }
    const userEditMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
    if (request.method === 'PATCH' && userEditMatch) {
      if (user!.role !== 'admin') return sendJson(response, 403, { error: 'Administrator access required' });
      const targetId = decodeURIComponent(userEditMatch[1]);
      const target = await dbGet<{
          id: string; username: string; displayName: string; role: UserRole; active: number; createdAt: string;
        }>(`SELECT id, username, display_name AS displayName, role, active, created_at AS createdAt
        FROM users WHERE id = ?`, [targetId]);
      if (!target) return sendJson(response, 404, { error: 'Account not found' });
      const body = await readJsonBody(request) as Record<string, unknown>;
      const displayName = String(body.displayName ?? '').trim();
      const role = String(body.role ?? '') as UserRole;
      const active = body.active === true ? 1 : body.active === false ? 0 : -1;
      const password = String(body.password ?? '');
      if (!displayName) return sendJson(response, 400, { error: 'Display name is required' });
      if (!['admin', 'staff'].includes(role)) return sendJson(response, 400, { error: 'Role must be Admin or Staff' });
      if (active < 0) return sendJson(response, 400, { error: 'Account status is required' });
      if (password && password.length < 8) return sendJson(response, 400, { error: 'New password must be at least 8 characters' });
      if (target.id === user!.id && (role !== 'admin' || !active)) {
        return sendJson(response, 400, { error: 'You cannot demote or disable the account currently signed in' });
      }
      if (target.role === 'admin' && target.active && (role !== 'admin' || !active)) {
        const activeAdminCount = Number((await dbGet<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1"))?.count ?? 0);
        if (activeAdminCount <= 1) return sendJson(response, 400, { error: 'At least one active administrator is required' });
      }
      if (password) {
        const salt = randomBytes(16).toString('hex');
        await dbRun('UPDATE users SET display_name = ?, role = ?, active = ?, password_hash = ?, salt = ? WHERE id = ?',
          [displayName, role, active, passwordDigest(password, salt), salt, targetId]);
      } else {
        await dbRun('UPDATE users SET display_name = ?, role = ?, active = ? WHERE id = ?', [displayName, role, active, targetId]);
      }
      return sendJson(response, 200, { user: { id: target.id, username: target.username, displayName, role, active: Boolean(active), createdAt: target.createdAt } });
    }
    if (request.method === 'DELETE' && userEditMatch) {
      if (user!.role !== 'admin') return sendJson(response, 403, { error: 'Administrator access required' });
      const targetId = decodeURIComponent(userEditMatch[1]);
      const target = await dbGet<{
        id: string; username: string; role: UserRole; active: number;
      }>('SELECT id, username, role, active FROM users WHERE id = ?', [targetId]);
      if (!target) return sendJson(response, 404, { error: 'Account not found' });
      if (target.id === user!.id) return sendJson(response, 400, { error: 'You cannot delete the account currently signed in' });
      if (target.role === 'admin' && target.active) {
        const activeAdminCount = Number((await dbGet<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1"))?.count ?? 0);
        if (activeAdminCount <= 1) return sendJson(response, 400, { error: 'At least one active administrator is required' });
      }
      await dbRun('DELETE FROM users WHERE id = ?', [targetId]);
      return sendJson(response, 200, { ok: true, deletedUser: target.username });
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveFile(response, 'index.html', 'text/html; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/app.js') return serveFile(response, 'app.js', 'text/javascript; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/zpp-logo.png') return serveFile(response, 'zpp-logo.png', 'image/png');
    return sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: error instanceof Error ? error.message : 'Server error' });
  }
}

export default requestHandler;

const isDirectRun = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const server = http.createServer(requestHandler);
  server.listen(port, host, () => {
    console.log(`ZPP Gold Trading: http://${host}:${port}`);
    console.log(usesTurso ? 'Database: Turso' : `SQLite database: ${databaseFile}`);
  });
}
