let isFirstLoad = true; // erster render()-Durchlauf
// Referenzen auf aktive Listener, damit sie nicht mehrfach registriert werden
window._onlineUsersHandler = null;
window._wsReadyHandler = null;
window._roleChangedHandler = null;
window._homeWS = null;
window._homeWSMsgHandler = null;
window._authWS = null;
window._authWSMsgHandler = null;

function ensureToastContainer() {
  if (document.getElementById('toast-container')) return;
  const el = document.createElement('div');
  el.id = 'toast-container';
  el.style.cssText = `
    position: fixed; right: 16px; bottom: 16px; z-index: 9999;
    display: flex; flex-direction: column; gap: 8px;
  `;
  document.body.appendChild(el);
}
function showToast(text, timeout = 4000) {
  ensureToastContainer();
  const wrap = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.textContent = text;
  t.style.cssText = `
    background:#333;color:#fff;padding:10px 12px;border-radius:8px;
    box-shadow:0 4px 12px rgba(0,0,0,.2); max-width: 360px; font-size: 14px;
  `;
  wrap.appendChild(t);
  setTimeout(()=> t.remove(), timeout);
}

// 👁️ Passwort in den Auth-Formularen ein-/ausblenden
function toggleAuthPassword(btn) {
  const input = btn.parentElement?.querySelector("input");
  if (!input) return;
  const hidden = input.type === "password";
  input.type = hidden ? "text" : "password";
  btn.setAttribute("aria-label", hidden ? "Passwort verbergen" : "Passwort anzeigen");
  btn.innerHTML = hidden
    ? `<svg class="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
         <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"></path>
         <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"></path>
         <path d="M9.88 9.88a3 3 0 104.24 4.24"></path>
         <path d="M1 1l22 22"></path>
       </svg>`
    : `<svg class="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
         <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
         <circle cx="12" cy="12" r="3"></circle>
       </svg>`;
  input.focus();
}
window.toggleAuthPassword = toggleAuthPassword;

// 🛡️ HTML-Escaping — Anzeigenamen kommen von Benutzern und landen in innerHTML
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

// 🏷️ Zugriffsrechte: Beschriftung + Badge-Farbe
const ACCESS_LABELS = {
  O: "Owner",
  M: "Moderieren",
  V: "Verwalten",
  W: "Write",
  R: "Read-Only",
};

const ACCESS_BADGE = {
  O: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  M: "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
  V: "bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300",
  W: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  R: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

// 🎨 HTML einer Canvas-Karte auf der Home-Seite
function canvasItemHTML(canvasId, right) {
  const label = ACCESS_LABELS[right] || right;
  const badge = ACCESS_BADGE[right] || ACCESS_BADGE.R;
  return `
    <a href="/canvas/${canvasId}" onclick="navigateTo('/canvas/${canvasId}'); return false;"
       class="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-500">
      <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-linear-to-br from-blue-500 to-violet-500 text-white shadow-md shadow-blue-500/25">
        <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
          <path d="M2 2l7.586 7.586"></path>
          <circle cx="11" cy="11" r="2"></circle>
        </svg>
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-semibold text-slate-900 dark:text-white">Canvas</span>
        <span class="mt-0.5 block truncate font-mono text-xs text-slate-400 dark:text-slate-500">${canvasId}</span>
      </span>
      <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge}">${label}</span>
      <svg class="size-4 shrink-0 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 18l6-6-6-6"></path>
      </svg>
    </a>`;
}

// 🧱 <li> für ein Canvas erzeugen (ids bleiben wie vorher)
function makeCanvasItem(canvasId, right) {
  const li = document.createElement("li");
  li.id = `canvas-li-${canvasId}`;
  li.setAttribute("data-canvas-id", canvasId);
  li.innerHTML = canvasItemHTML(canvasId, right);
  return li;
}

// 🔢 Zähler + Leerzustand aktualisieren
function refreshCanvasListState() {
  const list = document.getElementById("canvasList");
  if (!list) return;
  const n = list.children.length;
  const empty = document.getElementById("canvasEmpty");
  if (empty) empty.classList.toggle("hidden", n > 0);
  const count = document.getElementById("canvasCount");
  if (count) count.textContent = n === 1 ? "1 Canvas" : `${n} Canvases`;
}

// ⚠️ Fehler in der Karte anzeigen statt per alert()
function showAuthError(message) {
  const box = document.getElementById("authError");
  if (!box) { alert(message); return; }
  box.textContent = message;
  box.classList.remove("hidden", "animate-auth-shake");
  void box.offsetWidth; // Reflow erzwingen, damit die Animation neu startet
  box.classList.add("animate-auth-shake");
}

async function notify(title, body) {
  // Tab im Hintergrund und Notification erlaubt -> System-Notification
  if (document.visibilityState === 'hidden' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
      return;
    }
    if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        new Notification(title, { body });
        return;
      }
    }
  }
  // sonst: Toast in der Seite
  showToast(`${title}\n${body}`);
}

