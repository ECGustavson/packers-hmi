// Live connection to the HMI server: tag values, writes, the login session and the user list.
// Wrap the app in <HmiProvider> once. Components then use the hooks at the bottom of this file.

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { hasRole, Role } from './roles';

export type User = { id: string; name: string; role: Role };

type Hmi = {
  values: Record<string, unknown>;    // latest value of every tag, by name
  serverConnected: boolean;           // WebSocket to the HMI server is open
  connected: boolean;                 // server and PLC both connected: values are live, writes allowed
  user: User | null;                  // logged-in user, or null
  role: Role | null;                  // current rights (Operator when auto-logged in), or null
  users: User[];                      // everyone who can log in, for the login screen
  write: (tag: string, value: unknown) => void;
  request: (msg: object) => Promise<void>;   // send a request and wait for the server's answer
  loginOpen: boolean;
  setLoginOpen: (open: boolean) => void;
};

const HmiContext = createContext<Hmi | null>(null);

const RETRY_MS = 2_000;       // reconnect delay after the connection drops
const REQUEST_MS = 5_000;     // give up on a request after this long
const ACTIVITY_MS = 15_000;   // tell the server "still here" at most this often while logged in

export function HmiProvider({ children, url = `ws://${location.host}/ws` }:
  { children: ReactNode; url?: string }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [serverConnected, setServerConnected] = useState(false);
  const [plcConnected, setPlcConnected] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loginOpen, setLoginOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const nextReqId = useRef(1);
  const pending = useRef(new Map<number, { resolve: () => void; reject: (e: Error) => void }>());

  // --- Connection, with automatic reconnect ---
  useEffect(() => {
    let retryTimer: number;
    let closedByUs = false;

    const connect = () => {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setServerConnected(true);

      ws.onclose = () => {
        setServerConnected(false);
        setPlcConnected(false);
        setUser(null);   // the server starts a fresh session on reconnect
        setRole(null);
        for (const p of pending.current.values()) p.reject(new Error('Connection lost'));
        pending.current.clear();
        if (!closedByUs) retryTimer = window.setTimeout(connect, RETRY_MS);
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case 'snapshot': setValues(msg.values); break;                                  // all tags
          case 'update': setValues((v) => ({ ...v, [msg.tag]: msg.value })); break;       // one tag
          case 'plc': setPlcConnected(msg.connected); break;                              // PLC link up/down
          case 'session': setUser(msg.user); setRole(msg.role); break;                    // login state
          case 'users': setUsers(msg.users); break;                                       // user list
          case 'result': {                                                                // request answer
            const p = pending.current.get(msg.reqId);
            pending.current.delete(msg.reqId);
            if (msg.ok) p?.resolve(); else p?.reject(new Error(msg.error));
            break;
          }
          case 'error': console.error(msg.message); break;                                // rejected write
        }
      };
    };

    connect();
    return () => { closedByUs = true; clearTimeout(retryTimer); wsRef.current?.close(); };
  }, [url]);

  // --- Keep a login alive while the screen is being used ---
  useEffect(() => {
    if (!user) return;
    let lastSent = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastSent < ACTIVITY_MS) return;
      lastSent = now;
      wsRef.current?.send(JSON.stringify({ type: 'activity' }));
    };
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    return () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [user]);

  const write = useCallback((tag: string, value: unknown) => {
    wsRef.current?.send(JSON.stringify({ type: 'write', tag, value }));
  }, []);

  const request = useCallback((msg: object) => new Promise<void>((resolve, reject) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('Not connected'));
    const reqId = nextReqId.current++;
    pending.current.set(reqId, { resolve, reject });
    ws.send(JSON.stringify({ ...msg, reqId }));
    window.setTimeout(() => {
      if (pending.current.delete(reqId)) reject(new Error('No response from the server'));
    }, REQUEST_MS);
  }), []);

  return (
    <HmiContext.Provider value={{
      values, serverConnected, connected: serverConnected && plcConnected, user, role, users, write, request, loginOpen, setLoginOpen }}>
      {children}
    </HmiContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useHmi(): Hmi {
  const hmi = useContext(HmiContext);
  if (!hmi) throw new Error('HMI hooks must be used inside <HmiProvider>');
  return hmi;
}

// One tag: its value, connection state, and a writer bound to that tag
export function useTag(tag: string) {
  const { values, connected, write } = useHmi();
  return { value: values[tag], connected, write: (v: unknown) => write(tag, v) };
}

// Login state and actions
export function useSession() {
  const { user, role, users, request, setLoginOpen } = useHmi();
  return {
    user,
    role,
    users,
    can: (minRole: Role) => hasRole(role, minRole),
    login: (userId: string, pin: string) => request({ type: 'login', userId, pin }),
    logout: () => request({ type: 'logout' }),
    promptLogin: () => setLoginOpen(true),
    closeLogin: () => setLoginOpen(false),
  };
}

// User management (the server only allows these for an Admin)
export function useUserAdmin() {
  const { request } = useHmi();
  return {
    create: (name: string, role: Role, pin: string) =>
      request({ type: 'users.create', name, role, pin }),
    update: (id: string, changes: { name?: string; role?: Role; pin?: string }) =>
      request({ type: 'users.update', id, ...changes }),
    remove: (id: string) => request({ type: 'users.delete', id }),
  };
}
