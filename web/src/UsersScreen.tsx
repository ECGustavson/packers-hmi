// User management screen (Admin only). Add users, change names, roles and PINs, delete users.
// The server checks every change too: only an Admin can make them, and the last Admin can't be removed.

import { useState } from 'react';
import { useSession, useUserAdmin, User } from './connection';
import { Role, ROLE_LABELS, ROLES } from './roles';
import { Modal } from './Modal';
import { PinPad } from './PinPad';
import { TextPad } from './TextPad';

export function UsersScreen({ onBack }: { onBack: () => void }) {
  const { users, user: me } = useSession();
  const [editing, setEditing] = useState<User | 'new' | null>(null);

  return (
    <main className="hmi">
      <header>
        <h1>Users</h1>
        <button className="session" onClick={onBack}>Back</button>
      </header>

      <div className="user-rows">
        {users.map((u) => (
          <button key={u.id} className="user-row" onClick={() => setEditing(u)}>
            <span>{u.name}{u.id === me?.id ? ' (you)' : ''}</span>
            <span className="unit">{ROLE_LABELS[u.role]}</span>
          </button>
        ))}
      </div>
      <button className="add-user" onClick={() => setEditing('new')}>Add user</button>

      {editing && (
        <UserEditor user={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      )}
    </main>
  );
}

// Add or edit one user. Name and PIN open their own on-screen keypads.
function UserEditor({ user, onDone }: { user: User | null; onDone: () => void }) {
  const { create, update, remove } = useUserAdmin();
  const [name, setName] = useState(user?.name ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'operator');
  const [pin, setPin] = useState<string | null>(null);                        // null = unchanged
  const [pad, setPad] = useState<'name' | 'pin' | null>(user ? null : 'name'); // new user starts on name
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const run = async (action: () => Promise<void>) => {
    try {
      setError('');
      await action();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const save = () => run(() => user
    ? update(user.id, { name, role, pin: pin ?? undefined })
    : create(name, role, pin ?? ''));
  const del = () => run(() => remove(user!.id));

  if (pad === 'name') {
    return (
      <TextPad title="Name" initial={name}
        onEnter={(text) => { setName(text); setPad(null); }}
        onCancel={() => (user || name ? setPad(null) : onDone())} />
    );
  }
  if (pad === 'pin') {
    return (
      <PinPad title={name || 'New user'} subtitle="New PIN, 4 to 8 digits" submitLabel="Set PIN"
        onSubmit={(p) => { setPin(p); setPad(null); }}
        onCancel={() => setPad(null)} />
    );
  }

  return (
    <Modal label={user ? 'Edit user' : 'Add user'} onClose={onDone}>
      <div className="np-head"><span>{user ? 'Edit user' : 'Add user'}</span></div>

      <div className="field">
        <label>Name</label>
        <button className="entry" onClick={() => setPad('name')}>{name || 'Tap to enter'}</button>
      </div>

      <div className="field">
        <label>Role</label>
        <div className="segmented">
          {ROLES.map((r) => (
            <button key={r} className={r === role ? 'selected' : ''} onClick={() => setRole(r)}>
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>PIN</label>
        <button className="entry" onClick={() => setPad('pin')}>
          {pin ? 'New PIN set' : user ? 'Change PIN' : 'Tap to set'}
        </button>
      </div>

      <div className="np-msg">{error || '\u00a0'}</div>

      {confirmDelete ? (
        <div className="np-actions">
          <button className="np-fn" onClick={() => setConfirmDelete(false)}>Keep</button>
          <button className="danger" onClick={del}>Delete {name}</button>
        </div>
      ) : (
        <div className="np-actions">
          {user
            ? <button className="np-fn danger-outline" onClick={() => setConfirmDelete(true)}>Delete</button>
            : <button className="np-fn" onClick={onDone}>Cancel</button>}
          <button className="np-enter" disabled={!name || (!user && !pin)} onClick={save}>Save</button>
        </div>
      )}
    </Modal>
  );
}
