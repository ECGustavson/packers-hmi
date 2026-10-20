// User accounts: named users with a PIN and a role, stored in DATA_DIR/users.json.
// PINs are stored as salted scrypt hashes, never in plain text.

import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { isRole, Role } from './roles';

// What browsers see. Never includes the PIN hash.
export type PublicUser = { id: string; name: string; role: Role };
type StoredUser = PublicUser & { salt: string; pinHash: string };

const PIN_PATTERN = /^\d{4,8}$/;
const NAME_MAX = 24;
const MAX_ATTEMPTS = 5;       // wrong PINs in a row before a user is locked out
const LOCKOUT_MS = 60_000;    // how long the lockout lasts

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 32).toString('hex');
}

function toPublic({ id, name, role }: StoredUser): PublicUser {
  return { id, name, role };
}

export class UserStore {
  private users: StoredUser[] = [];
  private attempts = new Map<string, { fails: number; lockedUntil: number }>();

  constructor(private readonly file: string) {}

  // Load users from disk. On first run, create an Admin with a random PIN and print it to the log.
  load() {
    if (existsSync(this.file)) {
      this.users = JSON.parse(readFileSync(this.file, 'utf8'));
      return;
    }
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.create('Admin', 'admin', pin);
    console.warn(`First run: created user "Admin" with PIN ${pin}. Log in and change it under Manage users.`);
  }

  list(): PublicUser[] {
    return this.users.map(toPublic).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): PublicUser | undefined {
    const user = this.users.find((u) => u.id === id);
    return user && toPublic(user);
  }

  // Check a PIN. Returns the user, or throws a message suitable for the login screen.
  verify(id: string, pin: string): PublicUser {
    const user = this.users.find((u) => u.id === id);
    if (!user) throw new Error('Unknown user');

    const now = Date.now();
    const attempt = this.attempts.get(id) ?? { fails: 0, lockedUntil: 0 };
    if (attempt.lockedUntil > now) {
      throw new Error(`Too many wrong PINs. Try again in ${Math.ceil((attempt.lockedUntil - now) / 1000)} s.`);
    }

    const given = Buffer.from(hashPin(pin, user.salt), 'hex');
    const stored = Buffer.from(user.pinHash, 'hex');
    if (!timingSafeEqual(given, stored)) {
      attempt.fails++;
      if (attempt.fails >= MAX_ATTEMPTS) {
        attempt.fails = 0;
        attempt.lockedUntil = now + LOCKOUT_MS;
      }
      this.attempts.set(id, attempt);
      throw new Error(attempt.lockedUntil > now
        ? `Too many wrong PINs. Try again in ${LOCKOUT_MS / 1000} s.`
        : 'Wrong PIN');
    }

    this.attempts.delete(id);
    return toPublic(user);
  }

  create(name: unknown, role: unknown, pin: unknown): PublicUser {
    const cleanName = this.checkName(name);
    const cleanRole = this.checkRole(role);
    const cleanPin = this.checkPin(pin);

    const salt = randomBytes(16).toString('hex');
    const user: StoredUser = {
      id: randomUUID(), name: cleanName, role: cleanRole, salt, pinHash: hashPin(cleanPin, salt),
    };
    this.users.push(user);
    this.save();
    return toPublic(user);
  }

  // Change any of name, role or PIN. Fields left undefined stay as they are.
  update(id: string, changes: { name?: unknown; role?: unknown; pin?: unknown }): PublicUser {
    const user = this.users.find((u) => u.id === id);
    if (!user) throw new Error('Unknown user');

    const name = changes.name === undefined ? user.name : this.checkName(changes.name, id);
    const role = changes.role === undefined ? user.role : this.checkRole(changes.role);
    if (user.role === 'admin' && role !== 'admin' && this.adminCount() === 1) {
      throw new Error('There must be at least one Admin');
    }

    user.name = name;
    user.role = role;
    if (changes.pin !== undefined) {
      user.salt = randomBytes(16).toString('hex');
      user.pinHash = hashPin(this.checkPin(changes.pin), user.salt);
      this.attempts.delete(id);
    }
    this.save();
    return toPublic(user);
  }

  remove(id: string) {
    const user = this.users.find((u) => u.id === id);
    if (!user) throw new Error('Unknown user');
    if (user.role === 'admin' && this.adminCount() === 1) throw new Error('There must be at least one Admin');

    this.users = this.users.filter((u) => u.id !== id);
    this.attempts.delete(id);
    this.save();
  }

  // --- Validation ---

  private checkName(name: unknown, exceptId?: string): string {
    const clean = typeof name === 'string' ? name.trim() : '';
    if (!clean) throw new Error('Enter a name');
    if (clean.length > NAME_MAX) throw new Error(`Names can be up to ${NAME_MAX} characters`);
    const taken = this.users.some((u) => u.id !== exceptId && u.name.toLowerCase() === clean.toLowerCase());
    if (taken) throw new Error(`There's already a user named ${clean}`);
    return clean;
  }

  private checkRole(role: unknown): Role {
    if (!isRole(role)) throw new Error('Choose a role');
    return role;
  }

  private checkPin(pin: unknown): string {
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) throw new Error('PIN must be 4 to 8 digits');
    return pin;
  }

  private adminCount(): number {
    return this.users.filter((u) => u.role === 'admin').length;
  }

  // Write to a temp file, then rename, so a power loss mid-write can't corrupt the user list
  private save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.users, null, 2));
    renameSync(tmp, this.file);
  }
}
