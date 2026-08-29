# ---------- Build-Stufe: TypeScript und Tailwind uebersetzen ----------
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- Laufzeit-Stufe: nur der Node-Server ----------
# Die Anwendung braucht Node zur Laufzeit (HTTP-API, WebSocket, SQLite).
# Ein reiner Webserver wie nginx kann sie nicht ausliefern.
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

# Nur das kopieren, was zur Laufzeit gebraucht wird — keine .ts-Quellen,
# keine Source-Maps, keine Build-Konfiguration.
COPY --from=builder /app/server.js /app/initDB.js ./
COPY --from=builder /app/public ./public

RUN chown -R node:node /app
USER node

EXPOSE 3000

# initDB ist idempotent (CREATE TABLE IF NOT EXISTS) und legt die
# Datenbank beim ersten Start an.
CMD ["sh", "-c", "node initDB.js && node server.js"]
