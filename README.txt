ANSELL EMPLOYEE DAY 2026 — LIVE MULTI-STATION REGISTRATION SYSTEM
====================================================================

WHAT THIS IS
------------
A live registration system for multiple barcode-scanning laptops at once.
One laptop runs a small local server (no database, no internet required,
no installs beyond Node.js itself). Every other laptop just opens a web
browser and points it at that laptop's address. All scans, the live
dashboard, and the "Recent Scanned Log" update instantly on every laptop
at the same time — no page refresh needed.

FILES
-----
  server.js          The server. Run this on ONE laptop ("the host").
  master.json         Your 3,731-employee list. Must stay next to server.js.
  public/index.html   The app itself. The server serves this automatically.

You do not need to touch master.json or public/index.html — just keep
all three items together in one folder.


ONE-TIME SETUP (on the HOST laptop only)
-----------------------------------------
1. Install Node.js if it isn't already installed:
   https://nodejs.org  (choose the LTS version, click through the installer)

2. Copy this whole folder onto the host laptop, e.g. to the Desktop.

3. Connect the host laptop to the WiFi that ALL the scanning laptops will
   use (a normal home/office router is fine — no internet connection is
   actually required, they just all need to be on the same network).


ON THE DAY — STARTING THE SYSTEM
----------------------------------
1. On the host laptop, open a terminal / command prompt in this folder
   and run:

       node server.js

2. You'll see something like:

       On THIS computer, open:
         http://localhost:8080

       On every OTHER laptop (same WiFi), open one of:
         http://192.168.1.23:8080

   Leave this terminal window open for the whole event — closing it stops
   the server for everyone.

3. On the HOST laptop's own browser, go to http://localhost:8080
   On EVERY OTHER scanning laptop, open a browser and go to the
   http://<ip-address>:8080 shown in step 2.

4. Each laptop will ask you to name its station once (e.g. "Main Gate",
   "Block A"). That name is only stored on that laptop and is shown next
   to every scan it records.

5. Start scanning. Every laptop's Recent Scans list, the Live Dashboard,
   its charts, and the full "Recent Scanned Log" table update on ALL
   laptops within a fraction of a second of any scan happening anywhere.


HOW DUPLICATE-SCAN SAFETY WORKS
---------------------------------
The host laptop's server is the single source of truth. Every scan from
every station is checked and recorded by that one server, one at a time,
so if the same employee is scanned at two stations in the same instant,
exactly one is marked REGISTERED and the other is correctly marked
DUPLICATE — this was tested with 20 simultaneous scans of the same
employee and behaved correctly every time.


IF THE SERVER RESTARTS
------------------------
The server automatically saves the scan log to a local file
(scan_log_backup.json) every time a scan happens, and reloads it on
startup — so restarting `node server.js` (e.g. after a laptop reboot)
does not lose any scans.


TROUBLESHOOTING
----------------
"A laptop can't connect" / "Could not reach the server":
  - Make sure that laptop is on the SAME WiFi network as the host.
  - Double check the IP address — it can change if the host reconnects
    to WiFi. Re-run `node server.js` to see the current address.
  - Some office WiFi networks block laptops from seeing each other
    ("client/AP isolation" or a "guest network"). Use a plain home-style
    router or a personal WiFi hotspot if this happens.
  - Check the host laptop's firewall isn't blocking incoming connections
    on port 8080 (Windows may prompt to "Allow access" the first time —
    click Allow).

"Reconnecting…" shown in the header:
  - Means that laptop's live connection to the server dropped (e.g. WiFi
    hiccup). It reconnects automatically within a couple of seconds and
    catches back up — no data is lost.

Want to change the port (e.g. 8080 is already used by something else)?
  - Run:  PORT=9090 node server.js   (Mac/Linux)
          set PORT=9090 && node server.js   (Windows cmd)
  - Then use http://<ip>:9090 on every laptop instead.
