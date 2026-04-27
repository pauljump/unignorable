import Database from "better-sqlite3"
import path from "path"

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db

  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "unignorable.db")

  // Ensure directory exists
  const dir = path.dirname(dbPath)
  const fs = require("fs")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")

  db.exec(`
    CREATE TABLE IF NOT EXISTS clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      council_district INTEGER NOT NULL,
      project_job_id TEXT NOT NULL,
      clicked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      council_district INTEGER NOT NULL,
      project_job_id TEXT,
      subscribed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_clicks_district ON clicks(council_district);
    CREATE INDEX IF NOT EXISTS idx_clicks_week ON clicks(clicked_at);
  `)

  return db
}

export function recordClick(district: number, jobId: string) {
  getDb().prepare("INSERT INTO clicks (council_district, project_job_id) VALUES (?, ?)").run(district, jobId)
}

export function getClickCount(): number {
  const row = getDb().prepare(
    "SELECT COUNT(*) as count FROM clicks WHERE clicked_at > datetime('now', '-7 days')"
  ).get() as { count: number }
  return row.count
}

export function getTotalClicks(): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM clicks").get() as { count: number }
  return row.count
}

export function getClicksByDistrict(): { district: number; count: number }[] {
  return getDb().prepare(
    "SELECT council_district as district, COUNT(*) as count FROM clicks GROUP BY council_district ORDER BY count DESC"
  ).all() as { district: number; count: number }[]
}

export function addSubscriber(email: string, district: number, jobId: string | null) {
  getDb().prepare(
    "INSERT OR IGNORE INTO subscribers (email, council_district, project_job_id) VALUES (?, ?, ?)"
  ).run(email, district, jobId)
}

export function getSubscriberCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) as count FROM subscribers").get() as { count: number }
  return row.count
}
