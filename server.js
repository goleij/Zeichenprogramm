// server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parse } = require("querystring");
const WebSocket = require("ws");
const canvasSubscribers = new Map(); // Map<canvasId, Set<WebSocket>>
const canvasOnlineUsers = new Map(); // Map<canvasId, Set<userId>>
const userSockets = new Map(); // Map<userId, Set<WebSocket>>

const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./data.db"); 

/**
 * Sendet die Online-Liste eines Canvas an alle abonnierten M- und O-Clients
 */
function broadcastOnlineUsers(canvasId) {
  // IDs der aktuell verbundenen Benutzer
  const onlineSet = canvasOnlineUsers.get(canvasId) || new Set();
  const onlineUserIds = Array.from(onlineSet);

  // Alle Benutzer mit Zugriff inkl. Anzeigename
  const sql = `
    SELECT ca.user_id, ca.access_level,
           u.display_name
    FROM canvas_access AS ca
    LEFT JOIN users AS u ON u.client_id = ca.user_id
    WHERE ca.canvas_id = ?
  `;
  db.all(sql, [canvasId], (err, rows) => {
    if (err) {
      console.error("❌ DB error in broadcastOnlineUsers:", err);
      return;
    }

    const subs = canvasSubscribers.get(canvasId) || new Set();

    for (const ws of subs) {
      const myId = ws.userId;
      const me = rows.find(r => r.user_id === myId);
      if (!me) continue;

      if (["M", "O"].includes(me.access_level)) {
        let users;
        if (me.access_level === "O") {
          // Owner sieht alle Benutzer
          users = rows.map(r => ({
            userId: r.user_id,
            displayName: r.display_name || r.user_id,  // fallback
            access: r.access_level,
            isOnline: onlineUserIds.includes(r.user_id)
          }));
        } else {
          // Moderator sieht nur Online-Benutzer, die nicht Owner sind
          users = rows
            .filter(r => onlineUserIds.includes(r.user_id) && r.access_level !== "O")
            .map(r => ({
              userId: r.user_id,
              displayName: r.display_name || r.user_id,
              access: r.access_level,
              isOnline: true
            }));
        }

        ws.send(JSON.stringify({
          event: "onlineUsers",
          canvasId,
          users
        }));
      }
    }
  });
}



function collectRequestData(req, callback) {
  let body = "";
  let received = 0;
  let aborted = false;

  req.on("data", chunk => {
    if (aborted) return;
    received += chunk.length;
    // Schutz vor einem endlosen Upload, der den Speicher fuellt
    if (received > MAX_BODY_BYTES) {
      aborted = true;
      req.destroy();
      return;
    }
    body += chunk.toString();
  });

  req.on("end", () => {
    if (aborted) return;
    callback(parse(body));
  });
}

function generateuserId(email) {
  const hmac = crypto.createHmac("sha256", HMAC_SECRET);
  hmac.update(email.toLowerCase()); // E-Mail immer in Kleinbuchstaben
  return "u" + hmac.digest("hex").substring(0, 12); // auf 12 Zeichen gekürzt
}


function parseCookies(cookieHeader) { // Cookie-Header in ein Objekt zerlegen
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach(cookie => {
    const [name, ...rest] = cookie.trim().split("=");
    cookies[name] = decodeURIComponent(rest.join("="));
  });
  return cookies;
}

function getAccessLevel(userId, canvasId, callback) {
  db.get(
    "SELECT access_level FROM canvas_access WHERE user_id = ? AND canvas_id = ?",
    [userId, canvasId],
    (err, row) => {
      if (err) {
        console.error("DB error in getAccessLevel:", err);
        callback(null);
      } else {
        callback(row ? row.access_level : null);
      }
    }
  );
}

function isCanvasModerated(canvasId, callback) {
  db.get("SELECT is_moderated FROM canvases WHERE id = ?", [canvasId], (err, row) => {
    if (err) {
      console.error("DB error in isCanvasModerated:", err);
      callback(false);
    } else {
      callback(row ? row.is_moderated === 1 : false);
    }
  });
}

const port = 3000;
const publicDir = path.join(__dirname, "public");

/* ====================================================================
   Konfiguration & Sicherheit
   ==================================================================== */

const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Secrets kommen aus der Umgebung. Die Defaults existieren nur, damit die
// Entwicklungsumgebung ohne Setup laeuft — in Produktion wird abgebrochen.
const HMAC_SECRET = process.env.HMAC_SECRET || "ZeichenProgramm-SALT-2025";
const JWT_SECRET = process.env.JWT_SECRET || "mein-geheimer-schlüssel";

