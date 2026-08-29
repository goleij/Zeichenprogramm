# Zeichenprogramm

Kollaboratives Zeichenprogramm mit Echtzeit-Synchronisation über WebSockets,
Benutzerverwaltung und abgestuften Zugriffsrechten pro Canvas.

## Schnellstart

```bash
npm install      # Abhängigkeiten
npm run db:init  # Datenbank anlegen (nur beim ersten Mal)
npm run build    # TypeScript + Tailwind übersetzen
npm start        # Server auf http://localhost:3000
```

Danach `http://localhost:3000/register` aufrufen und ein Konto anlegen.

## Skripte

| Befehl | Wirkung |
| --- | --- |
| `npm start` | Startet den Server (baut **nicht**) |
| `npm run build` | `tsc` + Tailwind → `public/*.js`, `public/app.css` |
| `npm run build:css` | Nur Tailwind neu bauen |
| `npm run watch:css` | Tailwind im Watch-Modus (beim Arbeiten am UI) |
| `npm run db:init` | Legt `data.db` mit allen Tabellen an |

## Projektstruktur

```
server.js            HTTP-Server, REST-Routen, WebSocket, SQLite
initDB.js            Legt das Datenbankschema an
src/input.css        Tailwind-Quelldatei  ->  public/app.css
public/
  index.html         Einstiegspunkt (Single Page App)
  app.js             Routing und alle Seiten (Login, Home, Canvas)
  drawer.ts/.js      Zeichenlogik, Formen, WebSocket-Client
  context-menu.ts/.js Kontextmenü
  style.css          Restliche handgeschriebene Styles (Legacy-Layer)
```

`public/app.css` und die `.js`-Dateien sind Build-Ergebnisse, werden aber
bewusst versioniert: `npm start` baut nicht, ohne sie wäre die Anwendung
nach einem frischen Clone ohne Styles und die Canvas-Seite lädt nicht.

## Zugriffsrechte

| Code | Bedeutung |
| --- | --- |
| `R` | Read-Only — darf nur zusehen |
| `W` | Write — darf zeichnen (im moderierten Modus gesperrt) |
| `V` | Verwalten |
| `M` | Moderieren — darf Rechte bis `V` vergeben |
| `O` | Owner — alle Rechte, darf das Canvas löschen |

## Konfiguration

Die Secrets werden aus der Umgebung gelesen. Für die Entwicklung gibt es
Defaults, in Produktion (`NODE_ENV=production`) startet der Server ohne sie
nicht.

| Variable | Bedeutung |
| --- | --- |
| `JWT_SECRET` | Signaturschlüssel der Login-Tokens |
| `HMAC_SECRET` | Ableitung der Benutzer-IDs aus der E-Mail |
| `NODE_ENV` | `production` erzwingt Secrets und setzt das `Secure`-Cookie-Flag |

```bash
JWT_SECRET=... HMAC_SECRET=... NODE_ENV=production npm start
```

> `HMAC_SECRET` bestimmt die Benutzer-IDs. Wird es nachträglich geändert,
> bekommen bestehende Konten neue IDs und verlieren ihre Canvas-Zuordnung.

## Docker

```bash
docker build -t zeichenprogramm .
docker run -p 3000:3000 \
  -e JWT_SECRET=... -e HMAC_SECRET=... \
  -v zeichen-data:/app/data.db \
  zeichenprogramm
```

## Sicherheit

- Passwörter werden mit **scrypt** und pro Konto eigenem Salt gespeichert.
  Konten aus früheren Versionen (ungesalzenes SHA-256) werden beim nächsten
  Login automatisch auf das neue Format gehoben.
- Login-Tokens laufen nach 8 Stunden ab; das Cookie ist `HttpOnly`,
  `SameSite=Strict` und unter `NODE_ENV=production` zusätzlich `Secure`.
- Statische Dateien werden nur innerhalb von `public/` ausgeliefert
  (kein Path-Traversal).
- Der WebSocket-Handshake prüft die Origin.
- `data.db` gehört nicht ins Repository und ist in `.gitignore` ausgenommen.
