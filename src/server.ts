import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(currentDirectory, '..');
const publicDirectory = path.join(projectDirectory, 'public');
const dataDirectory = path.join(projectDirectory, 'data');
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
`);

const tableMap = {
  customers: 'customers',
  stock: 'inventory',
  liquidations: 'liquidations',
  refiningBatches: 'refining_batches',
  retailSales: 'retail_sales',
  pricingHistory: 'pricing_history'
} as const;

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
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

function loadState(): LedgerState {
  const state = {} as LedgerState;
  for (const [key, table] of Object.entries(tableMap) as Array<[keyof typeof tableMap, string]>) {
    state[key] = database.prepare(`SELECT data FROM ${table}`).all()
      .map(row => JSON.parse(String((row as { data: string }).data))) as never;
  }
  const pricingRow = database.prepare("SELECT value FROM settings WHERE key = 'pricing'").get() as { value: string } | undefined;
  state.pricing = pricingRow ? JSON.parse(pricingRow.value) as PricingSettings | null : null;
  return state;
}

function saveState(state: LedgerState): void {
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

async function createMarketProposal(payoutPercentage: number) {
  const [gold, silver, platinum, exchange] = await Promise.all([
    fetchJson<GoldApiResponse>('https://api.gold-api.com/price/XAU'),
    fetchJson<GoldApiResponse>('https://api.gold-api.com/price/XAG'),
    fetchJson<GoldApiResponse>('https://api.gold-api.com/price/XPT'),
    fetchJson<ExchangeApiResponse>('https://open.er-api.com/v6/latest/USD')
  ]);
  const usdPhp = Number(exchange.rates?.PHP);
  const spotUsd = { Gold: Number(gold.price), Silver: Number(silver.price), Platinum: Number(platinum.price) };
  if (!usdPhp || Object.values(spotUsd).some(value => !value)) throw new Error('Incomplete market response');
  const safePercentage = Math.max(0, Math.min(100, payoutPercentage));
  const factor = safePercentage / 100;
  const perGram = (price: number) => +(price * usdPhp / gramsPerTroyOunce * factor).toFixed(2);
  const now = new Date();
  const effectiveDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  return {
    effectiveDate, fetchedAt: now.toISOString(), payoutPct: safePercentage, usdPhp, spotUsd,
    draft: { effectiveDate, gold: perGram(spotUsd.Gold), silver: perGram(spotUsd.Silver), platinum: perGram(spotUsd.Platinum) }
  };
}

function serveFile(response: ServerResponse, filename: string, contentType: string): void {
  const filepath = path.join(publicDirectory, filename);
  if (!fs.existsSync(filepath)) return sendJson(response, 404, { error: 'File not found' });
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  fs.createReadStream(filepath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { ok: true, database: databaseFile });
    if (request.method === 'GET' && url.pathname === '/api/state') return sendJson(response, 200, loadState());
    if (request.method === 'PUT' && url.pathname === '/api/state') {
      const body = await readJsonBody(request);
      if (!isLedgerState(body)) return sendJson(response, 400, { error: 'Invalid ledger state' });
      saveState(body);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/api/market') {
      return sendJson(response, 200, await createMarketProposal(Number(url.searchParams.get('payoutPct') ?? 94)));
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveFile(response, 'index.html', 'text/html; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/app.js') return serveFile(response, 'app.js', 'text/javascript; charset=utf-8');
    return sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: error instanceof Error ? error.message : 'Server error' });
  }
});

server.listen(port, host, () => {
  console.log(`ZPP Gold Trading: http://${host}:${port}`);
  console.log(`SQLite database: ${databaseFile}`);
});
