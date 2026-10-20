// Login UI: the account button in the header, and the login dialog.

import { useState } from 'react';
import { useSession, User } from './connection';
import { ROLE_LABELS } from './roles';
import { Modal } from './Modal';
import { PinPad } from './PinPad';

// Header button. Shows who is logged in; tap to log in, or for the account menu.
export function SessionButton({ onManageUsers }: { onManageUsers: () => void }) {
  const { user, role, can, promptLogin, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  const label = user ? user.name : role ? ROLE_LABELS[role] : 'Log in';

  return (
    <>
      <button className="session" onClick={() => (user ? setMenuOpen(true) : promptLogin())}>
        {label}
        {user && <span className="session-role">{ROLE_LABELS[user.role]}</span>}
      </button>

      {menuOpen && user && (
        <Modal label="Account" onClose={() => setMenuOpen(false)}>
          <div className="np-head">
            <span>{user.name}</span>
            <span className="np-small">{ROLE_LABELS[user.role]}</span>
          </div>
          <div className="menu">
            {can('admin') && (
              <button onClick={() => { setMenuOpen(false); onManageUsers(); }}>Manage users</button>
            )}
            <button onClick={() => { setMenuOpen(false); logout(); }}>Log out</button>
            <button className="np-fn" onClick={() => setMenuOpen(false)}>Close</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// Pick your name, then enter your PIN. Rendered once at the app root; opened by promptLogin().
export function LoginDialog() {
  const { users, login, closeLogin } = useSession();
  const [picked, setPicked] = useState<User | null>(null);

  if (picked) {
    return (
      <PinPad
        title={picked.name}
        subtitle="Enter your PIN"
        submitLabel="Log in"
        onSubmit={async (pin) => { await login(picked.id, pin); closeLogin(); }}
        onCancel={() => setPicked(null)} />
    );
  }

  return (
    <Modal label="Log in" onClose={closeLogin}>
      <div className="np-head"><span>Log in</span></div>
      <div className="np-small">Choose your name</div>
      <div className="menu user-list">
        {users.map((u) => (
          <button key={u.id} className="user-pick" onClick={() => setPicked(u)}>
            <span>{u.name}</span>
            <span className="np-small">{ROLE_LABELS[u.role]}</span>
          </button>
        ))}
        <button className="np-fn" onClick={closeLogin}>Cancel</button>
      </div>
    </Modal>
  );
}