if (IS_PRODUCTION && (!process.env.HMAC_SECRET || !process.env.JWT_SECRET)) {
  console.error("❌ HMAC_SECRET und JWT_SECRET muessen in Produktion gesetzt sein.");
  process.exit(1);
}

// Gueltigkeitsdauer eines Login-Tokens
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

// Obergrenze fuer Request-Bodies, damit ein Client den Server nicht
// mit einem endlosen Upload den Speicher vollschreiben kann.
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Vergleicht zwei Strings in konstanter Zeit (kein Timing-Leak).
 */
function safeEquals(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* --------------------------- Passwoerter --------------------------- */

/**
 * Erzeugt einen scrypt-Hash im Format  scrypt$<salt-hex>$<hash-hex>.
 * scrypt ist bewusst langsam und damit deutlich schwerer zu brute-forcen
 * als ein einfacher SHA-256-Hash.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, 64);
  return ["scrypt", salt.toString("hex"), derived.toString("hex")].join("$");
}

/**
 * Alt-Format aus fruehen Versionen: ungesalzenes SHA-256.
 * Wird nur noch zum Verifizieren bestehender Konten gebraucht.
 */
function legacyHashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

/**
 * Prueft ein Passwort gegen den gespeicherten Hash — egal ob neues
 * scrypt-Format oder alter SHA-256-Hash.
 * Rueckgabe: { ok, needsUpgrade }
 */
function verifyPassword(password, stored) {
  if (typeof stored !== "string" || stored.length === 0) {
    return { ok: false, needsUpgrade: false };
  }

  if (stored.startsWith("scrypt$")) {
    const [, saltHex, hashHex] = stored.split("$");
    if (!saltHex || !hashHex) return { ok: false, needsUpgrade: false };
    const derived = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), 64);
    return { ok: safeEquals(derived.toString("hex"), hashHex), needsUpgrade: false };
  }

  // Alt-Format: bei Erfolg wird der Hash beim Login transparent migriert.
  return { ok: safeEquals(legacyHashPassword(password), stored), needsUpgrade: true };
}

/* ------------------------------ Token ------------------------------ */

/**
 * Erzeugt ein signiertes Token mit Ablaufzeitpunkt.
 */
function createToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    userId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  })).toString("base64url");

  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

/**
 * Einzige Stelle, an der Tokens geprueft werden.
 * Rueckgabe: das Payload-Objekt oder null.
 */
function verifyToken(token) {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signature] = parts;

  const expected = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");

  if (!safeEquals(signature, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  } catch {
    return null;
  }

  if (!payload || typeof payload.userId !== "string") return null;

  // Abgelaufene Tokens gelten nicht mehr.
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

/**
 * Liest das Token aus den Cookies eines Requests und validiert es.
 */
function getUserFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifyToken(cookies.token);
}

/**
 * Cookie-Header fuer den Login. HttpOnly schuetzt vor Auslesen per JS,
 * SameSite=Strict vor CSRF, Secure greift nur unter HTTPS.
 */
function buildAuthCookie(token) {
  const flags = [
    `token=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${TOKEN_TTL_SECONDS}`,
  ];
  if (IS_PRODUCTION) flags.push("Secure");
  return flags.join("; ");
}

function buildLogoutCookie() {
  const flags = ["token=", "HttpOnly", "Path=/", "SameSite=Strict", "Max-Age=0"];
  if (IS_PRODUCTION) flags.push("Secure");
  return flags.join("; ");
}

/* --------------------------- Statische Dateien --------------------- */

/**
 * Loest eine URL sicher auf einen Pfad innerhalb von publicDir auf.
 * Verhindert Path-Traversal (z. B. "/../server.js" oder "/..%2fdata.db").
 * Rueckgabe: absoluter Pfad oder null, wenn er ausserhalb liegen wuerde.
 */
/**
 * Prueft die Origin eines WebSocket-Handshakes gegen den eigenen Host.
 * Clients ohne Origin-Header (z. B. Tests, native Clients) werden erlaubt.
 */
function isAllowedOrigin(origin, host) {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function resolvePublicPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null; // ungueltige Prozent-Kodierung
  }

  if (decoded.includes("\0")) return null;

  const resolved = path.resolve(publicDir, "." + path.posix.normalize("/" + decoded));

  // Muss innerhalb von publicDir liegen.
  if (resolved !== publicDir && !resolved.startsWith(publicDir + path.sep)) {
    return null;
  }
  return resolved;
}

