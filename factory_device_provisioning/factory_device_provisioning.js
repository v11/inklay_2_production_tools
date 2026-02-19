/**
 * factory_device_register.js
 *
 * Factory tool to pre-register devices in Firebase RTDB:
 *   factoryDevices/<hardware_id> = { hardwareIdClaimHash, status, createdAt }
 *
 * Supports 3 modes:
 *  1) Manual:
 *     node device_register.js --manual --hardware_id "AA:BB:CC:DD:EE:FF" --claim_code "BASE64..."
 *
 *  2) Serial (recommended; NO piping, NO idf monitor):
 *     node device_register.js --serial /dev/cu.usbmodem101 --baud 115200
 *
 *  3) STDIN (optional):
 *     cat some_log.txt | node device_register.js --stdin
 *
 * Requirements:
 *  - tools/factory_register/.env containing:
 *      FIREBASE_DB_URL=https://<your-rtdb-root>
 *      DEVICE_SECRET_PEPPER=...
 *
 *  - Service account JSON stored at:
 *      tools/factory_register/service_accounts/<your-key>.json
 *    (gitignored)
 **/

import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import admin from "firebase-admin";
import { fileURLToPath } from "url";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

// Resolve paths relative to this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env next to this script (works regardless of current working directory)
dotenv.config({ path: path.join(__dirname, ".env") });

// Config
const DATABASE_URL = process.env.FIREBASE_DB_URL;
const PEPPER = process.env.DEVICE_SECRET_PEPPER;

// Put your service account filename here (or keep multiple and set via env)
const SERVICE_ACCOUNT_FILENAME = process.env.SERVICE_ACCOUNT_FILENAME || "inklay-2-beta-firebase-adminsdk-fbsvc-3f1143e230.json";

const SERVICE_ACCOUNT_PATH = path.join(__dirname,"service_accounts", SERVICE_ACCOUNT_FILENAME);

// Basic checks
if (!DATABASE_URL) {
  throw new Error("Missing FIREBASE_DB_URL in .env (must be RTDB root URL).");
}
if (!PEPPER) {
  throw new Error("Missing DEVICE_SECRET_PEPPER in .env.");
}
if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  throw new Error(`Service account JSON not found: ${SERVICE_ACCOUNT_PATH}`);
}

// Init Firebase
const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DATABASE_URL,
});

// Hashing
function hashWithPepper(value) {
  return crypto.createHmac("sha256", PEPPER).update(value, "utf8").digest("hex");
}

// Parse FACTORY line (robust against log prefixes)
function parseFactoryLine(line) {

  // Example line:
  // I (880) claim_code: FACTORY hardware_id=3C:0F:02:CF:E9:EC hardware_id_claim_code=....

  const idx = line.indexOf("FACTORY ");
  if (idx === -1) return null;

  const s = line.slice(idx);

  const hw = s.match(/hardware_id=([0-9A-Fa-f:]{17})/);
  const cc = s.match(/hardware_id_claim_code=([A-Za-z0-9+/=_-]+)/);

  if (!hw || !cc) return null;

  return {
    hardwareId: hw[1].toUpperCase(),
    claimCode: cc[1],
  };
}

// Write to Database
async function registerFactoryDevice(hardwareId, claimCode) {
const hardwareIdClaimHash = hashWithPepper(claimCode);

  await admin.database().ref(`factoryDevices/${hardwareId}`).set({
    hardwareIdClaimHash,
    status: "available",
    createdAt: admin.database.ServerValue.TIMESTAMP,
  });

  console.log(`Registered: ${hardwareId}`);
}

// CLI args
const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const get = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};

// Modes
async function runManual() {
  const hardwareId = get("--hardware_id");
  const claimCode = get("--claim_code");

  if (!hardwareId || !claimCode) {
    throw new Error('Manual mode requires: --hardware_id "AA:BB:.." --claim_code "..."');
  }

  await registerFactoryDevice(hardwareId.toUpperCase(), claimCode);
  // Keep running? No. Manual mode can exit.
  process.exit(0);
}

async function runStdin() {
  console.log("Listening on STDIN for FACTORY line...");

  process.stdin.setEncoding("utf8");

  process.stdin.on("data", async (chunk) => {
    const lines = String(chunk).split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseFactoryLine(line.trim());
      if (!parsed) continue;

      try {
        await registerFactoryDevice(parsed.hardwareId, parsed.claimCode);
        console.log("Unplug board, plug next…");
      } catch (e) {
        console.error("Register failed:", e?.message || e);
      }
    }
  });

  // Don’t exit; keep listening
}