function openAuthWS() {
  if (window._authWS) return; // bereits offen
  const ws = new WebSocket("ws://localhost:3000/channel/");
  window._authWS = ws;

  ws.addEventListener("open", () => {
    console.log("🔐 Auth WS connected");
    // kein registerForCanvas nötig
  });

  // Platz für allgemeine Nachrichten (optional)
  const onMsg = (ev) => {
    // let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    // console.log("🔐 Auth WS msg:", msg);
  };
  ws.addEventListener("message", onMsg);
  window._authWSMsgHandler = onMsg;

  ws.addEventListener("close", () => console.log("🔐 Auth WS closed"));
  ws.addEventListener("error", (e) => console.log("🔐 Auth WS error:", e));
}

function closeAuthWS() {
  if (!window._authWS) return;
  try {
    if (window._authWSMsgHandler) {
      window._authWS.removeEventListener("message", window._authWSMsgHandler);
      window._authWSMsgHandler = null;
    }
    if (window._authWS.readyState === WebSocket.OPEN) {
      window._authWS.close();
    }
  } catch {}
  window._authWS = null;
}


function navigateTo(path) {
  history.pushState(null, null, path);
  render();
}
window.navigateTo = navigateTo;


// 🔁 Nur einmal registrieren — nicht innerhalb von navigateTo()
window.addEventListener("popstate", () => {
  console.log("🔙 Zurück/Vorwärts im Browser-Verlauf");
  render();
});

if (!history._isWrapped) {
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    console.log("📍 Pfad per pushState geändert:", args[2]);
    originalPushState.apply(history, args);
  };
  history._isWrapped = true;
}


// 🌐 Beim ersten Laden der Seite
console.log("🌐 Seite einmal vollständig geladen (reload).");

