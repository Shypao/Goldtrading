import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const parentDirectory = path.resolve(currentDirectory, '..');
const projectDirectory = fs.existsSync(path.join(parentDirectory, 'public'))
  ? parentDirectory
  : path.resolve(parentDirectory, '..');
const publicDirectory = path.join(projectDirectory, 'public');
const isVercel = Boolean(process.env.VERCEL);
const dataDirectory = isVercel ? path.join('/tmp', 'zpp-gold-trading') : path.join(projectDirectory, 'data');
const databaseFile = path.join(dataDirectory, 'zpp-gold-trading.db');
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
}
interface GoldApiResponse { price: number }
interface ExchangeApiResponse { rates?: { PHP?: number } }
type UserRole = 'admin' | 'staff';
interface AuthUser { id: string; username: string; displayName: string; role: UserRole }

fs.mkdirSync(dataDirectory, { recursive: true });
const database = new DatabaseSync(databaseFile);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS liquidations (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS refining_batches (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS retail_sales (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pricing_history (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'staff')),
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
`);

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

function purgeStoredInventoryLocations(): void {
  const rows=database.prepare('SELECT id, data FROM inventory').all() as Array<{ id: string; data: string }>;
  const cleaned=rows.map(row=>({id:row.id,record:JSON.parse(row.data) as LedgerRecord}));
  if (!removeInventoryLocationFields(cleaned.map(row=>row.record))) return;
  database.exec('BEGIN IMMEDIATE');
  try {
    const update=database.prepare('UPDATE inventory SET data = ? WHERE id = ?');
    for (const row of cleaned) update.run(JSON.stringify(row.record),row.id);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

purgeStoredInventoryLocations();

const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const sessionSecret = process.env.ZPP_SESSION_SECRET ?? process.env.ZPP_ADMIN_PASSWORD ?? 'zpp-local-session-secret-change-in-production';

function passwordDigest(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

function createUser(username: string, displayName: string, role: UserRole, password: string): AuthUser {
  const normalized = username.trim().toLowerCase();
  const salt = randomBytes(16).toString('hex');
  const id = `usr_${randomBytes(8).toString('hex')}`;
  database.prepare(`INSERT INTO users (id, username, display_name, role, password_hash, salt, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, normalized, displayName.trim(), role, passwordDigest(password, salt), salt, new Date().toISOString());
  return { id, username: normalized, displayName: displayName.trim(), role };
}

function ensureDefaultUsers(): void {
  const count = Number((database.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count);
  if (count) return;
  createUser('admin', 'Administrator', 'admin', process.env.ZPP_ADMIN_PASSWORD ?? 'Admin@123');
  createUser('staff', 'Sample Staff', 'staff', process.env.ZPP_STAFF_PASSWORD ?? 'Staff@123');
}

ensureDefaultUsers();

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

function sessionUser(request: IncomingMessage): AuthUser | null {
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
  const account = database.prepare('SELECT username, display_name AS displayName, role, active FROM users WHERE id = ?').get(session.userId) as {
    username: string; displayName: string; role: UserRole; active: number;
  } | undefined;
  if (!account?.active) return null;
  return { id: session.userId, username: account.username, displayName: account.displayName, role: account.role };
}

function publicStateFor(user: AuthUser): LedgerState {
  const state = loadState();
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

function saveStaffAdditions(candidate: LedgerState): void {
  const current = loadState();
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
  database.exec('BEGIN IMMEDIATE');
  try {
    const insertCustomer = database.prepare('INSERT INTO customers (id, data) VALUES (?, ?)');
    const insertStock = database.prepare('INSERT INTO inventory (id, data) VALUES (?, ?)');
    for (const record of newCustomers) insertCustomer.run(record.id, JSON.stringify(record));
    for (const record of newStock) insertStock.run(record.id, JSON.stringify(record));
    database.prepare("UPDATE settings SET value = ? WHERE key = 'pricing'").run(JSON.stringify(nextPricing));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function loadState(): LedgerState {
  const state = {} as LedgerState;
  for (const [key, table] of Object.entries(tableMap) as Array<[keyof typeof tableMap, string]>) {
    state[key] = database.prepare(`SELECT data FROM ${table}`).all()
      .map(row => JSON.parse(String((row as { data: string }).data))) as never;
  }
  const pricingRow = database.prepare("SELECT value FROM settings WHERE key = 'pricing'").get() as { value: string } | undefined;
  state.pricing = pricingRow ? JSON.parse(pricingRow.value) as PricingSettings | null : null;
  removeInventoryLocationFields(state.stock);
  return state;
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

function saveState(state: LedgerState): void {
  removeInventoryLocationFields(state.stock);
  validateLedgerIntegrity(state);
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const [key, table] of Object.entries(tableMap) as Array<[keyof typeof tableMap, string]>) {
      database.exec(`DELETE FROM ${table}`);
      const insert = database.prepare(`INSERT INTO ${table} (id, data) VALUES (?, ?)`);
      for (const record of state[key] as LedgerRecord[]) {
        if (!record.id) throw new Error(`${key} contains a record without an id`);
        insert.run(record.id, JSON.stringify(record));
      }
    }
    database.prepare("INSERT INTO settings (key, value) VALUES ('pricing', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(state.pricing));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
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

function applyMarketProposal(proposal: Awaited<ReturnType<typeof createMarketProposal>>): void {
  const state = loadState();
  if (!state.pricing) return;
  const pricing = state.pricing as Record<string, any>;
  pricing.gold.base = proposal.draft.gold;
  pricing.silver.base = proposal.draft.silver;
  pricing.platinum.base = proposal.draft.platinum;
  pricing.effectiveDate = proposal.effectiveDate;
  pricing.auto = { ...(pricing.auto ?? {}), lastFetchDate: proposal.effectiveDate, lastAppliedDate: proposal.effectiveDate,
    lastFetchedAt: proposal.fetchedAt, marketPhp: proposal.marketPhp, goldSource: proposal.goldSource, draft: null };
  database.prepare("UPDATE settings SET value = ? WHERE key = 'pricing'").run(JSON.stringify(pricing));
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
    if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { ok: true, database: databaseFile });
    if (request.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJsonBody(request) as Record<string, unknown>;
      const username = String(body.username ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const row = database.prepare(`SELECT id, username, display_name, role, password_hash, salt, active
        FROM users WHERE username = ?`).get(username) as {
          id: string; username: string; display_name: string; role: UserRole;
          password_hash: string; salt: string; active: number;
        } | undefined;
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
      const user = sessionUser(request);
      return user ? sendJson(response, 200, { authenticated: true, user }) : sendJson(response, 401, { authenticated: false });
    }
    const user = sessionUser(request);
    if (url.pathname.startsWith('/api/') && !user) return sendJson(response, 401, { error: 'Sign in required' });
    if (request.method === 'GET' && url.pathname === '/api/state') return sendJson(response, 200, publicStateFor(user!));
    if (request.method === 'POST' && url.pathname === '/api/admin/verify') {
      const body = await readJsonBody(request) as Record<string, unknown>;
      const username = String(body.username ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const row = database.prepare(`SELECT id, username, display_name, role, password_hash, salt, active
        FROM users WHERE username = ?`).get(username) as {
          id: string; username: string; display_name: string; role: UserRole;
          password_hash: string; salt: string; active: number;
        } | undefined;
      const suppliedHash = row ? passwordDigest(password, row.salt) : passwordDigest(password, 'invalid-admin-verification-salt');
      const valid = Boolean(row?.active && row.role === 'admin' &&
        timingSafeEqual(Buffer.from(suppliedHash, 'hex'), Buffer.from(row.password_hash, 'hex')));
      if (!valid || !row) return sendJson(response, 401, { error: 'Invalid administrator username or password' });
      return sendJson(response, 200, { verified: true, admin: { id: row.id, username: row.username, displayName: row.display_name } });
    }
    if (request.method === 'PUT' && url.pathname === '/api/state') {
      const body = await readJsonBody(request);
      if (!isLedgerState(body)) return sendJson(response, 400, { error: 'Invalid ledger state' });
      if (user!.role === 'admin') saveState(body);
      else {
        try { saveStaffAdditions(body); }
        catch (error) { return sendJson(response, 403, { error: error instanceof Error ? error.message : 'Staff action is not permitted' }); }
      }
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/api/market') {
      const proposal = await createMarketProposal();
      if (url.searchParams.get('apply') === '1') applyMarketProposal(proposal);
      return sendJson(response, 200, proposal);
    }
    if (request.method === 'GET' && url.pathname === '/api/users') {
      if (user!.role !== 'admin') return sendJson(response, 403, { error: 'Administrator access required' });
      const users = database.prepare(`SELECT id, username, display_name AS displayName, role, active, created_at AS createdAt
        FROM users ORDER BY role, display_name`).all();
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
        const created = createUser(username, displayName, role, password);
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
      const target = database.prepare(`SELECT id, username, display_name AS displayName, role, active, created_at AS createdAt
        FROM users WHERE id = ?`).get(targetId) as {
          id: string; username: string; displayName: string; role: UserRole; active: number; createdAt: string;
        } | undefined;
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
        const activeAdminCount = Number((database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").get() as { count: number }).count);
        if (activeAdminCount <= 1) return sendJson(response, 400, { error: 'At least one active administrator is required' });
      }
      if (password) {
        const salt = randomBytes(16).toString('hex');
        database.prepare('UPDATE users SET display_name = ?, role = ?, active = ?, password_hash = ?, salt = ? WHERE id = ?')
          .run(displayName, role, active, passwordDigest(password, salt), salt, targetId);
      } else {
        database.prepare('UPDATE users SET display_name = ?, role = ?, active = ? WHERE id = ?')
          .run(displayName, role, active, targetId);
      }
      return sendJson(response, 200, { user: { id: target.id, username: target.username, displayName, role, active: Boolean(active), createdAt: target.createdAt } });
    }
    if (request.method === 'DELETE' && userEditMatch) {
      if (user!.role !== 'admin') return sendJson(response, 403, { error: 'Administrator access required' });
      const targetId = decodeURIComponent(userEditMatch[1]);
      const target = database.prepare('SELECT id, username, role, active FROM users WHERE id = ?').get(targetId) as {
        id: string; username: string; role: UserRole; active: number;
      } | undefined;
      if (!target) return sendJson(response, 404, { error: 'Account not found' });
      if (target.id === user!.id) return sendJson(response, 400, { error: 'You cannot delete the account currently signed in' });
      if (target.role === 'admin' && target.active) {
        const activeAdminCount = Number((database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").get() as { count: number }).count);
        if (activeAdminCount <= 1) return sendJson(response, 400, { error: 'At least one active administrator is required' });
      }
      database.prepare('DELETE FROM users WHERE id = ?').run(targetId);
      return sendJson(response, 200, { ok: true, deletedUser: target.username });
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveFile(response, 'index.html', 'text/html; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/app.js') return serveFile(response, 'app.js', 'text/javascript; charset=utf-8');
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
    console.log(`SQLite database: ${databaseFile}`);
  });
}