const server = http.createServer((req, res) => {
  // 1. POST-Route für die Registrierung
  if (req.method === "POST" && req.url === "/api/register") {
    collectRequestData(req, (data) => {
      const { email, password, displayName } = data;

      if (!email || !password || !displayName) {
        res.writeHead(400);
        return res.end("Alle Felder sind erforderlich");
      }

      const passwordHash = hashPassword(password);
      const userId = generateuserId(email);

      db.get("SELECT * FROM users WHERE email = ? OR display_name = ?", [email, displayName], (err, user) => {
        if (user) {
          res.writeHead(409);
          return res.end("E-Mail oder Anzeigename ist bereits registriert");
        }

        db.run(
          "INSERT INTO users (client_id, email, password_hash, display_name) VALUES (?, ?, ?, ?)",
          [userId, email, passwordHash, displayName],
          (err) => {
            if (err) {
              console.error("❌ Fehler beim Registrieren:", err);
              res.writeHead(500);
              return res.end("Fehler beim Registrieren");
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ redirect: "/login" }));

          }
        );
      });
    });
    return;
  }


  if (req.method === "POST" && req.url === "/api/login") {
    collectRequestData(req, (data) => {
      const { email, password } = data;

      if (!email || !password) {
        res.writeHead(400);
        return res.end("E-Mail und Passwort erforderlich");
      }

      // Benutzer nur ueber die E-Mail suchen; das Passwort wird danach
      // separat geprueft, damit auch alte Hash-Formate noch funktionieren.
      db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err || !user) {
          res.writeHead(401);
          return res.end("Ungültige Anmeldedaten");
        }

        const check = verifyPassword(password, user.password_hash);
        if (!check.ok) {
          res.writeHead(401);
          return res.end("Ungültige Anmeldedaten");
        }

        // Konto benutzt noch den alten SHA-256-Hash -> still auf scrypt heben.
        if (check.needsUpgrade) {
          db.run(
            "UPDATE users SET password_hash = ? WHERE client_id = ?",
            [hashPassword(password), user.client_id],
            (upgradeErr) => {
              if (upgradeErr) console.error("❌ Passwort-Migration fehlgeschlagen:", upgradeErr);
              else console.log("🔐 Passwort-Hash migriert für", user.client_id);
            }
          );
        }

        const token = createToken(user.client_id);

        res.writeHead(200, {
          "Set-Cookie": buildAuthCookie(token),
          "Content-Type": "application/json"
        });
        res.end(JSON.stringify({ redirect: "/" }));

      });
    });
    return;
  }



  if (req.method === "POST" && req.url === "/api/logout") {
    res.writeHead(200, {
      "Set-Cookie": buildLogoutCookie(),
      "Content-Type": "application/json"
    });
    return res.end(JSON.stringify({ redirect: "/login" }));
  }


  if (req.url === "/" && req.method === "GET") {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.token;

    if (!token) {
      res.writeHead(200, { "Content-Type": "text/html" });
      fs.readFile(path.join(publicDir, "index.html"), (err, data) => {
        if (err) {
          res.writeHead(500);
          return res.end("Fehler beim Laden der Seite");
        }
        res.end(data);
      });

      return;
    }

    // Token validieren
    if (!verifyToken(token)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      fs.readFile(path.join(publicDir, "index.html"), (err, data) => {
        if (err) {
          res.writeHead(500);
          return res.end("Fehler beim Laden der Seite");
        }
        res.end(data);
      });
      return;
    }

    // Alles in Ordnung -> index.html ausliefern
    req.url = "/index.html";
  }


  // Route /api/me -> Daten des aktuellen Benutzers aus dem JWT
  if (req.method === "GET" && req.url === "/api/me") {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.token;

    if (!token) {
      res.writeHead(401);
      return res.end("Nicht eingeloggt");
    }

    const payload = verifyToken(token);
    if (!payload) {
      res.writeHead(401);
      return res.end("Ungültiger Token");
    }
    const userId = payload.userId;

    // Zugriffsrechte aus der DB laden
    db.all("SELECT canvas_id, access_level FROM canvas_access WHERE user_id = ?", [userId], (err, rows) => {
      if (err) {
        res.writeHead(500);
        return res.end("Fehler beim Laden der Zugriffsrechte");
      }

      const responsePayload = {
        id: userId,
        canvases: rows.map(row => ({ canvasId: row.canvas_id, right: row.access_level }))
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(responsePayload));
    });

    return;
  }

  if (req.method === "POST" && req.url === "/api/create-canvas") {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.token;

    if (!token) {
      res.writeHead(401);
      return res.end("Nicht eingeloggt");
    }

    const payload = verifyToken(token);
    if (!payload) {
      res.writeHead(401);
      return res.end("Ungültiger Token");
    }
    const userId = payload.userId;

    const canvasId = crypto.randomUUID();

    // Neues Canvas anlegen
    db.run("INSERT INTO canvases (id, owner_id, is_moderated) VALUES (?, ?, ?)", [canvasId, userId, 0], (err) => {
      if (err) {
        res.writeHead(500);
        return res.end("Fehler beim Erstellen des Canvas");
      }

      // Ersteller bekommt das Recht O (Owner)
      db.run("INSERT INTO canvas_access (user_id, canvas_id, access_level) VALUES (?, ?, 'O')", [userId, canvasId], (err2) => {
        if (err2) {
          res.writeHead(500);
          return res.end("Fehler beim Setzen der Zugriffsrechte");
        }

        // ID zurückgeben
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ canvasId }));
      });
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/set-access") {
    collectRequestData(req, (data) => {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies.token;

      if (!token) {
        res.writeHead(401);
        return res.end("Nicht eingeloggt");
      }

      const payload = verifyToken(token);
      if (!payload) {
        res.writeHead(401);
        return res.end("Ungültiger Token");
      }
      const currentUserId = payload.userId;

      const { canvasId, targetUserId, newAccessLevel } = data;

      if (!canvasId || !targetUserId || !newAccessLevel) {
        res.writeHead(400);
        return res.end("Fehlende Parameter");
      }

      // Prüfen, ob der aktuelle Benutzer Owner des Canvas ist
      db.get("SELECT access_level FROM canvas_access WHERE user_id = ? AND canvas_id = ?", [currentUserId, canvasId], (err, row) => {
        if (err || !row || row.access_level !== "O") {
          res.writeHead(403);
          return res.end("Keine Berechtigung");
        }

        // Zugriffsrecht des anderen Benutzers ändern
        db.run(
          "REPLACE INTO canvas_access (user_id, canvas_id, access_level) VALUES (?, ?, ?)",
          [targetUserId, canvasId, newAccessLevel],
          (err2) => {
            if (err2) {
              res.writeHead(500);
              return res.end("Fehler beim Setzen der Zugriffsrechte");
            }

            console.log(`✅ Zugriffsrecht von ${targetUserId} für Canvas ${canvasId} gesetzt auf ${newAccessLevel}`);

            const clients = canvasSubscribers.get(canvasId);
            if (clients) {
              for (const client of clients) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({
                    event: "accessChanged",
                    canvasId,
                    targetUserId,
                    newAccessLevel
                  }));
                }
              }
            }

            res.writeHead(200);
            res.end("Zugriffsrecht aktualisiert");
          }
        );
      });
    });

    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/is-moderated")) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const canvasId = urlObj.searchParams.get("canvasId");

    db.get("SELECT is_moderated FROM canvases WHERE id = ?", [canvasId], (err, row) => {
      if (err || !row) {
        res.writeHead(404);
        return res.end("Canvas nicht gefunden");
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ isModerated: !!row.is_moderated }));
    });

    return;
  }


  // 2. Statische Dateien
  const knownRoutes = ["/", "/login", "/register"];
  let filePath;

  if (knownRoutes.includes(req.url) || req.url.startsWith("/canvas/")) {
    filePath = path.join(publicDir, "index.html");
  } else {
    // Pfad sicher aufloesen: alles ausserhalb von publicDir wird abgelehnt.
    filePath = resolvePublicPath(req.url);
    if (!filePath) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      return res.end("403 Forbidden");
    }
  }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
    };

  if (filePath.endsWith("index.html")) {
    console.log("📦 index.html ausgeliefert für Pfad:", req.url);
  }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("404 Not Found");
      }

      const contentType = mimeTypes[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    });
});