async function runSerial(portPathOrAuto, baud = 115200) {
  console.log(`Serial mode @ ${baud}. Requested: ${portPathOrAuto}`);

  let port = null;
  let parser = null;
  let opening = false;
  let lastSeenPath = null;

  // Optional filters (recommended: set these in .env or pass via args if you want)
  const WANT_VID = (process.env.SERIAL_VID || "").toLowerCase(); // e.g. "10c4"
  const WANT_PID = (process.env.SERIAL_PID || "").toLowerCase(); // e.g. "ea60"
  const PATH_HINT = process.env.SERIAL_PATH_HINT || ""; // e.g. "usbmodem" or "SLAB_USBtoUART"

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function matchPort(p) {
    // If user provided an exact path and it exists, prefer that.
    if (portPathOrAuto && portPathOrAuto !== "auto") {
      // If it still exists, match exact
      if (p.path === portPathOrAuto) return true;

      // If the user provided something like "/dev/cu.usbmodem" as a hint, allow "startsWith"
      if (portPathOrAuto.includes("/dev/") && p.path.startsWith(portPathOrAuto)) return true;
    }

    // Match by VID/PID if provided (most robust)
    if (WANT_VID && WANT_PID) {
      const vid = (p.vendorId || "").toLowerCase();
      const pid = (p.productId || "").toLowerCase();
      if (vid === WANT_VID && pid === WANT_PID) return true;
    }

    // Otherwise use hint substring, if provided
    if (PATH_HINT) {
      if ((p.path || "").toLowerCase().includes(PATH_HINT.toLowerCase())) return true;
    }

    // Last fallback: if user asked "auto", try common modem/uart patterns
    if (portPathOrAuto === "auto") {
      const path = (p.path || "").toLowerCase();
      if (path.includes("usbmodem") || path.includes("usbserial") || path.includes("wchusbserial")) {
        return true;
      }
    }

    return false;
  }

  async function findMatchingPortPath() {
    const ports = await SerialPort.list();

    // Try to keep using the last working path first (fast reconnect if it comes back same)
    if (lastSeenPath) {
      const same = ports.find((p) => p.path === lastSeenPath);
      if (same) return same.path;
    }

    const match = ports.find(matchPort);
    return match ? match.path : null;
  }

  async function openLoop() {
    if (opening) return;
    opening = true;

    while (true) {
      const foundPath = await findMatchingPortPath();

      if (!foundPath) {
        // Nothing plugged in (or not matching). Keep waiting.
        await delay(500);
        continue;
      }

      // If already open on that path, stop.
      if (port && port.isOpen && lastSeenPath === foundPath) {
        opening = false;
        return;
      }

      // Clean up any previous port/parser
      try {
        if (parser) parser.removeAllListeners();
      } catch {}
      parser = null;

      try {
        if (port) {
          port.removeAllListeners();
          if (port.isOpen) await new Promise((res) => port.close(() => res()));
        }
      } catch {}
      port = null;

      console.log(`Opening serial: ${foundPath}`);
      lastSeenPath = foundPath;

      try {
        port = new SerialPort({ path: foundPath, baudRate: baud, autoOpen: true });

        parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

        parser.on("data", async (raw) => {
          const line = String(raw).trim();
          const parsed = parseFactoryLine(line);
          if (!parsed) return;

          try {
            await registerFactoryDevice(parsed.hardwareId, parsed.claimCode);
            console.log("Unplug board, plug next…");
          } catch (e) {
            console.error("Register failed:", e?.message || e);
          }
        });

        port.on("close", () => {
          console.log("Serial disconnected. Waiting for next board...");
          // Kick reconnect loop
          openLoop().catch((e) => console.error("Reconnect loop error:", e?.message || e));
        });

        port.on("error", (e) => {
          console.error("Serial error:", e?.message || e);
          // Many unplug scenarios surface as error then close; still ensure reconnect
          openLoop().catch((err) => console.error("Reconnect loop error:", err?.message || err));
        });

        console.log(`Listening on ${foundPath} for FACTORY line...`);
        opening = false;
        return;
      } catch (e) {
        console.error("Open failed, retrying:", e?.message || e);
        await delay(500);
      }
    }
  }

  // Start (and keep alive)
  await openLoop();
}

// ---------- Main ----------
(async function main() {
  try {
    if (has("--manual")) {
      await runManual();
      return;
    }

    if (has("--stdin")) {
      await runStdin();
      return;
    }

    const portPath = get("--serial");
    if (portPath) {
      const baud = Number(get("--baud") || "115200");
      await runSerial(portPath, baud);
      return;
    }

    console.log(
      [
        "Choose a mode:",
        "  Manual:",
        '    node device_register.js --manual --hardware_id "AA:BB:CC:DD:EE:FF" --claim_code "...."',
        "  Serial (recommended):",
        "    node device_register.js --serial /dev/cu.usbmodem101 --baud 115200",
        "  STDIN:",
        "    cat logs.txt | node device_register.js --stdin",
      ].join("\n")
    );
    process.exit(1);
  } catch (e) {
    console.error("Error", e?.message || e);
    process.exit(1);
  }
})();