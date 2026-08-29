// initDB.js
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./data.db");

db.serialize(() => {
  // Tabelle: users
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      client_id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabelle: canvases
  db.run(`
    CREATE TABLE IF NOT EXISTS canvases (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      is_moderated BOOLEAN DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(client_id)
    )
  `);

  // Tabelle: canvas_access — Zugriffsrechte pro Benutzer/Canvas
  db.run(`
    CREATE TABLE IF NOT EXISTS canvas_access (
      user_id TEXT NOT NULL,
      canvas_id TEXT NOT NULL,
      access_level TEXT NOT NULL CHECK (access_level IN ('R', 'W', 'V', 'M', 'O')),
      PRIMARY KEY (user_id, canvas_id),
      FOREIGN KEY (user_id) REFERENCES users(client_id),
      FOREIGN KEY (canvas_id) REFERENCES canvases(id)
    )
  `);

  // Tabelle: shapes
  db.run(`
    CREATE TABLE IF NOT EXISTS shapes (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (canvas_id) REFERENCES canvases(id),
      FOREIGN KEY (created_by) REFERENCES users(client_id)
    )
  `);

  console.log("✅ Datenbank und Tabellen erfolgreich erstellt.");
});

db.close();