const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  // Cross-Site-WebSocket-Hijacking verhindern: der Handshake traegt die
  // Cookies mit, deshalb wird die Herkunft geprueft.
  if (!isAllowedOrigin(req.headers.origin, req.headers.host)) {
    console.log("🚫 [WS] Upgrade von fremder Origin abgelehnt:", req.headers.origin);
    return socket.destroy();
  }

  if (req.url.startsWith("/channel/")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy(); // alle anderen Pfade ablehnen
  }
});

wss.on("connection", (ws, req) => {
  ws.canvasId = null;
  
  const connectionPayload = getUserFromRequest(req);
  if (connectionPayload) {
    ws.userId = connectionPayload.userId;
  }

  if (ws.userId) {
    if (!userSockets.has(ws.userId)) userSockets.set(ws.userId, new Set());
    userSockets.get(ws.userId).add(ws);
  }

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.command === "registerForCanvas") {
        ws.canvasId = data.canvasId;

      // userId aus dem JWT extrahieren und am Socket speichern
      let userId = null;
      const registerPayload = getUserFromRequest(req);
      if (registerPayload) {
        userId = registerPayload.userId;
        ws.userId = userId; // auch am Socket ablegen
      }


      if (userId && ws.canvasId) {
        getAccessLevel(userId, ws.canvasId, (accessLevel) => {
          console.log(`✅ [AccessTest] User ${userId} access level on canvas ${ws.canvasId}: ${accessLevel}`);
          // Vorerst nur loggen; die Rechte werden weiter unten ausgewertet
        });
      }


        if (!canvasSubscribers.has(ws.canvasId)) {
          canvasSubscribers.set(ws.canvasId, new Set());
        }
        canvasSubscribers.get(ws.canvasId).add(ws);

        console.log(`🟢 ${ws.canvasId}:`, canvasSubscribers.get(ws.canvasId).size, "client(s) connected.");

        if (!canvasOnlineUsers.has(ws.canvasId)) {
          canvasOnlineUsers.set(ws.canvasId, new Set());
        }
        canvasOnlineUsers.get(ws.canvasId).add(ws.userId);

        broadcastOnlineUsers(ws.canvasId);

        // --- Initiale Synchronisation ---
        db.all("SELECT * FROM shapes WHERE canvas_id = ?", [ws.canvasId], (err, rows) => {
          if (!err) {
            // Alle vorhandenen Formen an den Client senden
            ws.send(JSON.stringify({
              event: "initialSync",
              canvasId: ws.canvasId,
              shapes: rows.map(row => ({
                id: row.id,
                type: row.type,
                data: JSON.parse(row.data),
                fillColor: row.data && JSON.parse(row.data).fillColor,
                borderColor: row.data && JSON.parse(row.data).borderColor
              }))
            }));
          }else {
            console.error("❌ Fehler beim Laden der Shapes:", err);
          }
        });
      }
      
      else if (data.command === "shapeUpdate" && data.canvasId && data.action === "add") {

        function broadcastShapeAdd() {
          wss.clients.forEach(client => {
            if (
              client !== ws &&
              client.readyState === WebSocket.OPEN &&
              client.canvasId === data.canvasId
            ) {
              client.send(JSON.stringify({
                event: "addShape",
                canvasId: data.canvasId,
                senderId: data.senderId,
                shape: data.shape
              }));
            }
          });
        }

        getAccessLevel(ws.userId, data.canvasId, (accessLevel) => {
          if (!accessLevel) {
            console.log(`🚫 [Access] User ${ws.userId} has NO ACCESS to canvas ${data.canvasId}`);
            return;
          }
          if (["V", "M", "O"].includes(accessLevel)) {
            // Diese Rollen dürfen immer zeichnen
            broadcastShapeAdd();
          } else if (accessLevel === "W") {
            isCanvasModerated(data.canvasId, (isMod) => {
              if (!isMod) {
                broadcastShapeAdd();
              } else {
                console.log(`🚫 [Access] User ${ws.userId} darf mit Recht W im moderierten Modus keine Form hinzufügen!`);
              }
            });
          } else {
            // z. B. R
            console.log(`🚫 [Access] User ${ws.userId} darf mit Recht ${accessLevel} keine Form hinzufügen!`);
          }
        });
      }

      else if (data.command === "broadcastEvent" && data.canvasId && data.event) {
        const clients = canvasSubscribers.get(data.canvasId);

        getAccessLevel(ws.userId, data.canvasId, (accessLevel) => {
          if (!accessLevel) {
            console.log(`🚫 [Broadcast] User ${ws.userId} has NO ACCESS to canvas ${data.canvasId}`);
            return;
          }
          if (["V", "M", "O"].includes(accessLevel)) {
            // erlaubt
            if (clients) {
              for (const client of clients) {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({
                    event: "logReplay",
                    canvasId: data.canvasId,
                    senderId: data.senderId,
                    logLine: data.event
                  }));
                }
              }
            }
          } else if (accessLevel === "W") {
            isCanvasModerated(data.canvasId, (isMod) => {
              if (!isMod) {
                if (clients) {
                  for (const client of clients) {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                      client.send(JSON.stringify({
                        event: "logReplay",
                        canvasId: data.canvasId,
                        senderId: data.senderId,
                        logLine: data.event
                      }));
                    }
                  }
                }
              } else {
                console.log(`🚫 [Broadcast] User ${ws.userId} mit Recht W im moderierten Modus nicht erlaubt.`);
              }
            });
          } else {
            console.log(`🚫 [Broadcast] User ${ws.userId} mit Recht ${accessLevel} nicht erlaubt.`);
          }
        });
      }

      else if ((data.event === "selectShape" || data.event === "unselectShape") && data.canvasId) {
        getAccessLevel(ws.userId, data.canvasId, (accessLevel) => {
          if (!accessLevel) {
            console.log(`🚫 [Select] User ${ws.userId} darf nicht selektieren/deselektieren.`);
            return;
          }

          wss.clients.forEach(client => {
            if (
              client.readyState === WebSocket.OPEN &&
              client.canvasId === data.canvasId
            ) {
              client.send(JSON.stringify(data));
            }
          });
        });
      }


      else if (msg.command === "unregisterForCanvas") {
        const { canvasId } = msg;

        if (canvasSubscribers.has(canvasId)) {
          canvasSubscribers.get(canvasId).delete(ws);
          if (canvasSubscribers.get(canvasId).size === 0) {
            canvasSubscribers.delete(canvasId);
          }
          console.log(`⚪ ${canvasId}:`, canvasSubscribers.get(canvasId)?.size ?? 0, "client(s) connected (after unregister).");
        }

        // Vor dem Zurücksetzen noch broadcasten
        broadcastOnlineUsers(canvasId);

        // aufräumen
        ws.canvasId = null;
      }


      else if (data.command === "changeAccess") {
        const { canvasId, targetUserId, newAccess } = data;

        // 0) Eingaben validieren
        const ALLOWED = new Set(["R","W","V","M","O"]);
        if (!ALLOWED.has(newAccess)) {
          console.log("🚫 [Access] invalid newAccess:", newAccess);
          return;
        }

        // 1) Eigene Rechte darf niemand ändern
        if (!ws.userId) return;
        if (ws.userId === targetUserId) {
          console.log(`🚫 [Access] ${ws.userId} cannot change own access`);
          return;
        }

        // 2) Recht des Anfragenden auf diesem Canvas
        getAccessLevel(ws.userId, canvasId, (requesterLevel) => {
          if (!requesterLevel) {
            console.log("🚫 [Access] requester has no access on this canvas");
            return;
          }

          // 3) Aktuelles Recht des Ziels (kann noch fehlen)
          db.get(
            "SELECT access_level FROM canvas_access WHERE user_id = ? AND canvas_id = ?",
            [targetUserId, canvasId],
            (err, row) => {
              if (err) {
                console.error("❌ DB error in changeAccess (read target):", err);
                return;
              }
              const targetCurrent = row ? row.access_level : null;

              // —— Regeln:
              if (requesterLevel === "O") {
                // ok
              } else if (requesterLevel === "M") {
                if (!["R","W","V"].includes(newAccess)) {
                  console.log(`🚫 [Access] M cannot assign ${newAccess}`);
                  return;
                }
                if (targetCurrent && !["R","W","V"].includes(targetCurrent)) {
                  console.log(`🚫 [Access] M cannot modify target with level ${targetCurrent}`);

                  try {
                    ws.send(JSON.stringify({
                      event: "changeAccessDenied",
                      canvasId,
                      targetUserId,
                      reason: "moderatorCannotModifyOwnerOrModerator",
                      targetCurrent
                    }));
                  } catch {}
                  
                  return;
                }
              } else {
                console.log(`🚫 [Access] ${ws.userId} with level ${requesterLevel} cannot change access`);
                return;
              }

              // 🔁 Nach erfolgreichem DB-Schreiben: an die Canvas-Abonnenten broadcasten
              const broadcastAccessChanged = () => {
                const subs = canvasSubscribers.get(canvasId) || new Set();
                for (const client of subs) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                      event: "accessChanged",
                      canvasId,
                      targetUserId,
                      newAccessLevel: newAccess
                    }));
                  }
                }
                if (typeof broadcastOnlineUsers === "function") {
                  try { broadcastOnlineUsers(canvasId); } catch {}
                }
              };

              // 🔔 Auch den betroffenen Benutzer selbst benachrichtigen (Home/andere Tabs)
              const notifyTargetChanged = () => {
                const sockets = userSockets.get(targetUserId);
                if (sockets) {
                  for (const sock of sockets) {
                    if (sock.readyState === WebSocket.OPEN) {
                      sock.send(JSON.stringify({
                        event: "canvasAccessLevelChangedForYou",
                        canvasId,
                        accessLevel: newAccess
                      }));
                    }
                  }
                }
              };

              // ✉️ Einladung nur beim allerersten Vergeben (INSERT) senden
              const notifyInviteIfFirstGrant = () => {
                const targets = userSockets.get(targetUserId);
                if (targets) {
                  for (const sock of targets) {
                    if (sock.readyState === WebSocket.OPEN) {
                      sock.send(JSON.stringify({
                        event: "invitedToCanvas",
                        canvasId,
                        accessLevel: newAccess
                      }));
                    }
                  }
                }
              };

              // UPDATE, und falls kein Datensatz existiert: INSERT
              db.run(
                "UPDATE canvas_access SET access_level = ? WHERE user_id = ? AND canvas_id = ?",
                [newAccess, targetUserId, canvasId],
                function (updErr) {
                  if (updErr) {
                    console.error("❌ DB error in changeAccess (update):", updErr);
                    return;
                  }
                  if (this.changes > 0) {
                    console.log(`🟢 [Access] ${ws.userId} set ${targetUserId}→${newAccess} on ${canvasId} (update)`);
                    // erst nach erfolgreichem Schreiben
                    broadcastAccessChanged();
                    notifyTargetChanged();
                    return;
                  }

                  // kein Datensatz -> erstmalige Vergabe
                  db.run(
                    "INSERT INTO canvas_access (user_id, canvas_id, access_level) VALUES (?,?,?)",
                    [targetUserId, canvasId, newAccess],
                    (insErr) => {
                      if (insErr) {
                        console.error("❌ DB error in changeAccess (insert):", insErr);
                        return;
                      }
                      console.log(`🟢 [Access] ${ws.userId} set ${targetUserId}→${newAccess} on ${canvasId} (first grant)`);
                      // erst nach erfolgreichem Schreiben
                      broadcastAccessChanged();
                      notifyInviteIfFirstGrant(); // nur hier die Einladung
                    }
                  );
                }
              );
            }
          );
        });
      }




      else if (data.command === "toggleModerated") {
        const { canvasId, moderated } = data;

        getAccessLevel(ws.userId, canvasId, (accessLevel) => {
          if (!accessLevel) return;

          if (["M", "O"].includes(accessLevel)) {
            db.run("UPDATE canvases SET is_moderated = ? WHERE id = ?", [moderated ? 1 : 0, canvasId], (err) => {
              if (err) return console.error("❌ DB error in toggleModerated:", err);
              console.log(`🟢 [Moderated] ${ws.userId} set canvas ${canvasId} → moderated=${moderated}`);

              // Übrige Benutzer des Canvas informieren
              const clients = canvasSubscribers.get(canvasId);
              if (clients) {
                for (const client of clients) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                      event: "moderatedChanged",
                      canvasId,
                      moderated
                    }));
                  }
                }
              }
            });
          } else {
            console.log(`🚫 [Moderated] ${ws.userId} darf den moderierten Modus nicht ändern`);
          }
        });
      }

      else if (data.command === "deleteCanvas") {
        const canvasId = data.canvasId;

        getAccessLevel(ws.userId, canvasId, (accessLevel) => {
          if (accessLevel !== "O") {
            console.log(`🚫 [Delete] Nur der Owner darf löschen`);
            return;
          }

          // 1) Benutzer mit Zugriff vor dem Löschen auslesen
          db.all("SELECT user_id FROM canvas_access WHERE canvas_id = ?", [canvasId], (selErr, rows) => {
            if (selErr) {
              console.error("❌ DB error (select users before delete):", selErr);
              return;
            }
            const affectedUserIds = rows.map(r => r.user_id);

            // 2) Datensätze löschen
            db.serialize(() => {
              db.run("DELETE FROM shapes WHERE canvas_id = ?", [canvasId]);
              db.run("DELETE FROM canvas_access WHERE canvas_id = ?", [canvasId]);
              db.run("DELETE FROM canvases WHERE id = ?", [canvasId], (delErr) => {
                if (delErr) {
                  console.error("❌ DB error in deleteCanvas:", delErr);
                  return;
                }

                console.log(`🗑️ [Delete] Canvas ${canvasId} deleted by ${ws.userId}`);

            // 3) Aktive Clients dieses Canvas informieren
                const subs = canvasSubscribers.get(canvasId) || new Set();
                for (const client of subs) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                      event: "canvasDeleted",
                      canvasId
                    }));
                  }
                }
                canvasSubscribers.delete(canvasId);

                // 4) Alle Benutzer mit Zugriff informieren (Home / andere Tabs)
                for (const uid of affectedUserIds) {
                  const sockets = userSockets.get(uid);
                  if (!sockets) continue;
                  for (const sock of sockets) {
                    if (sock.readyState === WebSocket.OPEN) {
                      sock.send(JSON.stringify({
                        event: "canvasRemovedForYou", // Event speziell für die Home-Seite
                        canvasId
                      }));
                    }
                  }
                }
              });
            });
          });
        });
      }


      else if (data.command === "getOnlineUsers" && data.canvasId) {
        getAccessLevel(ws.userId, data.canvasId, (accessLevel) => {
          if (!accessLevel) {
            ws.send(JSON.stringify({
              event: "onlineUsers",
              canvasId: data.canvasId,
              users: [],
              error: "Kein Zugriff"
            }));
            return;
          }

          const onlineSet = canvasOnlineUsers.get(data.canvasId) || new Set();
          const onlineUserIds = Array.from(onlineSet);

          // Gemeinsames SQL mit JOIN auf users, um display_name zu erhalten
          const SQL = `
            SELECT ca.user_id, ca.access_level, u.display_name
            FROM canvas_access AS ca
            LEFT JOIN users AS u ON u.client_id = ca.user_id
            WHERE ca.canvas_id = ?
          `;

          if (accessLevel === "O") {
            // O: alle Benutzer mit Zugriff inkl. Online-Status
            db.all(SQL, [data.canvasId], (err, rows) => {
              if (err) {
                ws.send(JSON.stringify({
                  event: "onlineUsers",
                  canvasId: data.canvasId,
                  users: [],
                  error: "DB Fehler"
                }));
                return;
              }
              const users = rows.map(r => ({
                userId: r.user_id,
                displayName: r.display_name || r.user_id,   // fallback
                access: r.access_level,
                isOnline: onlineUserIds.includes(r.user_id)
              }));
              ws.send(JSON.stringify({ event: "onlineUsers", canvasId: data.canvasId, users }));
            });

          } else if (accessLevel === "M") {
            // M: nur Online-Benutzer, die nicht Owner sind
            db.all(SQL, [data.canvasId], (err, rows) => {
              if (err) {
                ws.send(JSON.stringify({
                  event: "onlineUsers",
                  canvasId: data.canvasId,
                  users: [],
                  error: "DB Fehler"
                }));
                return;
              }
              const users = rows
                .filter(r => onlineUserIds.includes(r.user_id) && r.access_level !== "O")
                .map(r => ({
                  userId: r.user_id,
                  displayName: r.display_name || r.user_id,
                  access: r.access_level,
                  isOnline: true
                }));
              ws.send(JSON.stringify({ event: "onlineUsers", canvasId: data.canvasId, users }));
            });

          } else {
            ws.send(JSON.stringify({
              event: "onlineUsers",
              canvasId: data.canvasId,
              users: [],
              error: "Kein Zugriff"
            }));
          }
        });
      }

    } catch (e) {
      console.error("❌ Fehler beim Parsen der Nachricht", e);
    }
  });

  ws.on("close", () => {
    // Beim Trennen aus der Abonnentenliste entfernen
    if (ws.canvasId && canvasSubscribers.has(ws.canvasId)) {
      canvasSubscribers.get(ws.canvasId).delete(ws);
      if (canvasSubscribers.get(ws.canvasId).size === 0) {
        canvasSubscribers.delete(ws.canvasId);
      }

      console.log(`🔴 ${ws.canvasId}:`, canvasSubscribers.get(ws.canvasId)?.size ?? 0, "client(s) connected.");
    }

    // Aus der Liste der Online-Benutzer entfernen
    if (ws.canvasId && canvasOnlineUsers.has(ws.canvasId)) {
      canvasOnlineUsers.get(ws.canvasId).delete(ws.userId);
      if (canvasOnlineUsers.get(ws.canvasId).size === 0) {
        canvasOnlineUsers.delete(ws.canvasId);
      }
      broadcastOnlineUsers(ws.canvasId);
    }

    if (ws.userId && userSockets.has(ws.userId)) {
      const set = userSockets.get(ws.userId);
      set.delete(ws);
      if (set.size === 0) userSockets.delete(ws.userId);
    }
  });
});



server.listen(port, () => {
  console.log(`HTTP + WebSocket Server läuft auf http://localhost:${port}`);
});
