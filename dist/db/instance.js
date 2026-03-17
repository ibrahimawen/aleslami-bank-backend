import initSqlJs from 'sql.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Default path (used in dev mode), can be overridden via setDbPath()
let dbPath = join(__dirname, '..', '..', 'serafa.db');
let db;
let SQL;
/**
 * Set custom database path (used by Electron to point to AppData)
 */
export function setDbPath(customPath) {
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
export function getDbPath() {
    return dbPath;
}
export async function initDatabase(customDbPath) {
    if (customDbPath) {
        setDbPath(customDbPath);
    }
    SQL = await initSqlJs();
    if (existsSync(dbPath)) {
        const fileBuffer = readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
    }
    else {
        db = new SQL.Database();
    }
    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON');
    return db;
}
export function getDb() {
    if (!db)
        throw new Error('Database not initialized. Call initDatabase() first.');
    return db;
}
export function saveDb() {
    if (!db)
        throw new Error('Database not initialized');
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
}
// Helper query functions
export function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length)
        stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}
export function queryOne(sql, params = []) {
    const results = queryAll(sql, params);
    return results[0] || null;
}
export function runSql(sql, params = []) {
    db.run(sql, params);
}
export function execSql(sql) {
    db.exec(sql);
}
export default getDb;
