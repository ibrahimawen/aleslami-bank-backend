import { getDb, initDatabase, saveDb, runSql, queryOne } from './instance.js';
import { initializeSchema } from './schema.js';
import bcryptjs from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const csvPath = join(__dirname, '..', '..', 'data.csv');

interface TransactionRecord {
  [key: string]: any;
}

/**
 * Parse CSV line handling quoted fields with commas inside
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse CSV file into array of objects
 */
function parseCSV(content: string): TransactionRecord[] {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const records: TransactionRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;

    const record: TransactionRecord = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j].trim();
      const val = values[j];
      record[key] = val === '' ? null : val;
    }
    records.push(record);
  }

  return records;
}

/**
 * Determine computed_status from raw fields
 */
function getComputedStatus(record: TransactionRecord): string {
  const rejected = parseInt(record.rejected) || 0;
  const approved = parseInt(record.approved) || 0;
  const processed = parseInt(record.processed) || 0;
  const charge = parseInt(record.charge) || 0;
  const error1 = record.error1 || '';
  const error2 = record.error2 || '';

  if (rejected === 1) return 'rejected';
  if (error1 && error1.toLowerCase().includes('insufficient')) return 'insufficient';
  if (error2 && error2.trim() !== '') return 't24_error';
  if (approved === 1 && processed === 1) return 'completed';
  if (approved === 1 && processed === 0) return 'approved';
  if (charge === 1) return 'charged';
  return 'pending';
}

/**
 * Parse numeric value, return null if empty
 */
function parseNum(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = parseFloat(val);
  return isNaN(num) ? null : num;
}

/**
 * Parse integer value, return default if empty
 */
function parseInt0(val: any, defaultVal: number = 0): number {
  if (val === null || val === undefined || val === '') return defaultVal;
  const num = parseInt(val, 10);
  return isNaN(num) ? defaultVal : num;
}

/**
 * Ensure default users exist (idempotent - uses INSERT OR IGNORE)
 */
async function seedUsers(): Promise<void> {
  console.log('Ensuring default users exist...');

  const now = new Date().toISOString();
  const salt = 12;

  // Check each user individually and create if missing
  const existingAdmin = queryOne('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!existingAdmin) {
    const adminHash = await bcryptjs.hash('admin123', salt);
    runSql(
      `INSERT INTO users (username, password_hash, role, company_id, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['admin', adminHash, 'bank_admin', null, now]
    );
    console.log('  Created user: admin (bank_admin)');
  } else {
    console.log('  User admin already exists.');
  }

  const existingCompany1 = queryOne('SELECT id FROM users WHERE username = ?', ['company1']);
  if (!existingCompany1) {
    const company1Hash = await bcryptjs.hash('company123', salt);
    runSql(
      `INSERT INTO users (username, password_hash, role, company_id, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['company1', company1Hash, 'company_user', 'LY0010002', now]
    );
    console.log('  Created user: company1 (company_user, LY0010002)');
  } else {
    console.log('  User company1 already exists.');
  }

  const existingCompany2 = queryOne('SELECT id FROM users WHERE username = ?', ['company2']);
  if (!existingCompany2) {
    const company2Hash = await bcryptjs.hash('company456', salt);
    runSql(
      `INSERT INTO users (username, password_hash, role, company_id, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['company2', company2Hash, 'company_user', 'LY0010017', now]
    );
    console.log('  Created user: company2 (company_user, LY0010017)');
  } else {
    console.log('  User company2 already exists.');
  }

  // Universal company account (like the original app: company / company123)
  const existingCompany = queryOne('SELECT id FROM users WHERE username = ?', ['company']);
  if (!existingCompany) {
    const companyHash = await bcryptjs.hash('company123', salt);
    runSql(
      `INSERT INTO users (username, password_hash, role, company_id, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['company', companyHash, 'company_user', null, now]
    );
    console.log('  Created user: company (universal company_user)');
  } else {
    console.log('  User company already exists.');
  }

  console.log('Default users ensured.');
}

// Export for use by server startup
export { seedUsers };

async function seedDatabase(): Promise<void> {
  console.log('Initializing database...');
  await initDatabase();
  const db = getDb();

  console.log('Initializing database schema...');
  initializeSchema();

  // Check if transactions already seeded
  const existingCount = queryOne('SELECT COUNT(*) as count FROM transactions') as { count: number };

  if (existingCount.count > 0) {
    console.log(`Database already has ${existingCount.count} transactions. Skipping transaction seed.`);
    // Still ensure users exist
    await seedUsers();
    saveDb();
    console.log('Database seeding complete (users ensured)!');
    return;
  }

  console.log('Reading data.csv (real data from SerafaPaymentQueue)...');
  const csvContent = readFileSync(csvPath, 'utf-8');
  const transactions = parseCSV(csvContent);

  console.log(`Found ${transactions.length} transactions to seed.`);

  console.log('Starting bulk insert...');
  let inserted = 0;
  let skipped = 0;

  for (const record of transactions) {
    // Skip records with empty reference
    if (!record.reference || record.reference.trim() === '') {
      skipped++;
      continue;
    }

    const computedStatus = getComputedStatus(record);

    // CSV column "created_at" maps to DB column "created_at_original"
    const params = [
      record.reference,
      record.contract || null,
      parseNum(record.timestamp),
      parseNum(record.amount_requested),
      parseNum(record.final_amount),
      record.type_code || null,
      parseNum(record.availableBalance),
      record.iban || null,
      record.uuid || null,
      record.accountId || null,
      record.company_current_accountId || null,
      record.company_margin_accountId || null,
      record.customerId || null,
      record.companyId || null,
      record.deposit_type || null,
      record.lyd_ft || null,
      record.usd_ft || null,
      parseNum(record.ac_charge),
      parseNum(record.transfer_exchange_rate),
      parseNum(record.cash_exchange_rate),
      parseNum(record.fcms_rate),
      record.approved_at || null,
      record.created_at || null,        // CSV "created_at" → DB "created_at_original"
      record.today || null,
      parseInt0(record.lyd_payment_status),
      parseInt0(record.usd_payment_status),
      parseInt0(record.ac_charge_status),
      record.error1 || null,
      record.error2 || null,
      parseInt0(record.approved),
      parseInt0(record.processed),
      parseInt0(record.rejected),
      parseInt0(record.charge),
      record.charge_status_code || null,
      record.usd_payment_date || null,
      computedStatus,
    ];

    try {
      runSql(
        `INSERT OR IGNORE INTO transactions (
          reference, contract, timestamp, amount_requested, final_amount, type_code,
          availableBalance, iban, uuid, accountId, company_current_accountId,
          company_margin_accountId, customerId, companyId, deposit_type, lyd_ft,
          usd_ft, ac_charge, transfer_exchange_rate, cash_exchange_rate, fcms_rate,
          approved_at, created_at_original, today, lyd_payment_status, usd_payment_status,
          ac_charge_status, error1, error2, approved, processed, rejected, charge,
          charge_status_code, usd_payment_date, computed_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params
      );
      inserted++;
    } catch (err: any) {
      console.warn(`Warning: skipping record ${record.reference}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`Successfully seeded ${inserted} transactions (${skipped} skipped).`);

  // Seed users
  await seedUsers();

  saveDb();
  console.log('Database seeding complete!');
}

// Only run seedDatabase when this file is executed directly (npm run seed)
const isDirectExecution = process.argv[1]?.includes('seed');
if (isDirectExecution) {
  seedDatabase().catch(err => {
    console.error('Error seeding database:', err);
    process.exit(1);
  });
}