function render() {

  let prevPath = window._prevPath || null;
  window._prevPath = window.location.pathname;

  if (prevPath && prevPath.startsWith("/canvas/") && !window.location.pathname.startsWith("/canvas/")) {

    if (window._roleChangedHandler) {
      window.removeEventListener("role-changed", window._roleChangedHandler);
      document.removeEventListener("role-changed", window._roleChangedHandlerDoc);
      window._roleChangedHandler = null;
      window._roleChangedHandlerDoc = null;
    }


    // Listener der Benutzerliste aufräumen
    if (window._wsReadyHandler) {
      window.removeEventListener("websocket-ready", window._wsReadyHandler);
      window._wsReadyHandler = null;
    }
    if (window._onlineUsersHandler && window._activeWS) {
      window._activeWS.removeEventListener("message", window._onlineUsersHandler);
      window._onlineUsersHandler = null;
    }

    import("/drawer.js").then(mod => mod.cleanupCanvas && mod.cleanupCanvas());
  }

  // Auth-Seite verlassen -> leichten WS schließen
  if ((prevPath === "/login" || prevPath === "/register") &&
      window.location.pathname !== prevPath) {
    closeAuthWS();
  }

  if (prevPath === "/" && window.location.pathname !== "/") {
    if (window._homeWS && window._homeWS.readyState === WebSocket.OPEN) {
      if (window._homeWSMsgHandler) {
        window._homeWS.removeEventListener("message", window._homeWSMsgHandler);
        window._homeWSMsgHandler = null;
      }
      window._homeWS.close();
    }
    window._homeWS = null;
  }


  if (!isFirstLoad) {
      const reloadCheck = document.getElementById("reload-check");
      if (reloadCheck) reloadCheck.remove();
  }

  isFirstLoad = false;

  console.log("🎨 render() ausgeführt → Inhalt ohne Reload geändert");

  const app = document.getElementById("app");
  const path = window.location.pathname;

    if (path === "/login") {
        app.innerHTML = `
          <div class="tw-scope fixed inset-0 overflow-auto font-sans bg-slate-100 dark:bg-slate-950">
            <div class="pointer-events-none absolute inset-0 overflow-hidden">
              <div class="absolute -top-40 -left-40 size-96 rounded-full bg-blue-300/50 blur-3xl dark:bg-blue-600/20"></div>
              <div class="absolute -right-40 -bottom-40 size-96 rounded-full bg-violet-300/50 blur-3xl dark:bg-violet-600/20"></div>
            </div>

            <div class="relative grid min-h-full place-items-center p-6">
              <div class="animate-auth-in w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900">

                <div class="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-linear-to-br from-blue-500 to-violet-500 text-white shadow-lg shadow-blue-500/30">
                  <svg class="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
                    <path d="M2 2l7.586 7.586"></path>
                    <circle cx="11" cy="11" r="2"></circle>
                  </svg>
                </div>

                <h2 class="mb-1 text-center text-2xl font-bold text-slate-900 dark:text-white">Willkommen zurück</h2>
                <p class="mb-6 text-center text-sm text-slate-500 dark:text-slate-400">Melde dich an, um weiterzuzeichnen.</p>

                <div id="authError"
                     class="mb-4 hidden rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"></div>

                <form id="loginForm">
                  <div class="mb-3.5">
                    <label for="email" class="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">E-Mail</label>
                    <span class="relative block">
                      <input type="email" name="email" id="email" placeholder="name@beispiel.de"
                             autocomplete="email" required
                             class="peer w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-11 pl-10 text-[15px] text-slate-900 transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500">
                      <svg class="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-slate-400 transition-colors peer-focus:text-blue-500"
                           viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                        <path d="M22 6l-10 7L2 6"></path>
                      </svg>
                    </span>
                  </div>

                  <div class="mb-3.5">
                    <label for="password" class="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">Passwort</label>
                    <span class="relative block">
                      <input type="password" name="password" id="password" placeholder="••••••••"
                             autocomplete="current-password" required
                             class="peer w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-11 pl-10 text-[15px] text-slate-900 transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500">
                      <svg class="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-slate-400 transition-colors peer-focus:text-blue-500"
                           viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2"></rect>
                        <path d="M7 11V7a5 5 0 0110 0v4"></path>
                      </svg>
                      <button type="button" aria-label="Passwort anzeigen" onclick="toggleAuthPassword(this)"
                              class="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-lg bg-transparent p-0 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300">
                        <svg class="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                      </button>
                    </span>
                  </div>

                  <button type="submit"
                          class="mt-2 w-full cursor-pointer rounded-xl bg-linear-to-br from-blue-500 to-violet-500 px-4 py-3 text-[15px] font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:-translate-y-px hover:shadow-xl hover:shadow-blue-500/40 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none disabled:hover:translate-y-0">
                    Login
                  </button>
                </form>

                <p class="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">Noch kein Konto?
                  <a href="/register" onclick="navigateTo('/register'); return false;"
                     class="font-semibold text-blue-600 no-underline hover:underline dark:text-blue-400">Jetzt registrieren</a>
                </p>
              </div>
            </div>
          </div>
        `;
      openAuthWS();
    }


    else if (path === "/register") {
    app.innerHTML = `
      <div class="tw-scope fixed inset-0 overflow-auto font-sans bg-slate-100 dark:bg-slate-950">
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
          <div class="absolute -top-40 -left-40 size-96 rounded-full bg-blue-300/50 blur-3xl dark:bg-blue-600/20"></div>
          <div class="absolute -right-40 -bottom-40 size-96 rounded-full bg-violet-300/50 blur-3xl dark:bg-violet-600/20"></div>
        </div>

        <div class="relative grid min-h-full place-items-center p-6">
          <div class="animate-auth-in w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900">

            <div class="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-linear-to-br from-blue-500 to-violet-500 text-white shadow-lg shadow-blue-500/30">
              <svg class="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M19 8v6M22 11h-6"></path>
              </svg>
            </div>

            <h2 class="mb-1 text-center text-2xl font-bold text-slate-900 dark:text-white">Konto erstellen</h2>
            <p class="mb-6 text-center text-sm text-slate-500 dark:text-slate-400">In wenigen Sekunden startklar.</p>

            <div id="authError"
                 class="mb-4 hidden rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"></div>

            <form id="registerForm">
              <div class="mb-3.5">
                <label for="email" class="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">E-Mail</label>
                <span class="relative block">
                  <input type="email" name="email" id="email" placeholder="name@beispiel.de"
                         autocomplete="email" required
                         class="peer w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-11 pl-10 text-[15px] text-slate-900 transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500">
                  <svg class="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-slate-400 transition-colors peer-focus:text-blue-500"
                       viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                    <path d="M22 6l-10 7L2 6"></path>
                  </svg>
                </span>
              </div>

              <div class="mb-3.5">
                <label for="password" class="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">Passwort</label>
                <span class="relative block">
                  <input type="password" name="password" id="password" placeholder="Mindestens 6 Zeichen"
                         autocomplete="new-password" required
                         class="peer w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-11 pl-10 text-[15px] text-slate-900 transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500">
                  <svg class="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-slate-400 transition-colors peer-focus:text-blue-500"
                       viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2"></rect>
                    <path d="M7 11V7a5 5 0 0110 0v4"></path>
                  </svg>
                  <button type="button" aria-label="Passwort anzeigen" onclick="toggleAuthPassword(this)"
                          class="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-lg bg-transparent p-0 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300">
                    <svg class="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  </button>
                </span>
              </div>

              <div class="mb-3.5">
                <label for="displayName" class="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">Anzeigename</label>
                <span class="relative block">
                  <input type="text" name="displayName" id="displayName" placeholder="Wie sollen dich andere sehen?"
                         autocomplete="nickname" required
                         class="peer w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-11 pl-10 text-[15px] text-slate-900 transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500">
                  <svg class="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-slate-400 transition-colors peer-focus:text-blue-500"
                       viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                </span>
              </div>

              <button type="submit"
                      class="mt-2 w-full cursor-pointer rounded-xl bg-linear-to-br from-blue-500 to-violet-500 px-4 py-3 text-[15px] font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:-translate-y-px hover:shadow-xl hover:shadow-blue-500/40 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none disabled:hover:translate-y-0">
                Registrieren
              </button>
            </form>

            <p class="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">Schon ein Konto?
              <a href="/login" onclick="navigateTo('/login'); return false;"
                 class="font-semibold text-blue-600 no-underline hover:underline dark:text-blue-400">Zum Login</a>
            </p>
          </div>
        </div>
      </div>
    `;
    openAuthWS();
    }


    else if (path === "/") {
    // Token prüfen
    fetch("/api/me")
        .then(res => {
        if (!res.ok) throw new Error("Not authenticated");
        return res.json();
        })
        .then(user => {
        app.innerHTML = `
          <div class="tw-scope min-h-screen bg-slate-100 font-sans dark:bg-slate-950">

            <header class="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div class="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
                <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-blue-500 to-violet-500 text-white shadow-md shadow-blue-500/25">
                  <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
                    <path d="M2 2l7.586 7.586"></path>
                    <circle cx="11" cy="11" r="2"></circle>
                  </svg>
                </span>
                <span class="font-semibold text-slate-900 dark:text-white">Zeichenprogramm</span>
                <span class="ml-auto flex items-center gap-2 rounded-full bg-slate-100 py-1.5 pr-3 pl-1.5 dark:bg-slate-800">
                  <span class="grid size-6 place-items-center rounded-full bg-slate-300 text-[11px] font-bold text-slate-700 dark:bg-slate-600 dark:text-slate-200">
                    ${String(user.id).slice(0, 2).toUpperCase()}
                  </span>
                  <span class="max-w-40 truncate font-mono text-xs text-slate-500 dark:text-slate-400">${user.id}</span>
                </span>
                <button id="logoutBtn" type="button" title="Abmelden"
                        class="flex cursor-pointer items-center gap-1.5 rounded-lg bg-transparent px-2.5 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white">
                  <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"></path>
                    <path d="M16 17l5-5-5-5M21 12H9"></path>
                  </svg>
                  Abmelden
                </button>
              </div>
            </header>

            <main class="mx-auto max-w-4xl px-6 py-8">
              <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 class="m-0 text-2xl font-bold text-slate-900 dark:text-white">Meine Canvases</h2>
                  <p id="canvasCount" class="mt-1 mb-0 text-sm text-slate-500 dark:text-slate-400"></p>
                </div>
                <button id="createCanvas"
                        class="flex cursor-pointer items-center gap-2 rounded-xl bg-linear-to-br from-blue-500 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:-translate-y-px hover:shadow-xl hover:shadow-blue-500/40 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none disabled:hover:translate-y-0">
                  <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 5v14M5 12h14"></path>
                  </svg>
                  Neues Canvas
                </button>
              </div>

              <ul id="canvasList" class="m-0 grid list-none gap-3 p-0"></ul>

              <div id="canvasEmpty"
                   class="hidden rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900/60">
                <svg class="mx-auto mb-3 size-10 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                  <path d="M12 8v8M8 12h8"></path>
                </svg>
                <p class="m-0 text-sm font-semibold text-slate-700 dark:text-slate-300">Noch keine Canvases</p>
                <p class="mt-1 mb-0 text-sm text-slate-500 dark:text-slate-400">
                  Erstelle dein erstes Canvas oder lass dich zu einem einladen.
                </p>
              </div>
            </main>
          </div>
        `;

        document.getElementById("logoutBtn")?.addEventListener("click", (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          fetch("/api/logout", { method: "POST" })
            .then(res => res.json())
            .then(result => navigateTo(result.redirect))
            .catch(() => { btn.disabled = false; showToast("Abmelden fehlgeschlagen."); });
        });

        document.getElementById("createCanvas")?.addEventListener("click", (e) => {
          const btn = e.currentTarget;
          btn.disabled = true; // verhindert doppeltes Anlegen bei Doppelklick
          fetch("/api/create-canvas", {
            method: "POST"
          })
            .then(res => res.json())
            .then(data => {
              const canvasId = data.canvasId;
              navigateTo(`/canvas/${canvasId}`);
            })
            .catch(err => {
              btn.disabled = false;
              alert("Fehler beim Erstellen des Canvas: " + err.message);
            });
        });

        const list = document.getElementById("canvasList");
        for (const canvas of user.canvases) {
          list.appendChild(makeCanvasItem(canvas.canvasId, canvas.right));
        }
        refreshCanvasListState();


        if (!window._homeWS) {
          const ws = new WebSocket("ws://localhost:3000/channel/");
          window._homeWS = ws;

          ws.addEventListener("open", () => {
            console.log("🏠 Home WS connected");
            // kein registerForCanvas nötig
          });

        const onHomeMsg = (ev) => {
          let msg; try { msg = JSON.parse(ev.data); } catch { return; }

          if (msg.event === "invitedToCanvas") {
            notify(`🎉 Du wurdest eingeladen:\nCanvas: ${msg.canvasId}\nRecht: ${msg.accessLevel}`);
            if (window.location.pathname === "/") {
              if (list && !document.getElementById(`canvas-li-${msg.canvasId}`)) {
                list.appendChild(makeCanvasItem(msg.canvasId, msg.accessLevel));
                refreshCanvasListState();
              }
            }
          }

          // Canvas in Echtzeit aus der Home-Liste entfernen
          else if (msg.event === "canvasRemovedForYou") {
            if (window.location.pathname === "/") {
              let li = document.getElementById(`canvas-li-${msg.canvasId}`);
              // Fallback über data-canvas-id
              if (!li) {
                li = document.querySelector(`[data-canvas-id="${msg.canvasId}"]`);
              }
              if (li && li.parentElement) {
                li.parentElement.removeChild(li);
                refreshCanvasListState();
              }
            }
            try {
              notify(`⚠️ Canvas gelöscht: ${msg.canvasId}\nEs wurde von deinem Zugriff entfernt.`);
            } catch {}
          }

          else if (msg.event === "canvasAccessLevelChangedForYou") {
            try { notify(`🛡️ Dein Zugriff wurde geändert:\nCanvas: ${msg.canvasId}\nNeues Recht: ${msg.accessLevel}`); } catch {}

            // Auf der Home-Seite die Karte sofort aktualisieren
            if (window.location.pathname === "/") {
              const list = document.getElementById("canvasList");
              if (list) {
                let li = document.getElementById(`canvas-li-${msg.canvasId}`);
                // Fallback über data-canvas-id
                if (!li) li = document.querySelector(`[data-canvas-id="${msg.canvasId}"]`);

                if (li) {
                  // Karte mit dem neuen Recht neu rendern
                  li.innerHTML = canvasItemHTML(msg.canvasId, msg.accessLevel);
                } else {
                  // selten, aber sicher: Karte fehlt -> neu anlegen
                  list.appendChild(makeCanvasItem(msg.canvasId, msg.accessLevel));
                }
                refreshCanvasListState();
              }
            }
          }

        };


          ws.addEventListener("message", onHomeMsg);
          window._homeWSMsgHandler = onHomeMsg;

          ws.addEventListener("close", () => console.log("🏠 Home WS closed"));
          ws.addEventListener("error", (e) => console.log("🏠 Home WS error:", e));
        }

        
        })
        .catch(err => {
        console.warn("Not authenticated, redirecting to /login");
        navigateTo("/login");
        });
    }


    else if (path.startsWith("/canvas/")) {
      const canvasId = path.split("/")[2];
      app.innerHTML = `
        <div class="tw-scope min-h-screen bg-slate-100 font-sans dark:bg-slate-950">

          <header class="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div class="mx-auto flex max-w-[1320px] flex-wrap items-center gap-3 px-6 py-4">
              <a href="/" onclick="navigateTo('/'); return false;"
                 class="flex items-center gap-2 no-underline">
                <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-blue-500 to-violet-500 text-white shadow-md shadow-blue-500/25">
                  <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
                    <path d="M2 2l7.586 7.586"></path>
                    <circle cx="11" cy="11" r="2"></circle>
                  </svg>
                </span>
                <span class="font-semibold text-slate-900 dark:text-white">Zeichenprogramm</span>
              </a>

              <a href="/" onclick="navigateTo('/'); return false;"
                 class="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-slate-500 no-underline transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white">
                <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M15 18l-6-6 6-6"></path>
                </svg>
                Alle Canvases
              </a>

              <span class="ml-auto max-w-full truncate rounded-full bg-slate-100 px-3 py-1.5 font-mono text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                ${canvasId}
              </span>
            </div>
          </header>

          <main class="mx-auto max-w-[1320px] px-6 py-6">

            <p class="mt-0 mb-5 flex gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
              <svg class="mt-0.5 size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 16v-4M12 8h.01"></path>
              </svg>
              <span>Wählen Sie links Ihr Zeichenwerkzeug aus. Halten Sie dann die Maustaste
              gedrückt, ziehen Sie die Form auf und lassen Sie die Taste wieder los.</span>
            </p>

            <div class="mb-6 flex flex-wrap items-start gap-5">
              <ul class="tools m-0 flex w-40 shrink-0 list-none flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900"></ul>

              <div class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <canvas id="drawArea" width="1024" height="768"
                        class="block rounded-lg bg-slate-200 dark:bg-slate-700"></canvas>
              </div>
            </div>

            <section class="mb-6">
              <h3 class="mt-0 mb-2 text-base font-bold text-slate-900 dark:text-white">Event-Log</h3>
              <div class="flex flex-col items-start gap-3 sm:flex-row">
                <textarea id="eventLog" rows="10"
                          class="w-full flex-1 rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs text-slate-700 transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"></textarea>
                <button id="loadEvents"
                        class="shrink-0 cursor-pointer rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px hover:bg-slate-700 active:translate-y-0 dark:bg-slate-700 dark:hover:bg-slate-600">
                  Load from Event-Log
                </button>
              </div>
            </section>

            <div class="canvas-panels grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

              <div id="online-users-list" style="display:none;"
                   class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h4 class="mt-0 mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <span>👥</span> Benutzer
                </h4>
                <ul id="onlineUsersUl" class="m-0 flex list-none flex-col gap-2 p-0"></ul>
              </div>

              <div id="moderatedPanel" style="display:none;"
                   class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h4 class="mt-0 mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <span>🔒</span> Moderierter Modus
                </h4>
                <label class="flex cursor-pointer items-center gap-2 text-sm text-slate-600 select-none dark:text-slate-300">
                  <input type="checkbox" id="toggleModerated"
                         class="size-4 cursor-pointer accent-blue-600">
                  Moderated aktivieren
                </label>
              </div>

              <div id="accessPanel" style="display:none;"
                   class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h3 class="mt-0 mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <span>🛠️</span> Benutzerrechte verwalten
                </h3>
                <form id="accessForm" class="flex flex-col gap-2">
                  <label for="targetUserId" class="text-xs font-semibold text-slate-500 dark:text-slate-400">User ID</label>
                  <input type="text" name="targetUserId" id="targetUserId" required
                         placeholder="UUID des Benutzers"
                         class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 transition placeholder:font-sans placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white">

                  <label for="newAccessLevel" class="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Neues Zugriffsrecht</label>
                  <select name="newAccessLevel" id="newAccessLevel"
                          class="w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                    <option value="R">R (Read-Only)</option>
                    <option value="W">W (Write)</option>
                    <option value="V">V (Verwalten)</option>
                    <option value="M">M (Moderieren)</option>
                    <option value="O">O (Owner)</option>
                  </select>

                  <button type="submit"
                          class="mt-2 w-full cursor-pointer rounded-lg bg-linear-to-br from-blue-500 to-violet-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-500/25 transition hover:-translate-y-px hover:shadow-lg active:translate-y-0">
                    Set Access
                  </button>
                </form>
              </div>

              <div id="deleteCanvasPanel" style="display:none;"
                   class="rounded-2xl border border-red-200 bg-white p-4 shadow-sm dark:border-red-900/50 dark:bg-slate-900">
                <h4 class="mt-0 mb-1 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <span>🗑️</span> Canvas löschen
                </h4>
                <p class="mt-0 mb-3 text-xs text-slate-500 dark:text-slate-400">
                  Diese Aktion kann nicht rückgängig gemacht werden.
                </p>
                <button id="deleteCanvasBtn"
                        class="w-full cursor-pointer rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-red-600/25 transition hover:-translate-y-px hover:bg-red-700 active:translate-y-0">
                  Delete this Canvas
                </button>
              </div>
            </div>
          </main>
        </div>
      `;
      // Effektive Rolle des Benutzers auf diesem Canvas
      window._effectiveAccessLevel = null;

      // alten Listener aufräumen
      if (window._roleChangedHandler) {
        window.removeEventListener("role-changed", window._roleChangedHandler);
        window._roleChangedHandler = null;
      }

      // Rollenwechsel zur Laufzeit (wird vom drawer gemeldet)
      const roleChangedHandler = (ev) => {
        const { canvasId: evCanvas, newLevel } = ev.detail || {};
        if (evCanvas !== canvasId) return;
        console.log("[app] role-changed received", ev.detail);

        window._effectiveAccessLevel = newLevel;
        renderAdminPanels(canvasId, newLevel);
      };
      window.addEventListener("role-changed", roleChangedHandler);
      window._roleChangedHandler = roleChangedHandler;





      function updateAccessSelectDisabled(accessLevel) {
        const select = document.getElementById("newAccessLevel");
        if (!select) return;
        Array.from(select.options).forEach(opt => {
          // Moderator darf nur R/W/V vergeben -> M und O sperren
          if (accessLevel === "M" && (opt.value === "M" || opt.value === "O")) {
            opt.disabled = true;
          } else {
            opt.disabled = false;
          }
        });
      }


      function ensureOnlineUsersSubscription(canvasId) {
        // doppelte Registrierung verhindern
        if (window._wsReadyHandler) {
          window.removeEventListener("canvas-registered", window._wsReadyHandler);
          window._wsReadyHandler = null;
        }
        if (window._onlineUsersHandler && window._activeWS) {
          window._activeWS.removeEventListener("message", window._onlineUsersHandler);
          window._onlineUsersHandler = null;
        }

        const attach = () => {
          if (!window._activeWS) return;

          const onlineHandler = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.event === "onlineUsers" && msg.canvasId === canvasId) {
              const ul = document.getElementById("onlineUsersUl");
              if (!ul) return; // Grundgerüst muss schon im DOM sein
              ul.innerHTML = "";
              msg.users.forEach(u => {
                const li = document.createElement("li");
                const label = (u.displayName && u.displayName.trim()) ? u.displayName : u.userId;
                const dot = u.isOnline ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600";
                const badge = ACCESS_BADGE[u.access] || ACCESS_BADGE.R;
                li.className = "flex items-center gap-2";
                li.innerHTML = `
                  <span class="size-2 shrink-0 rounded-full ${dot}"></span>
                  <span class="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-300">${escapeHtml(label)}</span>
                  <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}">${ACCESS_LABELS[u.access] || escapeHtml(u.access)}</span>`;
                ul.appendChild(li);
              });

              // 🔎 Rechte-Cache für die schnelle Prüfung beim Absenden
              window._canvasAccessCache = window._canvasAccessCache || {};
              if (!window._canvasAccessCache[canvasId]) window._canvasAccessCache[canvasId] = {};
              const cache = window._canvasAccessCache[canvasId];

              msg.users.forEach(u => {
                cache[u.userId] = u.access; // "R" | "W" | "V" | "M" | "O"
              });

            }
          };

          window._activeWS.addEventListener("message", onlineHandler);
          window._onlineUsersHandler = onlineHandler;

          // Erstabfrage
          window._activeWS.send(JSON.stringify({ command: "getOnlineUsers", canvasId }));
        };

        if (window._activeWS && window._activeWS.readyState === WebSocket.OPEN) {
          attach();
        } else {
          window._wsReadyHandler = attach;
          window.addEventListener("canvas-registered", attach, { once: true });
        }
      }

      function renderAdminPanels(canvasId, accessLevel) {
        const onlinePanel    = document.getElementById("online-users-list");
        const moderatedPanel = document.getElementById("moderatedPanel");
        const accessPanel    = document.getElementById("accessPanel");
        const deletePanel    = document.getElementById("deleteCanvasPanel");

        // Panels ein-/ausblenden
        const showMO = ["M","O"].includes(accessLevel);
        if (onlinePanel)    onlinePanel.style.display    = showMO ? "" : "none";
        if (moderatedPanel) moderatedPanel.style.display = showMO ? "" : "none";
        if (accessPanel)    accessPanel.style.display    = showMO ? "" : "none";
        if (deletePanel)    deletePanel.style.display    = (accessLevel === "O") ? "" : "none";

        // Dropdown-Einschränkungen für Moderatoren
        updateAccessSelectDisabled(accessLevel);

        // Formular zum Ändern der Rechte nur einmal binden
        const accessForm = document.getElementById("accessForm");
        if (accessForm && !accessForm._bound) {
          accessForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const form = e.target;
            const data = new FormData(accessForm);
            const target = String(data.get("targetUserId") || "").trim();
            const newAccess = String(data.get("newAccessLevel"));

            if (target === window._currentUserId) {
              alert("❌ Du kannst deine eigenen Rechte nicht ändern!");
              return;
            }

            if (accessLevel === "M") {
              const cache = (window._canvasAccessCache && window._canvasAccessCache[canvasId]) || {};
              if (cache[target] === "O") {
                alert("❌ Du darfst die Rechte eines Owners nicht ändern.");
                return;
              }
            }

            window._activeWS?.send(JSON.stringify({
              command: "changeAccess",
              canvasId,
              targetUserId: target,
              newAccess
            }));
          });
          accessForm._bound = true;
        }

        // Initialwert für "moderated" + Listener (nur einmal)
        const moderatedCheckbox = document.getElementById("toggleModerated");
        if (moderatedCheckbox && !moderatedCheckbox._bound) {
          fetch(`/api/is-moderated?canvasId=${canvasId}`)
            .then(res => res.json())
            .then(data => {
              moderatedCheckbox.checked = !!data.isModerated;
            });

          moderatedCheckbox.addEventListener("change", (e) => {
            const checked = e.target.checked;
            window._activeWS?.send(JSON.stringify({
              command: "toggleModerated",
              canvasId,
              moderated: checked
            }));
          });
          moderatedCheckbox._bound = true;
        }

        // Löschen-Button (nur einmal)
        const deleteBtn = document.getElementById("deleteCanvasBtn");
        if (deleteBtn && !deleteBtn._bound) {
          deleteBtn.addEventListener("click", () => {
            if (!confirm("Dieses Canvas wird endgültig gelöscht. Fortfahren?")) return;
            window._activeWS?.send(JSON.stringify({
              command: "deleteCanvas",
              canvasId
            }));
          });
          deleteBtn._bound = true;
        }

        if (showMO) { // Benutzerliste abonnieren (füllt nur den Inhalt)
        ensureOnlineUsersSubscription(canvasId);
        }
      }



      function destroyAdminPanels() {
        ["online-users-list", "moderatedPanel", "accessPanel", "deleteCanvasPanel"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.style.display = "none";
        });

        // Abos bleiben bestehen
        if (window._wsReadyHandler) {
          window.removeEventListener("canvas-registered", window._wsReadyHandler);
          window._wsReadyHandler = null;
        }
        if (window._onlineUsersHandler && window._activeWS) {
          window._activeWS.removeEventListener("message", window._onlineUsersHandler);
          window._onlineUsersHandler = null;
        }
      }


      // 🎨 Canvas laden
      import("/drawer.js")
        .then(mod => mod.initCanvas(canvasId))
        .catch(err => console.error("Fehler beim Laden von drawer.js:", err));

      // 🔐 Zugriffsrecht prüfen und Werkzeuge ggf. sperren
      /*fetch("/api/me")
        .then(res => res.json())
        .then(user => {
          const access = user.canvases.find(c => c.canvasId === canvasId);
          if (!access) {
            alert("❌ Du hast keinen Zugriff auf dieses Canvas.");
            window.location.href = "/";
            return;
          }
          const accessLevel = access.right;

          window._currentUserId = user.id; 

          if (["M", "O"].includes(accessLevel)) {
            renderAdminPanels(canvasId, accessLevel);
          } else {
            destroyAdminPanels();
          }
        });*/
      fetch("/api/me")
        .then(res => res.json())
        .then(user => {
          const access = user.canvases.find(c => c.canvasId === canvasId);
          if (!access) {
            alert("❌ Du hast keinen Zugriff auf dieses Canvas.");
            window.location.href = "/";
            return;
          }
          const accessLevel = access.right;

          window._currentUserId = user.id;

          // Wenn die Rolle schon per role-changed geändert wurde,
          // diese als Basis nehmen und nichts überschreiben
          if (window._effectiveAccessLevel) {
            // Rollenwechsel bereits angewandt — nur Panels synchron halten
            renderAdminPanels(canvasId, window._effectiveAccessLevel);
          } else {
            // noch kein Event — mit der initialen Rolle rendern
            window._effectiveAccessLevel = accessLevel;
            if (["M", "O"].includes(accessLevel)) {
              renderAdminPanels(canvasId, accessLevel);
            } else {
              destroyAdminPanels();
            }
          }
        });
    }

    else {
      app.innerHTML = "<h2>404 Not Found</h2>";
    }



  // 🎯 Formulare verdrahten
  async function submitAuthForm(e, endpoint, failMessage) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const originalLabel = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Bitte warten…"; }

    try {
      const data = new FormData(form);
      const res = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams(data)
      });

      if (res.ok) {
        const result = await res.json();
        navigateTo(result.redirect);
        return;
      }
      showAuthError(failMessage);
    } catch (err) {
      showAuthError("Verbindung zum Server fehlgeschlagen.");
    }

    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  }

  document.getElementById("loginForm")?.addEventListener("submit", (e) =>
    submitAuthForm(e, "/api/login", "Login fehlgeschlagen. E-Mail oder Passwort ist falsch.")
  );

  document.getElementById("registerForm")?.addEventListener("submit", (e) =>
    submitAuthForm(e, "/api/register", "Registrierung fehlgeschlagen. Diese E-Mail ist evtl. schon vergeben.")
  );
}

render();

