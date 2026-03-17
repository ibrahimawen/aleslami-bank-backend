import initSqlJs from "sql.js";
import fs from "fs";
import path from "path";

const dbPath = "/sessions/gallant-wizardly-brahmagupta/mnt/منصة شركات الصرافة /serafa-dashboard/backend/serafa.db";
if (!fs.existsSync(dbPath)) { console.log("DB not found"); process.exit(0); }
const buf = fs.readFileSync(dbPath);
const SQL = await initSqlJs();
const db = new SQL.Database(buf);

const rows = db.exec("SELECT amount_requested, final_amount, deposit_type, transfer_exchange_rate, cash_exchange_rate, approved FROM transactions LIMIT 5");
if (rows.length > 0) {
  console.log("Columns:", rows[0].columns.join(" | "));
  rows[0].values.forEach(r => console.log(r.join(" | ")));
}

const stats = db.exec("SELECT deposit_type, COUNT(*) as cnt, ROUND(SUM(final_amount),2) as total_final, ROUND(SUM(amount_requested),2) as total_req, ROUND(AVG(transfer_exchange_rate),4) as avg_transfer, ROUND(AVG(cash_exchange_rate),4) as avg_cash FROM transactions GROUP BY deposit_type");
if (stats.length > 0) {
  console.log("\n--- Stats by deposit_type ---");
  console.log(stats[0].columns.join(" | "));
  stats[0].values.forEach(r => console.log(r.join(" | ")));
}
