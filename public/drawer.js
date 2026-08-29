import { ContextMenu, MenuItem, Separator } from "./context-menu.js";
const canvasWidth = 1024, canvasHeight = 768;
const handleSize = 6;
const handleColor = "cornflowerblue";
const replayEventLog = [];
export let globalCanvasId = "";
let globalSocket = null;
export let globalUserId = "";
let myAccessLevel = null;
let isModerated = false;
export const globalClientId = "c" + Math.floor(Math.random() * 1e15); // eindeutige ID pro Tab
console.log("🧠 Client ID:", globalClientId);
// Token lesen und daraus die userId extrahieren
fetch("/api/me")
    .then(response => {
    if (!response.ok) {
        throw new Error("Kein gültiger Token oder nicht eingeloggt");
    }
    return response.json();
})
    .then((data) => {
    globalUserId = data.id;
    console.log("👤 User ID erkannt:", globalUserId);
    // fetch(`/api/canvases?userId=${globalUserId}`)
})
    .catch(err => {
    console.warn("Fehler beim Laden von JWT-Infos:", err.message);
});
// Fallback toast for drawer.ts (if window.notify doesn't exist)
function ensureToastContainerDrawer() {
    if (document.getElementById('toast-container'))
        return;
    const el = document.createElement('div');
    el.id = 'toast-container';
    el.style.cssText = `
    position: fixed; right: 16px; bottom: 16px; z-index: 9999;
    display: flex; flex-direction: column; gap: 8px;
  `;
    document.body.appendChild(el);
}
function showToastDrawer(text, timeout = 4000) {
    ensureToastContainerDrawer();
    const wrap = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = `
    background:#333;color:#fff;padding:10px 12px;border-radius:8px;
    box-shadow:0 4px 12px rgba(0,0,0,.2); max-width: 360px; font-size: 14px;
  `;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), timeout);
}
export async function notify(title, body) {
    // 1) Wenn app.js notify() auf window bereitstellt, dieses verwenden
    if (typeof window.notify === "function") {
        try {
            await window.notify(title, body);
            return;
        }
        catch (_a) {
            // bei Fehler: lokalen Fallback weiterverwenden
        }
    }
    // 2) Tab im Hintergrund: System-Notification (falls erlaubt)
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
    // 3) sonst: Toast in der Seite
    showToastDrawer(`${title}\n${body}`);
}
function disableToolsUI() {
    document.querySelectorAll(".tools li").forEach(el => {
        el.style.pointerEvents = "none";
        el.style.opacity = "0.5";
    });
}
function enableToolsUI() {
    document.querySelectorAll(".tools li").forEach(el => {
        el.style.pointerEvents = "";
        el.style.opacity = "";
    });
}
/** Einzige gültige Stelle, um die Werkzeuge zu sperren bzw. freizugeben */
function applyPermissions() {
    // Werkzeugleiste noch nicht gebaut -> nichts tun
    const tools = document.querySelector(".tools");
    if (!tools) {
        return;
    }
    if (myAccessLevel === "R") {
        disableToolsUI();
        return;
    }
    if (myAccessLevel === "W") {
        if (isModerated)
            disableToolsUI();
        else
            enableToolsUI();
        return;
    }
    // V, M, O
    enableToolsUI();
}
function broadcastSelection(eventType, shapeId) {
    if (globalSocket && globalSocket.readyState === WebSocket.OPEN) {
        globalSocket.send(JSON.stringify({
            event: eventType,
            canvasId: globalCanvasId,
            shapeId,
            clientId: globalClientId
        }));
    }
}
export function connectWebSocket(canvasId, shapeManager, canvas) {
    globalCanvasId = canvasId;
    if (globalSocket) {
        // bestehende Verbindung zuerst schließen
        globalSocket.close();
        globalSocket = null;
    }
    const socket = new WebSocket("ws://localhost:3000/channel/");
    globalSocket = socket;
    socket.addEventListener("open", () => {
        console.log("✅ WebSocket verbunden", socket);
        // erst setzen, wenn die Verbindung wirklich offen ist
        window._activeWS = socket;
        console.log("✅ WebSocket verbunden und auf window gespeichert.");
        // app.js informieren, dass der Socket jetzt nutzbar ist
        //window.dispatchEvent(new CustomEvent("websocket-ready"));
        socket.send(JSON.stringify({
            command: "registerForCanvas",
            canvasId: canvasId
        }));
    });
    socket.addEventListener("message", (event) => {
        var _a, _b;
        console.log("Received message:", event.data);
        const msg = JSON.parse(event.data);
        if (msg.event === "changeAccessDenied") {
            // Fehlermeldung gilt nur für den anfragenden Client
            if (msg.reason === "moderatorCannotModifyOwnerOrModerator") {
                alert("❌ Du darfst die Rechte eines Owners/Moderators nicht ändern.");
            }
            else if (msg.reason === "moderatorCannotAssignThisLevel") {
                alert("❌ Als Moderator darfst du nur R/W/V vergeben.");
            }
            else if (msg.reason === "selfChangeNotAllowed") {
                alert("❌ Du kannst deine eigenen Rechte nicht ändern.");
            }
            else if (msg.reason === "noAccessOnCanvas") {
                alert("❌ Du hast keinen Zugriff auf dieses Canvas.");
            }
            else {
                alert("❌ Änderung der Zugriffsrechte nicht erlaubt.");
            }
            return; // weitere Handler nicht ausführen
        }
        if (msg.event === "initialSync" && msg.canvasId === canvasId) {
            console.log("📦 Initial sync erhalten:", msg.shapes);
            msg.shapes.forEach(shapeData => {
                let shape;
                switch (shapeData.type) {
                    case "Line":
                        shape = new Line(shapeData.data.from, shapeData.data.to, shapeData.id);
                        break;
                    case "Circle":
                        shape = new Circle(shapeData.data.center, shapeData.data.radius, shapeData.id);
                        break;
                    case "Rectangle":
                        shape = new Rectangle(shapeData.data.from, shapeData.data.to, shapeData.id);
                        break;
                    case "Triangle":
                        shape = new Triangle(shapeData.data.p1, shapeData.data.p2, shapeData.data.p3, shapeData.id);
                        break;
                }
                if (shape) {
                    shape.fillColor = shapeData.fillColor;
                    shape.borderColor = shapeData.borderColor;
                    shapeManager.addShape(shape, false); // hinzufügen ohne redraw
                }
            });
            canvas.draw(); // einmal rendern, nachdem alle Formen da sind
            window.dispatchEvent(new CustomEvent("canvas-registered", { detail: { canvasId } }));
        }
        else if (msg.event === "addShape" && msg.canvasId === canvasId) {
            if (msg.senderId === globalClientId) {
                return; // 🔁 eigene Nachricht — nicht erneut senden
            }
            // Neue Form empfangen
            console.log("🆕 Neue Form erhalten:", msg.shape);
            let shape;
            switch (msg.shape.type) {
                case "Line":
                    shape = new Line(msg.shape.from, msg.shape.to, msg.shape._id);
                    break;
                case "Circle":
                    shape = new Circle(msg.shape.center, msg.shape.radius, msg.shape._id);
                    break;
                case "Rectangle":
                    shape = new Rectangle(msg.shape.from, msg.shape.to, msg.shape._id);
                    break;
                case "Triangle":
                    shape = new Triangle(msg.shape.p1, msg.shape.p2, msg.shape.p3, msg.shape._id);
                    break;
            }
            if (shape) {
                shape.fillColor = msg.shape.fillColor;
                shape.borderColor = msg.shape.borderColor;
                const logLine = `DRAW ${msg.shape.type} ${JSON.stringify(msg.shape)}`;
                appendEventLog(logLine, true); // speichern und für das Replay verfügbar machen
                shapeManager.addShape(shape, true, false); // redraw = true, temporary = false
            }
        }
        else if (msg.event === "eventLog" && msg.canvasId === canvasId) {
            console.log("📥 EventLog-Eintrag erhalten:", msg.log);
            // im Event-Log-Fenster anzeigen
            (msg.log);
            // live auf dem Canvas ausführen
            replayFromText(msg.log, shapeManager, canvas);
        }
        else if (msg.event === "initialEventLog" && msg.canvasId === canvasId) {
            console.log("📥 Initial EventLog erhalten:", msg.logLines);
            canvas.clearCanvas();
            for (const line of msg.logLines) {
                appendEventLog(line, true, false); // anzeigen + speichern, ohne erneut an den Server zu senden
                replayFromText(line, shapeManager, canvas); // auf dem Canvas ausführen
            }
            canvas.draw();
        }
        else if (msg.event === "logReplay" && msg.canvasId === canvasId) {
            if (msg.senderId === globalClientId) {
                return; // 🔁 eigene Nachricht — nicht verarbeiten
            }
            console.log("📥 Event log replay received:", msg.logLine);
            appendEventLog(msg.logLine, true, false); // nur lokal abspielen, nicht erneut senden
            replayFromText(msg.logLine, shapeManager, canvas); // 👈 echtes Replay auf dem Canvas
        }
        else if ((msg.event === "selectShape" || msg.event === "unselectShape") && msg.canvasId === canvasId) {
            if (msg.clientId === globalClientId)
                return; // eigene Nachricht ignorieren
            if (msg.event === "selectShape") {
                canvas.selectedIds.add(msg.shapeId);
            }
            else {
                canvas.selectedIds.delete(msg.shapeId);
            }
            canvas.draw(); // Auswahl-Änderung sichtbar machen
        }
        /*else if (msg.event === "accessChanged" && msg.canvasId === canvasId) {
            console.log("🔁 Zugriff geändert:", msg);
    
            if (msg.targetUserId === globalUserId) {
                // Betrifft mich selbst -> neu laden, damit die neue Rolle greift
                alert("🛡️ Deine Zugriffsrechte wurden geändert. Die Seite wird neu geladen.");
                location.reload();
            } else {
                console.log("Zugriffsrecht eines anderen Benutzers wurde geändert:", msg);
            }
        }*/
        else if (msg.event === "moderatedChanged" && msg.canvasId === canvasId) {
            console.log("🔄 Drawer received moderatedChanged:", msg.moderated, "myAccessLevel=", myAccessLevel);
            // 1) State aktualisieren, bevor die Rechte angewandt werden
            isModerated = !!msg.moderated;
            // 2) Checkbox synchronisieren (falls vorhanden)
            const checkbox = document.getElementById("toggleModerated");
            if (checkbox && checkbox.checked !== isModerated) {
                checkbox.checked = isModerated;
            }
            if (myAccessLevel === "W") {
                if (isModerated) {
                    notify("🔒 Disabling tools: ", "Canvas is now moderated");
                    applyPermissions();
                }
                else {
                    notify("🔓 Enabling tools: ", "Canvas is no longer moderated");
                    applyPermissions();
                }
            }
            else {
                if (isModerated) {
                    notify("🔒", "Canvas is now moderated");
                }
                else {
                    notify("🔓", "Canvas is no longer moderated");
                }
            }
        }
        else if (msg.event === "accessChanged" && msg.canvasId === canvasId) {
            console.log("🔁 Zugriff geändert:", msg);
            if (msg.targetUserId === globalUserId) {
                myAccessLevel = msg.newAccessLevel;
                console.log("🟢 (Realtime) mein Zugriff:", myAccessLevel);
                notify("Dein Zugriff wurde geändert,", "die Seite wird aktualisiert.");
                // 1) Werkzeug-Sperren anwenden (zentrale Stelle)
                applyPermissions();
                // 2) app.js über den Rollenwechsel informieren (rendert die Panels)
                console.log("[drawer] dispatch role-changed", { canvasId, newLevel: myAccessLevel });
                window.dispatchEvent(new CustomEvent("role-changed", {
                    detail: { canvasId, newLevel: myAccessLevel }
                }));
                // 3) Bei M/O sofort die benötigten Daten nachladen
                if (["M", "O"].includes(myAccessLevel)) {
                    // Status der moderated-Checkbox synchronisieren
                    fetch(`/api/is-moderated?canvasId=${canvasId}`)
                        .then(r => r.json())
                        .then(d => {
                        const cb = document.getElementById("toggleModerated");
                        if (cb)
                            cb.checked = !!d.isModerated;
                    })
                        .catch(console.error);
                    // Liste der Online-Benutzer anfordern
                    (_a = window._activeWS) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify({
                        command: "getOnlineUsers",
                        canvasId
                    }));
                }
            }
            else {
                // Rolle eines anderen Benutzers geändert -> Online-Liste auffrischen
                (_b = window._activeWS) === null || _b === void 0 ? void 0 : _b.send(JSON.stringify({
                    command: "getOnlineUsers",
                    canvasId
                }));
            }
        }
        // 1) Neue Einladung (erstmalige Vergabe)
        else if (msg.event === "invitedToCanvas") {
            try {
                notify(`🎉 Du wurdest eingeladen:`, `\nCanvas: ${msg.canvasId}\nRecht: ${msg.accessLevel}`);
            }
            catch (_c) { }
        }
        // 2) Zugriffsrecht dieses Benutzers geändert (gilt in jedem Tab)
        else if (msg.event === "canvasAccessLevelChangedForYou") {
            try {
                if (msg.canvasId !== globalCanvasId) {
                    notify(`🛡️ Dein Zugriff wurde geändert:`, `\nCanvas: ${msg.canvasId}\nNeues Recht: ${msg.accessLevel}`);
                }
            }
            catch (_d) { }
            // Betrifft das gerade geöffnete Canvas -> UI sofort synchronisieren
            if (msg.canvasId === globalCanvasId) {
                myAccessLevel = msg.accessLevel;
                // Werkzeuge je nach moderated-Status sperren bzw. freigeben
                if (myAccessLevel === "R") {
                    disableToolsUI();
                }
                else if (myAccessLevel === "W") {
                    if (isModerated)
                        disableToolsUI();
                    else
                        enableToolsUI();
                }
                else {
                    enableToolsUI();
                }
                // app.js informieren, damit die Admin-Panels auf-/abgebaut werden
                console.log("[drawer] dispatch role-changed", { canvasId, newLevel: myAccessLevel });
                window.dispatchEvent(new CustomEvent("role-changed", {
                    detail: { canvasId: globalCanvasId, newLevel: myAccessLevel }
                }));
            }
        }
        // 3) Ein Canvas mit Zugriff wurde gelöscht (evtl. ein anderes)
        else if (msg.event === "canvasRemovedForYou") {
            try {
                notify(`⚠️ Canvas gelöscht:`, ` ${msg.canvasId}\nEs wurde von deinem Zugriff entfernt.`);
            }
            catch (_e) { }
            // Fallback: betrifft es doch das aktuelle Canvas -> zurück zur Startseite
            if (globalCanvasId && msg.canvasId === globalCanvasId) {
                window.location.href = "/";
            }
        }
        else if (msg.event === "canvasDeleted" && msg.canvasId === canvasId) {
            try {
                notify("❌ Dieses Canvas", "wurde vom Besitzer gelöscht.");
            }
            catch (_f) { }
            cleanupCanvas(canvasId);
            // SPA-Navigation (ohne Reload)
            if (typeof window.navigateTo === "function") {
                window.navigateTo("/");
            }
            else {
                // fallback
                window.location.href = "/";
            }
        }
    });
    socket.addEventListener("close", () => {
        console.log("❌ Verbindung geschlossen");
    });
    socket.addEventListener("error", (err) => {
        console.error("⚠️ WebSocket-Fehler:", err);
    });
}
export function cleanupCanvas(currentCanvasId) {
    if (globalSocket && globalSocket.readyState === WebSocket.OPEN) {
        globalSocket.send(JSON.stringify({
            command: "unregisterForCanvas",
            canvasId: currentCanvasId
        }));
        globalSocket.close();
        globalSocket = null;
    }
}
function appendEventLog(message, forReplay = false, sendToServer = false) {
    const logElement = document.getElementById('eventLog');
    if (logElement) {
        logElement.value += message + "\n";
    }
    if (forReplay) {
        replayEventLog.push(message);
    }
    if (sendToServer && globalSocket && globalSocket.readyState === WebSocket.OPEN) {
        console.log("📤 Event sent to server:", message);
        globalSocket.send(JSON.stringify({
            command: "broadcastEvent",
            canvasId: globalCanvasId,
            senderId: globalClientId,
            event: message
        }));
    }
}
class Point2D {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
}
class AbstractShape {
    get id() {
        return this._id;
    }
    set id(value) {
        this._id = value;
        if (value >= AbstractShape.counter) {
            AbstractShape.counter = value + 1;
        }
    }
    applyStyles(ctx) {
        ctx.fillStyle = this.fillColor;
        ctx.strokeStyle = this.borderColor;
    }
    constructor(id) {
        this.fillColor = "rgba(0,0,0,0)";
        this.borderColor = "#000000";
        if (id !== undefined) {
            this._id = id;
            if (id >= AbstractShape.counter) {
                AbstractShape.counter = id + 1;
            }
        }
        else {
            this._id = AbstractShape.counter++;
        }
    }
}
AbstractShape.counter = 0;
class AbstractFactory {
    constructor(shapeManager) {
        this.shapeManager = shapeManager;
    }
    handleMouseDown(x, y) {
        this.from = new Point2D(x, y);
        //appendEventLog(`MOUSE_DOWN at (${x},${y})`); 
    }
    handleMouseUp(x, y) {
        if (this.tmpShape) {
            this.shapeManager.removeShapeWithId(this.tmpShape.id, false);
            this.tmpShape = undefined;
        }
        const finalShape = this.createShape(this.from, new Point2D(x, y));
        this.shapeManager.addShape(finalShape, true, false);
        //appendEventLog(`MOUSE_UP at (${x},${y})`); 
        appendEventLog(`DRAW ${finalShape.constructor.name} ${JSON.stringify(finalShape)}`, true, true);
        this.from = undefined;
        this.tmpTo = undefined;
        console.log("Final shape sent:", finalShape.id);
    }
    handleMouseMove(x, y) {
        // show temp circle only, if the start point is defined;
        if (!this.from) {
            return;
        }
        if (!this.tmpTo || (this.tmpTo.x !== x || this.tmpTo.y !== y)) {
            //appendEventLog(`MOUSE_MOVE to (${x},${y})`);
            this.tmpTo = new Point2D(x, y);
            if (this.tmpShape) {
                // remove the old temp line, if there was one
                this.shapeManager.removeShapeWithId(this.tmpShape.id, false);
            }
            // adds a new temp line
            this.tmpShape = this.createShape(this.from, new Point2D(x, y));
            this.shapeManager.addShape(this.tmpShape, true, true); // temporary = true
            console.log("Temporary shape added locally:", this.tmpShape.id);
        }
    }
}
class Line extends AbstractShape {
    constructor(from, to, id) {
        super(id);
        this.from = from;
        this.to = to;
    }
    draw(ctx, marked = false) {
        this.applyStyles(ctx);
        ctx.beginPath();
        ctx.moveTo(this.from.x, this.from.y);
        ctx.lineTo(this.to.x, this.to.y);
        ctx.stroke();
        if (marked) {
            ctx.fillStyle = handleColor;
            ctx.fillRect(this.from.x - handleSize / 2, this.from.y - handleSize / 2, handleSize, handleSize);
            ctx.fillRect(this.to.x - handleSize / 2, this.to.y - handleSize / 2, handleSize, handleSize);
        }
    }
    getExportData() {
        return {
            from: this.from,
            to: this.to,
            fillColor: this.fillColor,
            borderColor: this.borderColor
        };
    }
}
class LineFactory extends AbstractFactory {
    constructor(shapeManager) {
        super(shapeManager);
        this.label = "Linie";
    }
    createShape(from, to) {
        return new Line(from, to);
    }
}
class Circle extends AbstractShape {
    constructor(center, radius, id) {
        super(id);
        this.center = center;
        this.radius = radius;
    }
    draw(ctx, marked = false) {
        this.applyStyles(ctx);
        ctx.beginPath();
        ctx.arc(this.center.x, this.center.y, this.radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        if (marked) {
            ctx.fillStyle = handleColor;
            const pts = [
                new Point2D(this.center.x - this.radius, this.center.y),
                new Point2D(this.center.x + this.radius, this.center.y),
                new Point2D(this.center.x, this.center.y - this.radius),
                new Point2D(this.center.x, this.center.y + this.radius),
            ];
            for (const p of pts) {
                ctx.fillRect(p.x - handleSize / 2, p.y - handleSize / 2, handleSize, handleSize);
            }
        }
    }
    getExportData() {
        return {
            center: this.center,
            radius: this.radius,
            fillColor: this.fillColor,
            borderColor: this.borderColor
        };
    }
}
class CircleFactory extends AbstractFactory {
    constructor(shapeManager) {
        super(shapeManager);
        this.label = "Kreis";
    }
    createShape(from, to) {
        return new Circle(from, CircleFactory.computeRadius(from, to.x, to.y));
    }
    static computeRadius(from, x, y) {
        const xDiff = (from.x - x), yDiff = (from.y - y);
        return Math.sqrt(xDiff * xDiff + yDiff * yDiff);
    }
}
class Rectangle extends AbstractShape {
    constructor(from, to, id) {
        super(id);
        this.from = from;
        this.to = to;
    }
    draw(ctx, marked = false) {
        this.applyStyles(ctx);
        ctx.beginPath();
        ctx.fillRect(this.from.x, this.from.y, this.to.x - this.from.x, this.to.y - this.from.y);
        ctx.strokeRect(this.from.x, this.from.y, this.to.x - this.from.x, this.to.y - this.from.y);
        if (marked) {
            ctx.fillStyle = handleColor;
            const corners = [
                this.from,
                new Point2D(this.to.x, this.from.y),
                this.to,
                new Point2D(this.from.x, this.to.y)
            ];
            for (const c of corners) {
                ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
            }
        }
    }
    getExportData() {
        return {
            from: this.from,
            to: this.to,
            fillColor: this.fillColor,
            borderColor: this.borderColor
        };
    }
}
class RectangleFactory extends AbstractFactory {
    constructor(shapeManager) {
        super(shapeManager);
        this.label = "Rechteck";
    }
    createShape(from, to) {
        return new Rectangle(from, to);
    }
}
class Triangle extends AbstractShape {
    constructor(p1, p2, p3, id) {
        super(id);
        this.p1 = p1;
        this.p2 = p2;
        this.p3 = p3;
    }
    draw(ctx, marked = false) {
        this.applyStyles(ctx);
        ctx.beginPath();
        ctx.moveTo(this.p1.x, this.p1.y);
        ctx.lineTo(this.p2.x, this.p2.y);
        ctx.lineTo(this.p3.x, this.p3.y);
        ctx.lineTo(this.p1.x, this.p1.y);
        ctx.fill();
        ctx.stroke();
        if (marked) {
            ctx.fillStyle = handleColor;
            for (const p of [this.p1, this.p2, this.p3]) {
                ctx.fillRect(p.x - handleSize / 2, p.y - handleSize / 2, handleSize, handleSize);
            }
        }
    }
    getExportData() {
        return {
            p1: this.p1,
            p2: this.p2,
            p3: this.p3,
            fillColor: this.fillColor,
            borderColor: this.borderColor
        };
    }
}
class TriangleFactory {
    constructor(shapeManager) {
        this.shapeManager = shapeManager;
        this.label = "Dreieck";
    }
    handleMouseDown(x, y) {
        //appendEventLog(`MOUSE_DOWN at (${x},${y})`); 
        if (this.tmpShape) {
            this.shapeManager.removeShapeWithId(this.tmpShape.id, false);
            const finalShape = new Triangle(this.from, this.tmpTo, new Point2D(x, y));
            this.shapeManager.addShape(finalShape, true, false);
            appendEventLog(`DRAW Triangle ${JSON.stringify(finalShape)}`, true, true);
            this.from = undefined;
            this.tmpTo = undefined;
            this.tmpLine = undefined;
            this.thirdPoint = undefined;
            this.tmpShape = undefined;
        }
        else {
            this.from = new Point2D(x, y);
        }
    }
    handleMouseUp(x, y) {
        // remove the temp line, if there was one
        if (this.tmpLine) {
            this.shapeManager.removeShapeWithId(this.tmpLine.id, false);
            this.tmpLine = undefined;
            this.tmpTo = new Point2D(x, y);
            this.thirdPoint = new Point2D(x, y);
            this.tmpShape = new Triangle(this.from, this.tmpTo, this.thirdPoint);
            this.shapeManager.addShape(this.tmpShape, true);
        }
    }
    handleMouseMove(x, y) {
        if (!this.from) {
            return;
        }
        //appendEventLog(`MOUSE_MOVE to (${x},${y})`);
        if (this.tmpShape) { // second point already defined, update temp triangle
            if (!this.thirdPoint || (this.thirdPoint.x !== x || this.thirdPoint.y !== y)) {
                this.thirdPoint = new Point2D(x, y);
                if (this.tmpShape) {
                    // remove the old temp line, if there was one
                    this.shapeManager.removeShapeWithId(this.tmpShape.id, false);
                }
                // adds a new temp triangle
                this.tmpShape = new Triangle(this.from, this.tmpTo, this.thirdPoint);
                this.shapeManager.addShape(this.tmpShape, true, true); // temporary = true
            }
        }
        else { // no second point fixed, update tmp line
            if (!this.tmpTo || (this.tmpTo.x !== x || this.tmpTo.y !== y)) {
                this.tmpTo = new Point2D(x, y);
                if (this.tmpLine) {
                    // remove the old temp line, if there was one
                    this.shapeManager.removeShapeWithId(this.tmpLine.id, false);
                }
                // adds a new temp line
                this.tmpLine = new Line(this.from, this.tmpTo);
                this.shapeManager.addShape(this.tmpLine, true, true); // temporary = true
            }
        }
    }
}
class Shapes {
}
class ToolArea {
    constructor(shapesSelector, menue) {
        this.selectedShape = undefined;
        const domElms = [];
        shapesSelector.forEach(sl => {
            const domSelElement = document.createElement("li");
            domSelElement.innerText = sl.label;
            menue.appendChild(domSelElement);
            domElms.push(domSelElement);
            domSelElement.addEventListener("click", () => {
                selectFactory.call(this, sl, domSelElement);
            });
        });
        function selectFactory(sl, domElm) {
            // remove class from all elements
            for (let j = 0; j < domElms.length; j++) {
                domElms[j].classList.remove("marked");
            }
            this.selectedShape = sl;
            // add class to the one that is selected currently
            domElm.classList.add("marked");
        }
    }
    getSelectedShape() {
        return this.selectedShape;
    }
    setShapeFactories(factories, menue) {
        this.selectedShape = undefined;
        menue.innerHTML = ""; // vorheriges Menü leeren
        const domElms = [];
        factories.forEach(sl => {
            const domSelElement = document.createElement("li");
            domSelElement.innerText = sl.label;
            menue.appendChild(domSelElement);
            domElms.push(domSelElement);
            domSelElement.addEventListener("click", () => {
                // remove class from all elements
                for (let j = 0; j < domElms.length; j++) {
                    domElms[j].classList.remove("marked");
                }
                this.selectedShape = sl;
                // add class to the one that is selected currently
                domSelElement.classList.add("marked");
            });
        });
    }
}
class Canvas {
    insertShapeAt(shape, index, redraw = true) {
        this.shapes[shape.id] = shape;
        this.shapeList.splice(index, 0, shape);
        return redraw ? this.draw() : this;
    }
    getShapes() {
        return this.shapeList;
    }
    clearCanvas() {
        this.shapeList = [];
        this.shapes = {};
        this.selectedIds.clear();
        this.draw();
    }
    constructor(canvasDomElement, toolarea, canvasId) {
        this.canvasId = canvasId;
        this.shapes = {};
        this.shapeList = [];
        this.selectedIds = new Set();
        this.ctx = canvasDomElement.getContext("2d");
        canvasDomElement.addEventListener("mousemove", createMouseHandler("handleMouseMove"));
        canvasDomElement.addEventListener("mousedown", createMouseHandler("handleMouseDown"));
        canvasDomElement.addEventListener("mouseup", createMouseHandler("handleMouseUp"));
        function createMouseHandler(methodName) {
            return function (e) {
                e = e || window.event;
                if ('object' === typeof e) {
                    const btnCode = e.button, x = e.pageX - this.offsetLeft, y = e.pageY - this.offsetTop, ss = toolarea.getSelectedShape();
                    // if left mouse button is pressed,
                    // and if a tool is selected, do something
                    if (e.button === 0 && ss) {
                        const m = ss[methodName];
                        // This in the shapeFactory should be the factory itself.
                        m.call(ss, x, y);
                    }
                }
            };
        }
    }
    draw() {
        this.ctx.beginPath();
        this.ctx.fillStyle = 'lightgrey';
        this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        this.ctx.stroke();
        // draw shapes
        this.ctx.fillStyle = 'black';
        for (const shape of this.shapeList) {
            const marked = this.selectedIds.has(shape.id);
            shape.draw(this.ctx, marked);
        }
        return this;
    }
    addShape(shape, redraw = true, temporary = false) {
        console.log("Adding shape:", shape.id, shape.constructor.name, "temporary:", temporary, "caller:", new Error().stack);
        this.shapes[shape.id] = shape;
        this.shapeList.push(shape);
        /*if (!temporary && globalSocket && globalSocket.readyState === WebSocket.OPEN) {
            console.log("Sending to server:", shape.id, shape.constructor.name, temporary);
            const shapeType = shape.constructor.name;
            // Nachricht an den Server senden
            globalSocket.send(JSON.stringify({
            command: "shapeUpdate",
            action: "add",
            shape: {
                _id: shape.id,
                type: shapeType,
                ...shape.getExportData() // liefert die serialisierbaren Daten der Form
            },
            canvasId: this.canvasId, // muss im Canvas gesetzt sein
            senderId: globalClientId
            }));
        } */
        return redraw ? this.draw() : this;
    }
    removeShape(shape, redraw = true) {
        delete this.shapes[shape.id];
        const idx = this.shapeList.findIndex(s => s.id === shape.id);
        if (idx !== -1)
            this.shapeList.splice(idx, 1);
        return redraw ? this.draw() : this;
    }
    removeShapeWithId(id, redraw = true) {
        delete this.shapes[id];
        const idx = this.shapeList.findIndex(s => s.id === id);
        if (idx !== -1)
            this.shapeList.splice(idx, 1);
        return redraw ? this.draw() : this;
    }
    bringToFront(id) {
        const idx = this.shapeList.findIndex(s => s.id === id);
        if (idx > -1) {
            const [s] = this.shapeList.splice(idx, 1);
            this.shapeList.push(s);
        }
        return this;
    }
    sendToBack(id) {
        const idx = this.shapeList.findIndex(s => s.id === id);
        if (idx > -1) {
            const [s] = this.shapeList.splice(idx, 1);
            this.shapeList.unshift(s);
        }
        return this;
    }
    getShapeById(id) {
        return this.shapes[id];
    }
}
class SelectionFactory {
    constructor(getCanvas) {
        this.getCanvas = getCanvas;
        this.dragStart = null;
        this.label = "Selektion";
        this.lastHits = [];
        this.lastHitIndex = 0;
    }
    handleMouseDown(x, y) {
        const canvas = this.getCanvas();
        const tol = 5;
        const hits = canvas.getShapes().filter(shape => {
            if (shape instanceof Line) {
                const { from, to } = shape;
                const dx = to.x - from.x, dy = to.y - from.y;
                const len2 = dx * dx + dy * dy;
                const t = ((x - from.x) * dx + (y - from.y) * dy) / len2;
                const cx = from.x + t * dx, cy = from.y + t * dy;
                const nx = Math.max(Math.min(cx, Math.max(from.x, to.x)), Math.min(from.x, to.x));
                const ny = Math.max(Math.min(cy, Math.max(from.y, to.y)), Math.min(from.y, to.y));
                return Math.hypot(x - nx, y - ny) <= tol;
            }
            if (shape instanceof Rectangle) {
                const { from, to } = shape;
                const minX = Math.min(from.x, to.x), maxX = Math.max(from.x, to.x);
                const minY = Math.min(from.y, to.y), maxY = Math.max(from.y, to.y);
                return x >= minX && x <= maxX && y >= minY && y <= maxY;
            }
            if (shape instanceof Circle) {
                const { center, radius } = shape;
                return Math.hypot(x - center.x, y - center.y) <= radius;
            }
            if (shape instanceof Triangle) {
                const { p1, p2, p3 } = shape;
                function area(a, b, c) {
                    return Math.abs((a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2);
                }
                const A = area(p1, p2, p3);
                const A1 = area({ x, y }, p2, p3), A2 = area(p1, { x, y }, p3), A3 = area(p1, p2, { x, y });
                return Math.abs(A - (A1 + A2 + A3)) < 0.1;
            }
            return false;
        }).reverse();
        const evt = window.event;
        const alt = evt.altKey, ctrl = evt.ctrlKey;
        // Ohne CTRL wird die Auswahl immer zurückgesetzt
        if (!ctrl) {
            for (const id of canvas.selectedIds) {
                broadcastSelection("unselectShape", id);
                appendEventLog(`UNSELECT id=${id}`, true, true);
            }
            canvas.selectedIds.clear();
        }
        if (hits.length > 0) {
            const hitIds = hits.map(s => s.id);
            const lastIds = this.lastHits.map(s => s.id);
            const sameList = hitIds.length === lastIds.length && hitIds.every((id, i) => id === lastIds[i]);
            if (alt && sameList) {
                // Nur mit Alt zwischen überlappenden Formen durchschalten
                this.lastHitIndex = (this.lastHitIndex + 1) % hits.length;
            }
            else if (!sameList) {
                // neue Trefferliste
                this.lastHits = hits;
                this.lastHitIndex = 0; // immer mit der obersten Form beginnen
            }
            // Ohne Alt bleibt eine bestehende Auswahl unverändert
            else if (!alt && sameList && canvas.selectedIds.size > 0 && this.lastHits[this.lastHitIndex]) {
                canvas.selectedIds.add(this.lastHits[this.lastHitIndex].id);
                canvas.draw();
                this.dragStart = new Point2D(x, y);
                return;
            }
            const chosen = this.lastHits[this.lastHitIndex];
            canvas.selectedIds.add(chosen.id);
            broadcastSelection("selectShape", chosen.id);
            appendEventLog(`SELECT id=${chosen.id}`, true, true);
        }
        this.dragStart = new Point2D(x, y);
        canvas.draw();
    }
    handleMouseMove(x, y) {
        if (!this.dragStart)
            return;
        const dx = x - this.dragStart.x;
        const dy = y - this.dragStart.y;
        const canvas = this.getCanvas();
        canvas.selectedIds.forEach(id => {
            const shape = canvas.shapes[id];
            if (shape instanceof Line) {
                shape.from = new Point2D(shape.from.x + dx, shape.from.y + dy);
                shape.to = new Point2D(shape.to.x + dx, shape.to.y + dy);
            }
            if (shape instanceof Circle) {
                shape.center = new Point2D(shape.center.x + dx, shape.center.y + dy);
            }
            if (shape instanceof Rectangle) {
                shape.from = new Point2D(shape.from.x + dx, shape.from.y + dy);
                shape.to = new Point2D(shape.to.x + dx, shape.to.y + dy);
            }
            if (shape instanceof Triangle) {
                shape.p1 = new Point2D(shape.p1.x + dx, shape.p1.y + dy);
                shape.p2 = new Point2D(shape.p2.x + dx, shape.p2.y + dy);
                shape.p3 = new Point2D(shape.p3.x + dx, shape.p3.y + dy);
            }
        });
        canvas.draw();
        this.dragStart = new Point2D(x, y);
    }
    handleMouseUp(x, y) {
        if (!this.dragStart)
            return;
        const dx = x - this.dragStart.x;
        const dy = y - this.dragStart.y;
        const canvas = this.getCanvas();
        canvas.selectedIds.forEach(id => {
            const original = canvas.shapes[id];
            // 1. bisherige Position merken
            const index = canvas.getShapes().findIndex(s => s.id === id);
            // 2. alte Form entfernen
            appendEventLog(`DELETE id=${id}`, true, true);
            canvas.removeShape(original, false);
            // 3. verschobene Kopie erzeugen
            let newShape = null;
            if (original instanceof Line) {
                newShape = new Line(new Point2D(original.from.x + dx, original.from.y + dy), new Point2D(original.to.x + dx, original.to.y + dy), original.id);
            }
            else if (original instanceof Circle) {
                newShape = new Circle(new Point2D(original.center.x + dx, original.center.y + dy), original.radius, original.id);
            }
            else if (original instanceof Rectangle) {
                newShape = new Rectangle(new Point2D(original.from.x + dx, original.from.y + dy), new Point2D(original.to.x + dx, original.to.y + dy), original.id);
            }
            else if (original instanceof Triangle) {
                newShape = new Triangle(new Point2D(original.p1.x + dx, original.p1.y + dy), new Point2D(original.p2.x + dx, original.p2.y + dy), new Point2D(original.p3.x + dx, original.p3.y + dy), original.id);
            }
            // 4. Farben übernehmen
            if (newShape) {
                newShape.fillColor = original.fillColor;
                newShape.borderColor = original.borderColor;
                // 5. an der gemerkten Position wieder einfügen
                canvas.insertShapeAt(newShape, index, false);
                // 6. Event senden
                appendEventLog(`DRAW ${newShape.constructor.name} ${JSON.stringify(Object.assign(Object.assign({}, newShape), { zOrder: index // Position mitloggen
                 }))}`, true, true);
            }
        });
        canvas.draw();
        this.dragStart = null;
    }
}
const COLOR_OPTIONS = {
    "rgba(0,0,0,0)": "transparent",
    "#ff0000": "rot",
    "#00ff00": "grün",
    "#ffff00": "gelb",
    "#0000ff": "blau",
    "#000000": "schwarz"
};
const BORDER_COLOR_OPTIONS = Object.fromEntries(Object.entries(COLOR_OPTIONS).filter(([css]) => css !== "rgba(0,0,0,0)"));
export function initCanvas(canvasId) {
    const canvasDomElm = document.getElementById("drawArea");
    const menu = document.getElementsByClassName("tools")[0];
    globalCanvasId = canvasId;
    console.log("🖌️ Canvas ID:", canvasId);
    if (!canvasDomElm) {
        console.error("❌ Canvas nicht gefunden");
        return;
    }
    let canvas;
    // 1. leere ToolArea anlegen
    const shapesSelector = [];
    const toolArea = new ToolArea([], menu);
    // 2. Canvas anlegen
    canvas = new Canvas(canvasDomElm, toolArea, canvasId);
    // 3. ShapeManager anlegen (braucht das Canvas)
    const sm = {
        addShape(s, rd, temp) {
            return canvas.addShape(s, rd, temp);
        },
        removeShape(s, rd) {
            return canvas.removeShape(s, rd);
        },
        removeShapeWithId(id, rd) {
            return canvas.removeShapeWithId(id, rd);
        }
    };
    // 4. Werkzeuge erzeugen
    shapesSelector.push(new LineFactory(sm), new CircleFactory(sm), new RectangleFactory(sm), new TriangleFactory(sm), new SelectionFactory(() => canvas));
    // 5. Werkzeuge in der ToolArea setzen
    toolArea.setShapeFactories(shapesSelector, menu);
    // 1️⃣ myAccessLevel initialisieren
    //let myAccessLevel: string | null = null;
    fetch("/api/me")
        .then(res => res.json())
        .then(user => {
        const info = user.canvases.find((c) => c.canvasId === canvasId);
        myAccessLevel = info ? info.right : null;
        console.log("🔍 (Debug) myAccessLevel is:", myAccessLevel);
        // 2️⃣ moderated-Status vom Server holen
        return fetch(`/api/is-moderated?canvasId=${canvasId}`);
    })
        .then(res => res.json())
        .then(data => {
        const isMod = data.isModerated;
        console.log("🔍 (Debug) isModerated on load:", isMod);
        // 3️⃣ Rolle W + moderiertes Canvas -> Werkzeuge sperren
        if (myAccessLevel === "W" && isMod) {
            console.log("🔒 Disabling tools on initial load due to moderated=true");
            disableToolsUI();
        }
    })
        .catch(err => console.error("❌ Error checking access/moderated on init:", err));
    // 4️⃣ WebSocket verbinden
    connectWebSocket(canvasId, sm, canvas);
    // 5️⃣ Zugriffsrecht und moderated holen, dann anwenden
    Promise.all([
        fetch("/api/me").then(r => r.json()),
        fetch(`/api/is-moderated?canvasId=${canvasId}`).then(r => r.json()),
    ]).then(([me, info]) => {
        var _a;
        const acc = me.canvases.find((c) => c.canvasId === canvasId);
        myAccessLevel = (_a = acc === null || acc === void 0 ? void 0 : acc.right) !== null && _a !== void 0 ? _a : null;
        isModerated = !!info.isModerated;
        console.log("🔍 init permissions:", { myAccessLevel, isModerated });
        applyPermissions(); // immer erst nach dem Bau der Werkzeugleiste aufrufen
    }).catch(console.error);
    const contextMenu = new ContextMenu();
    canvasDomElm.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (canvas.selectedIds.size === 0) {
            contextMenu.hide();
            return;
        }
        contextMenu.items = [];
        contextMenu.addItem(new MenuItem("In den Vordergrund", () => {
            canvas.selectedIds.forEach(id => {
                canvas.bringToFront(id);
                appendEventLog(`BRING_TO_FRONT id=${id}`, true, true);
            });
            canvas.draw();
        }));
        contextMenu.addItem(new MenuItem("In den Hintergrund", () => {
            canvas.selectedIds.forEach(id => {
                canvas.sendToBack(id);
                appendEventLog(`SEND_TO_BACK id=${id}`, true, true);
            });
            canvas.draw();
        }));
        contextMenu.addItem(new Separator());
        contextMenu.addItem(new MenuItem("Löschen", () => {
            const ids = Array.from(canvas.selectedIds);
            ids.forEach(id => {
                appendEventLog(`DELETE id=${id}`, true, true);
                canvas.removeShapeWithId(id, false);
                canvas.selectedIds.delete(id);
            });
            canvas.draw();
        }));
        contextMenu.addItem(new Separator());
        contextMenu.createRadioOption("Hintergrundfarbe", COLOR_OPTIONS, (() => {
            const ids = Array.from(canvas.selectedIds);
            return ids.length
                ? canvas.shapes[ids[0]].fillColor
                : null;
        })(), (cssKey) => {
            canvas.selectedIds.forEach(id => {
                const shape = canvas.shapes[id];
                shape.fillColor = cssKey;
                appendEventLog(`FILL_COLOR id=${id} color=${cssKey}`, true, true);
            });
            canvas.draw();
        });
        contextMenu.createRadioOption("Rahmenfarbe", BORDER_COLOR_OPTIONS, (() => {
            const ids = Array.from(canvas.selectedIds);
            return ids.length
                ? canvas.shapes[ids[0]].borderColor
                : null;
        })(), (cssKey) => {
            canvas.selectedIds.forEach(id => {
                const shape = canvas.shapes[id];
                shape.borderColor = cssKey;
                appendEventLog(`BORDER_COLOR id=${id} color=${cssKey}`, true, true);
            });
            canvas.draw();
        });
        //contextMenu.addItem(new Separator());
        contextMenu.show(e.pageX, e.pageY);
    });
    canvas.draw();
    document.getElementById('loadEvents').addEventListener('click', () => {
        const logElement = document.getElementById('eventLog');
        const events = logElement.value.trim().split("\n");
        canvas.clearCanvas();
        for (const event of events) {
            replayFromText(event, sm, canvas);
        }
        canvas.draw();
    });
}
export function replayFromText(singleLine, shapeManager, canvasInstance) {
    var _a, _b;
    const shapeMap = new Map(); // nur ein Event, daher kein Reset
    if (singleLine.startsWith("DRAW")) {
        const [_, type, ...data] = singleLine.split(" ");
        const shapeData = JSON.parse(data.join(" "));
        const id = (_a = shapeData._id) !== null && _a !== void 0 ? _a : shapeData.id;
        let shape;
        switch (type) {
            case 'Line':
                shape = new Line(shapeData.from, shapeData.to, id);
                break;
            case 'Circle':
                shape = new Circle(shapeData.center, shapeData.radius, id);
                break;
            case 'Rectangle':
                shape = new Rectangle(shapeData.from, shapeData.to, id);
                break;
            case 'Triangle':
                shape = new Triangle(shapeData.p1, shapeData.p2, shapeData.p3, id);
                break;
        }
        if (shape) {
            shape.fillColor = shapeData.fillColor;
            shape.borderColor = shapeData.borderColor;
            const zOrder = (_b = shapeData.zOrder) !== null && _b !== void 0 ? _b : null;
            if (zOrder !== null && typeof canvasInstance.insertShapeAt === "function") {
                canvasInstance.insertShapeAt(shape, zOrder, true);
            }
            else {
                shapeManager.addShape(shape, true);
            }
        }
    }
    else if (singleLine.startsWith("DELETE")) {
        const match = singleLine.match(/id=(\d+)/);
        if (match) {
            const id = parseInt(match[1]);
            shapeManager.removeShapeWithId(id, true);
        }
    }
    else if (singleLine.startsWith("FILL_COLOR")) {
        const match = singleLine.match(/id=(\d+)\s+color=(.+)/);
        if (match) {
            const id = parseInt(match[1]);
            const color = match[2].trim(); // kann führende/abschließende Leerzeichen enthalten
            const shape = canvasInstance.getShapeById(id);
            if (shape) {
                shape.fillColor = color;
                canvasInstance.draw();
            }
        }
    }
    else if (singleLine.startsWith("BORDER_COLOR")) {
        const match = singleLine.match(/id=(\d+)\s+color=(.+)/);
        if (match) {
            const id = parseInt(match[1]);
            const color = match[2].trim();
            const shape = canvasInstance.getShapeById(id);
            if (shape) {
                shape.borderColor = color;
                canvasInstance.draw();
            }
        }
    }
    else if (singleLine.startsWith("BRING_TO_FRONT")) {
        const match = singleLine.match(/id=(\d+)/);
        if (match) {
            const id = parseInt(match[1]);
            canvasInstance.bringToFront(id);
            canvasInstance.draw();
        }
    }
    else if (singleLine.startsWith("SEND_TO_BACK")) {
        const match = singleLine.match(/id=(\d+)/);
        if (match) {
            const id = parseInt(match[1]);
            canvasInstance.sendToBack(id);
            canvasInstance.draw();
        }
    }
}
//# sourceMappingURL=drawer.js.map