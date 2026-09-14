// Ansell Employee Day 2026 — Live Registration Server
// Zero external dependencies. Only built-in Node.js modules.
// Run with:  node server.js
// Then on every laptop's browser, go to:  http://<this-computer's-LAN-IP>:8080

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = process.env.PORT || 8080;
const MASTER_PATH = path.join(__dirname, "master.json");
const BACKUP_PATH = path.join(__dirname, "scan_log_backup.json");
const PUBLIC_HTML = path.join(__dirname, "public", "index.html");

// ---------------------------------------------------------------------
// Load employee master list (source of truth for validation)
// ---------------------------------------------------------------------
let MASTER = [];
try {
  MASTER = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8")); // [[empNo, name, dept], ...]
} catch (e) {
  console.error("FATAL: could not read master.json next to server.js:", e.message);
  process.exit(1);
}
const byId = new Map();
const deptTotals = new Map();
MASTER.forEach(([empNo, name, dept]) => {
  byId.set(String(empNo), { empNo, name, dept });
  deptTotals.set(dept, (deptTotals.get(dept) || 0) + 1);
});
const TOTAL_ACTIVE = MASTER.length;

// ---------------------------------------------------------------------
// In-memory scan log — this process is the single source of truth.
// Node runs JS on a single thread, and every scan is resolved
// synchronously (no "await" inside the critical section), so two
// requests arriving at the exact same instant from different laptops
// are still processed one-at-a-time in order. That's what makes the
// duplicate check race-free without needing a database or locks.
// ---------------------------------------------------------------------
let log = [];
let registeredIds = new Set();
let logCounter = 0;

// Restore from local backup file if the server was restarted mid-event
try {
  if (fs.existsSync(BACKUP_PATH)) {
    const saved = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
    if (Array.isArray(saved.log)) {
      log = saved.log;
      logCounter = saved.logCounter || log.length;
      registeredIds = new Set(
        log.filter((e) => e.status === "REGISTERED").map((e) => String(e.empNo))
      );
      console.log(`Restored ${log.length} scans from local backup file.`);
    }
  }
} catch (e) {
  console.warn("Could not read backup file, starting with an empty log.", e.message);
}

let saveTimer = null;
function persistSoon() {
  // Debounced async write — never blocks scan processing.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(
      BACKUP_PATH,
      JSON.stringify({ log, logCounter }),
      (err) => { if (err) console.error("Backup write failed:", err.message); }
    );
  }, 250);
}

// ---------------------------------------------------------------------
// Server-Sent Events — pushes every scan (and reset) to all connected
// laptops/dashboards instantly, no polling, no page refresh needed.
// ---------------------------------------------------------------------
const sseClients = new Set();
function broadcast(type, payload) {
  const line = `data: ${JSON.stringify({ type, payload })}\n\n`;
  for (const res of sseClients) {
    res.write(line);
  }
}
setInterval(() => {
  for (const res of sseClients) res.write(": heartbeat\n\n");
}, 25000);

// ---------------------------------------------------------------------
// Core scan logic — fully synchronous critical section.
// ---------------------------------------------------------------------
function processScan(rawEmpNo, station) {
  const empNo = String(rawEmpNo).trim();
  const emp = byId.get(empNo);
  let status;
  if (!emp) {
    status = "NOT_FOUND";
  } else if (registeredIds.has(empNo)) {
    status = "DUPLICATE";
  } else {
    status = "REGISTERED";
  }

  const entry = {
    id: ++logCounter,
    empNo: emp ? emp.empNo : empNo,
    name: emp ? emp.name : "",
    dept: emp ? emp.dept : "",
    time: new Date().toISOString(),
    station: (station || "Unknown Station").toString().slice(0, 60),
    status
  };

  log.push(entry);
  if (status === "REGISTERED") registeredIds.add(empNo);

  persistSoon();
  broadcast("scan", entry);
  return entry;
}

function resetLog() {
  log = [];
  registeredIds = new Set();
  logCounter = 0;
  persistSoon();
  broadcast("reset", null);
}

// ---------------------------------------------------------------------
// Tiny HTTP router (no framework needed)
// ---------------------------------------------------------------------
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) { req.destroy(); reject(new Error("Body too large")); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    // ---- Serve the client app ----
    if (req.method === "GET" && url.pathname === "/") {
      const html = fs.readFileSync(PUBLIC_HTML, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // ---- Master employee list (for dashboard department totals) ----
    if (req.method === "GET" && url.pathname === "/api/master") {
      sendJSON(res, 200, { master: MASTER });
      return;
    }

    // ---- Full current log (initial hydrate on page load) ----
    if (req.method === "GET" && url.pathname === "/api/log") {
      sendJSON(res, 200, { log });
      return;
    }

    // ---- Live event stream ----
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      res.write("\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    // ---- Submit a scan ----
    if (req.method === "POST" && url.pathname === "/api/scan") {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
      if (!body.empNo || !String(body.empNo).trim()) {
        sendJSON(res, 400, { error: "Missing empNo" });
        return;
      }
      const entry = processScan(body.empNo, body.station);
      sendJSON(res, 200, { entry });
      return;
    }

    // ---- Reset the whole log ----
    if (req.method === "POST" && url.pathname === "/api/reset") {
      resetLog();
      sendJSON(res, 200, { ok: true });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  console.log("");
  console.log("=================================================");
  console.log(" Ansell Employee Day 2026 — Live Registration Server");
  console.log("=================================================");
  console.log(` Loaded ${MASTER.length} employees, ${deptTotals.size} departments.`);
  console.log("");
  console.log(" On THIS computer, open:");
  console.log(`   http://localhost:${PORT}`);
  console.log("");
  if (ips.length) {
    console.log(" On every OTHER laptop (same WiFi), open one of:");
    ips.forEach((ip) => console.log(`   http://${ip}:${PORT}`));
  } else {
    console.log(" Could not detect a LAN IP — make sure this computer is on WiFi/Ethernet.");
  }
  console.log("");
  console.log(" Keep this window open for the duration of the event.");
  console.log("=================================================");
  console.log("");
});
