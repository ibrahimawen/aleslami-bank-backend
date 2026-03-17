import { getDb, execSql } from './instance.js';
export function initializeSchema() {
    const db = getDb();
    // Create transactions table with all 35 fields + settlement columns
    execSql(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT UNIQUE NOT NULL,
      contract TEXT,
      timestamp INTEGER,
      amount_requested REAL,
      final_amount REAL,
      type_code TEXT,
      availableBalance REAL,
      iban TEXT,
      uuid TEXT,
      accountId TEXT,
      company_current_accountId TEXT,
      company_margin_accountId TEXT,
      customerId TEXT,
      companyId TEXT,
      deposit_type TEXT,
      lyd_ft TEXT,
      usd_ft TEXT,
      ac_charge REAL,
      transfer_exchange_rate REAL,
      cash_exchange_rate REAL,
      fcms_rate REAL,
      approved_at TEXT,
      created_at_original TEXT,
      today TEXT,
      lyd_payment_status INTEGER,
      usd_payment_status INTEGER,
      ac_charge_status INTEGER,
      error1 TEXT,
      error2 TEXT,
      approved INTEGER,
      processed INTEGER,
      rejected INTEGER,
      charge INTEGER,
      charge_status_code TEXT,
      usd_payment_date TEXT,
      computed_status TEXT,
      settlement_stage TEXT DEFAULT 'created',
      settlement_stage_updated_at TEXT,
      settlement_batch_id INTEGER
    );
  `);
    // Add settlement columns to existing transactions table (safe migration)
    try {
        execSql(`ALTER TABLE transactions ADD COLUMN settlement_stage TEXT DEFAULT 'created'`);
    }
    catch (e) { /* column already exists */ }
    try {
        execSql(`ALTER TABLE transactions ADD COLUMN settlement_stage_updated_at TEXT`);
    }
    catch (e) { /* column already exists */ }
    try {
        execSql(`ALTER TABLE transactions ADD COLUMN settlement_batch_id INTEGER`);
    }
    catch (e) { /* column already exists */ }
    // Create indexes on frequently queried columns
    execSql(`
    CREATE INDEX IF NOT EXISTS idx_transactions_companyId ON transactions(companyId);
    CREATE INDEX IF NOT EXISTS idx_transactions_today ON transactions(today);
    CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference);
    CREATE INDEX IF NOT EXISTS idx_transactions_computed_status ON transactions(computed_status);
    CREATE INDEX IF NOT EXISTS idx_transactions_settlement_stage ON transactions(settlement_stage);
    CREATE INDEX IF NOT EXISTS idx_transactions_settlement_batch_id ON transactions(settlement_batch_id);
  `);
    // Create users table
    execSql(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('bank_admin', 'company_user')),
      company_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
    // Create audit_log table
    execSql(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      metadata TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
    // Create index on audit_log
    execSql(`
    CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
  `);
    // Create purchase_rates table (legacy - kept for backward compatibility)
    execSql(`
    CREATE TABLE IF NOT EXISTS purchase_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rate REAL NOT NULL,
      effective_date TEXT NOT NULL UNIQUE,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
  `);
    // Create index on purchase_rates
    execSql(`
    CREATE INDEX IF NOT EXISTS idx_purchase_rates_date ON purchase_rates(effective_date);
  `);
    // ============================================
    // Settlement System Tables
    // ============================================
    // Settlements table - groups transactions into settlement batches
    execSql(`
    CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_reference TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'completed', 'archived')),
      created_at TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      completed_at TEXT,
      completed_by INTEGER,
      total_transactions INTEGER DEFAULT 0,
      total_usd_amount REAL DEFAULT 0,
      total_lyd_settled REAL DEFAULT 0,
      total_profit REAL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(completed_by) REFERENCES users(id)
    );
  `);
    execSql(`
    CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);
    CREATE INDEX IF NOT EXISTS idx_settlements_created_at ON settlements(created_at);
  `);
    // Settlement transactions - links transactions to settlement batches
    execSql(`
    CREATE TABLE IF NOT EXISTS settlement_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_id INTEGER NOT NULL,
      transaction_id INTEGER NOT NULL,
      settlement_status TEXT DEFAULT 'pending' CHECK(settlement_status IN ('pending', 'confirmed', 'rejected', 'settled')),
      profit_calculated REAL DEFAULT 0,
      sell_rate_used REAL,
      central_rate_used REAL,
      added_at TEXT NOT NULL,
      FOREIGN KEY(settlement_id) REFERENCES settlements(id),
      FOREIGN KEY(transaction_id) REFERENCES transactions(id)
    );
  `);
    execSql(`
    CREATE INDEX IF NOT EXISTS idx_settlement_transactions_settlement_id ON settlement_transactions(settlement_id);
    CREATE INDEX IF NOT EXISTS idx_settlement_transactions_transaction_id ON settlement_transactions(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_settlement_transactions_status ON settlement_transactions(settlement_status);
  `);
    // Settlement ledger - financial records (debit/credit)
    execSql(`
    CREATE TABLE IF NOT EXISTS settlement_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('debit', 'credit')),
      account_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'LYD',
      description TEXT,
      reference TEXT,
      entry_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by INTEGER,
      FOREIGN KEY(settlement_id) REFERENCES settlements(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
  `);
    execSql(`
    CREATE INDEX IF NOT EXISTS idx_settlement_ledger_settlement_id ON settlement_ledger(settlement_id);
    CREATE INDEX IF NOT EXISTS idx_settlement_ledger_entry_type ON settlement_ledger(entry_type);
    CREATE INDEX IF NOT EXISTS idx_settlement_ledger_entry_date ON settlement_ledger(entry_date);
  `);
    // Exchange rates daily - consolidated 5-type rate system
    execSql(`
    CREATE TABLE IF NOT EXISTS exchange_rates_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      effective_date TEXT NOT NULL UNIQUE,
      central_bank_rate REAL NOT NULL,
      sell_rate REAL,
      transfer_rate REAL,
      cash_rate REAL,
      settlement_rate REAL,
      created_at TEXT NOT NULL,
      created_by INTEGER,
      updated_at TEXT,
      updated_by INTEGER,
      notes TEXT,
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(updated_by) REFERENCES users(id)
    );
  `);
    execSql(`
    CREATE INDEX IF NOT EXISTS idx_exchange_rates_daily_date ON exchange_rates_daily(effective_date);
  `);
    // Settlement stage history - audit trail for stage transitions
    execSql(`
    CREATE TABLE IF NOT EXISTS settlement_stage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      from_stage TEXT,
      to_stage TEXT NOT NULL,
      transitioned_at TEXT NOT NULL,
      transitioned_by INTEGER,
      reason TEXT,
      FOREIGN KEY(transaction_id) REFERENCES transactions(id),
      FOREIGN KEY(transitioned_by) REFERENCES users(id)
    );
  `);
    execSql(`
    CREATE INDEX IF NOT EXISTS idx_settlement_stage_history_transaction_id ON settlement_stage_history(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_settlement_stage_history_transitioned_at ON settlement_stage_history(transitioned_at);
  `);
}
