// User roles, lowest to highest. Each role can do everything the roles below it can.
// Keep in sync with server/src/roles.ts.

export const ROLES = ['operator', 'supervisor', 'maint', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  operator: 'Operator',
  supervisor: 'Supervisor',
  maint: 'Maintenance',
  admin: 'Admin',
};

// True if `have` is at least `need`. No role (not logged in) never passes.
export function hasRole(have: Role | null, need: Role): boolean {
  return have !== null && ROLES.indexOf(have) >= ROLES.indexOf(need);
}
