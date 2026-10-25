import { describe, expect, it } from 'vitest';
import { placeholderEmail, planAdmin } from '../src/modules/migration/legacy.admins';

const HASH = '$2b$10$' + 'a'.repeat(53);
const base = { userName: 'Mahi', emailId: 'Mahi@Gmail.com', password: HASH, designation: 'Admin', status: 'Live' };

describe('planAdmin', () => {
  it('keeps the old bcrypt hash, lowercases the username and email', () => {
    const plan = planAdmin(base);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.user).toMatchObject({
      role: 'admin',
      username: 'mahi',
      email: 'mahi@gmail.com',
      emailIsPlaceholder: false,
      passwordHash: HASH,
      status: 'active',
      name: 'Mahi',
    });
  });

  it('gives an admin with no email an undeliverable placeholder so the account can still exist', () => {
    const plan = planAdmin({ ...base, userName: 'All_black_admin', emailId: '-' });
    expect(plan.ok && plan.user.email).toBe('all_black_admin@no-email.invalid');
    expect(plan.ok && plan.user.emailIsPlaceholder).toBe(true);
    expect(placeholderEmail('a b')).toBe('a-b@no-email.invalid');
  });

  it('builds the name and phone from the old fields when they exist', () => {
    const plan = planAdmin({ ...base, firstName: 'Mah', lastName: 'I', countryCode: '+1', contactNumber: '2065550100' });
    expect(plan.ok && plan.user.name).toBe('Mah I');
    expect(plan.ok && plan.user.phone).toBe('+12065550100');
  });

  it.each([
    ['no username', { ...base, userName: '  ' }],
    ['a status other than Live', { ...base, status: 'Blocked' }],
    ['a password that is not a bcrypt hash', { ...base, password: 'plain-text' }],
  ])('skips an account with %s', (_label, doc) => {
    expect(planAdmin(doc).ok).toBe(false);
  });
});
