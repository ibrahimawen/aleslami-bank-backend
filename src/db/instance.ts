import initSqlJs, { Database } from 'sql.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default path (used in dev mode), can be overridden via setDbPath()
let dbPath = join(__dirname, '..', '..', 'serafa.db');

let db: Database;
let SQL: any;

/**
 * Set custom database path (used by Electron to point to AppData)
 */
export function setDbPath(customPath: string): void {
  // Ensure directory exists
  const dir = dirname(customPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  dbPath = customPath;
}

/**
 * Get current database file path
 */
export function getDbPath(): string {
  return dbPath;
}

export async function initDatabase(customDbPath?: string): Promise<Database> {
  if (customDbPath) {
    setDbPath(customDbPath);
  }

  SQL = await initSqlJs();

  if (existsSync(dbPath)) {
    const fileBuffer = readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  return db;
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export function saveDb(): void {
  if (!db) throw new Error('Database not initialized');
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);
}

// Helper query functions
export function queryAll(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function queryOne(sql: string, params: any[] = []): any | null {
  const results = queryAll(sql, params);
  return results[0] || null;
}

export function runSql(sql: string, params: any[] = []): void {
  db.run(sql, params);
}

export function execSql(sql: string): void {
  db.exec(sql);
}

export default getDb;
