// HMI server: bridges the PLC to browsers (WebSocket), handles logins, and serves the built React app.
//
// Flow:
//   1. A PLC driver (DRIVER in .env) loads the tag list and delivers value changes:
//        ads     Beckhoff TwinCAT. Tag list from the PLC symbol table, changes pushed by the PLC.
//        modbus  Modbus TCP. Tag list from modbus-tags.json, values polled.
//   2. The server forwards changes to every browser, and tells them when the PLC connection drops.
//   3. Each browser connection has a session (who is logged in, and their role).
//   4. Browsers send requests (write, login, manage users). The server checks the session and rules first.
//
// Which role can use which control is decided on the screens (React, minRole on each component).
// The server enforces: a login (or Operator auto-login) for any write, the tag write rule,
// and Admin for managing users.

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { existsSync } from 'fs';
import path from 'path';
import { hasRole, Role } from './roles';
import { PublicUser, UserStore } from './users';
import { Driver, TagInfo } from './drivers/driver';
import { AdsDriver } from './drivers/ads';
import { ModbusDriver } from './drivers/modbus';

// ---------------------------------------------------------------------------
// Settings (per machine, from .env; see .env.example)
// ---------------------------------------------------------------------------

if (existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;

const cfg = {
  driver:         (env.DRIVER ?? 'ads').toLowerCase(),
  httpPort:       Number(env.HTTP_PORT ?? 3000),
  webDir:         path.resolve(env.WEB_DIR ?? '../web/dist'),
  dataDir:        path.resolve(env.DATA_DIR ?? './data'),
  // Compared in lowercase: tag names are case-insensitive
  writeMember:    (env.WRITE_MEMBER ?? 'fValue').toLowerCase(),
  autoLogin:      (env.AUTO_LOGIN_OPERATOR ?? 'true').toLowerCase() === 'true',
  loginTimeoutMs: Number(env.LOGIN_TIMEOUT_MIN ?? 10) * 60_000,   // 0 = never time out
};

// ---------------------------------------------------------------------------
// PLC driver
// ---------------------------------------------------------------------------

function createDriver(): Driver {
  switch (cfg.driver) {
    case 'ads':
      return new AdsDriver({
        netId:       env.ADS_NET_ID ?? 'localhost',
        port:        Number(env.ADS_PORT ?? 851),
        subscribeMs: Number(env.SUBSCRIBE_MS ?? 100),
        prefix:      (env.HMI_PREFIX ?? 'GVL_HMI.').toLowerCase(),
        writeAttr:   (env.WRITE_ATTRIBUTE ?? 'hmi_write').toLowerCase(),
      });
    case 'modbus':
      if (!env.MODBUS_HOST) throw new Error('Set MODBUS_HOST in .env');
      return new ModbusDriver({
        host:         env.MODBUS_HOST,
        port:         Number(env.MODBUS_PORT ?? 502),
        unitId:       Number(env.MODBUS_UNIT_ID ?? 1),
        pollMs:       Number(env.MODBUS_POLL_MS ?? 250),
        timeoutMs:    Number(env.MODBUS_TIMEOUT_MS ?? 1000),
        lowWordFirst: (env.MODBUS_WORD_ORDER ?? 'low-first').toLowerCase() !== 'high-first',
        tagsFile:     path.resolve(env.MODBUS_TAGS ?? './modbus-tags.json'),
      });
    default:
      throw new Error(`Unknown DRIVER "${cfg.driver}". Use ads or modbus.`);
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let plcConnected = false;
let tags = new Map<string, TagInfo>();       // keyed by lowercase name
let values: Record<string, unknown> = {};    // latest value of each tag, sent to new browsers

// One session per browser connection
type Session = {
  user: PublicUser | null;   // null = nobody logged in (Operator auto-login or locked)
  role: Role | null;         // null = no rights at all
  lastActive: number;
};
const sessions = new Map<WebSocket, Session>();

const driver = createDriver();
const users = new UserStore(path.join(cfg.dataDir, 'users.json'));

// ---------------------------------------------------------------------------
// Web server and WebSocket
// ---------------------------------------------------------------------------

const app = express();
app.use(express.static(cfg.webDir));
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: object) {
  for (const ws of wss.clients) send(ws, msg);
}

wss.on('connection', (ws) => {
  sessions.set(ws, defaultSession());

  // Everything a new browser needs: who it is, who can log in, and every current value
  sendSession(ws);
  send(ws, { type: 'users', users: users.list() });
  send(ws, { type: 'plc', connected: plcConnected });
  send(ws, { type: 'snapshot', values });

  // Requests: { type, ...fields, reqId? }. With a reqId, the browser gets a 'result' reply.
  ws.on('message', async (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const session = sessions.get(ws)!;
    session.lastActive = Date.now();

    try {
      await handle(ws, session, msg);
      if (msg.reqId) send(ws, { type: 'result', reqId: msg.reqId, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (msg.reqId) send(ws, { type: 'result', reqId: msg.reqId, ok: false, error: message });
      else send(ws, { type: 'error', message });
    }
  });

  ws.on('close', () => sessions.delete(ws));
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

async function handle(ws: WebSocket, session: Session, msg: any) {
  switch (msg.type) {
    case 'write':
      if (!hasRole(session.role, 'operator')) throw new Error('Log in to make changes');
      if (!canWrite(msg.tag)) throw new Error(`Not writable: ${msg.tag}`);
      if (!plcConnected) throw new Error('PLC not connected');
      await driver.write(msg.tag, msg.value);
      return;

    case 'login': {
      const user = users.verify(String(msg.userId), String(msg.pin));   // throws on a bad PIN
      sessions.set(ws, { user, role: user.role, lastActive: Date.now() });
      sendSession(ws);
      return;
    }

    case 'logout':
      resetSession(ws);
      return;

    case 'activity':   // keeps the login alive while the operator is using the screen
      return;

    case 'users.create':
      requireAdmin(session);
      users.create(msg.name, msg.role, msg.pin);
      break;

    case 'users.update':
      requireAdmin(session);
      users.update(String(msg.id), { name: msg.name, role: msg.role, pin: msg.pin });
      break;

    case 'users.delete':
      requireAdmin(session);
      users.remove(String(msg.id));
      break;

    default:
      throw new Error(`Unknown request: ${msg.type}`);
  }

  // The user list changed: send it to everyone, and update anyone logged in as a changed user
  broadcast({ type: 'users', users: users.list() });
  refreshSessions();
}

function requireAdmin(session: Session) {
  if (!hasRole(session.role, 'admin')) throw new Error('Only an Admin can manage users');
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

// What a browser gets when nobody is logged in
function defaultSession(): Session {
  return { user: null, role: cfg.autoLogin ? 'operator' : null, lastActive: Date.now() };
}

function sendSession(ws: WebSocket) {
  const { user, role } = sessions.get(ws)!;
  send(ws, { type: 'session', user, role });
}

function resetSession(ws: WebSocket) {
  sessions.set(ws, defaultSession());
  sendSession(ws);
}

// After a user is edited or deleted, update or end their open sessions
function refreshSessions() {
  for (const [ws, session] of sessions) {
    if (!session.user) continue;
    const current = users.get(session.user.id);
    if (!current) {
      resetSession(ws);
    } else if (current.role !== session.role || current.name !== session.user.name) {
      sessions.set(ws, { ...session, user: current, role: current.role });
      sendSession(ws);
    }
  }
}

// Log out idle sessions, back to the default (Operator if auto-login is on)
if (cfg.loginTimeoutMs > 0) {
  setInterval(() => {
    const now = Date.now();
    for (const [ws, session] of sessions) {
      if (session.user && now - session.lastActive > cfg.loginTimeoutMs) resetSession(ws);
    }
  }, 5_000);
}

// ---------------------------------------------------------------------------
// Tag write rule
//   Writable plain variable:  the variable itself        (GVL_HMI.bStartCmd)
//   Writable struct:          its value member only      (GVL_HMI.stSpeedSP.fValue)
//   Everything else is rejected, including whole structs and their other members.
// ---------------------------------------------------------------------------

function canWrite(tagPath: unknown): boolean {
  if (typeof tagPath !== 'string') return false;
  const p = tagPath.toLowerCase();

  const tag = tags.get(p);
  if (tag) return tag.writable && !tag.isStruct;

  const dot = p.lastIndexOf('.');
  const parent = tags.get(p.slice(0, dot));
  const member = p.slice(dot + 1);
  return !!parent && parent.writable && parent.isStruct && member === cfg.writeMember;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  users.load();

  await driver.start({
    onTags(list) {
      tags = new Map(list.map((t) => [t.name.toLowerCase(), t]));
      values = {};
      const writableCount = list.filter((t) => t.writable).length;
      console.log(`Found ${list.length} HMI tags (${writableCount} writable)`);
      broadcast({ type: 'snapshot', values });
    },
    onValue(name, value) {
      values[name] = value;
      broadcast({ type: 'update', tag: name, value });
    },
    onStatus(connected) {
      plcConnected = connected;
      broadcast({ type: 'plc', connected });
    },
  });

  server.listen(cfg.httpPort, () =>
    console.log(`HMI on http://localhost:${cfg.httpPort} (driver: ${cfg.driver})`));
}

// If startup fails (bad settings, or an ADS PLC that isn't reachable), exit.
// systemd or Docker restarts the server and it tries again.
main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
