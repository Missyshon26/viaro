import { describe, expect, it } from 'vitest';
import { assertConnectedDatabase, assertExpectedDatabase, databaseNameOf } from '../src/config/dbGuard';

describe('reading the database name from a connection string', () => {
  it('finds it in the usual shapes', () => {
    expect(databaseNameOf('mongodb+srv://u:p@cluster0.x.mongodb.net/abl_new?retryWrites=true&w=majority')).toBe('abl_new');
    expect(databaseNameOf('mongodb+srv://u:p@cluster0.x.mongodb.net/abl_new')).toBe('abl_new');
    expect(databaseNameOf('mongodb://u:p@h1:27017,h2:27017/abl_new?replicaSet=r')).toBe('abl_new');
  });

  it('reads none when there is none', () => {
    expect(databaseNameOf('mongodb+srv://u:p@cluster0.x.mongodb.net/')).toBe('');
    expect(databaseNameOf('mongodb+srv://u:p@cluster0.x.mongodb.net/?retryWrites=true')).toBe('');
    expect(databaseNameOf('mongodb+srv://u:p@cluster0.x.mongodb.net')).toBe('');
  });

  it('copes with a password that contains characters that break URLs', () => {
    expect(databaseNameOf('mongodb+srv://u:pa@ss/word@cluster0.x.mongodb.net/abl_new?w=majority')).toBe('abl_new');
    expect(databaseNameOf('mongodb+srv://u:p%40ss%2Fword@cluster0.x.mongodb.net/abl_new?w=majority')).toBe('abl_new');
  });

  it('cannot be fooled into reading the wrong piece', () => {
    // The database name hiding inside the password is not the database.
    expect(databaseNameOf('mongodb+srv://u:x/abl_new@cluster0.x.mongodb.net/all_black_limo?w=1')).toBe('all_black_limo');
    expect(databaseNameOf('mongodb+srv://u:p@cluster0.x.mongodb.net/all_black_limo/abl_new')).toBe('all_black_limo');
  });
});

describe('the start-up guard', () => {
  const uri = 'mongodb+srv://user:SECRET-PW@cluster0.x.mongodb.net/all_black_limo?retryWrites=true';

  it('does nothing when no expectation is set', () => {
    expect(() => assertExpectedDatabase(uri, undefined)).not.toThrow();
    expect(() => assertExpectedDatabase(uri, '')).not.toThrow();
    expect(() => assertExpectedDatabase(uri, '   ')).not.toThrow();
  });

  it('lets the right database through', () => {
    expect(() => assertExpectedDatabase('mongodb+srv://u:p@h/abl_new?w=majority', 'abl_new')).not.toThrow();
    expect(() => assertExpectedDatabase('mongodb+srv://u:p@h/abl_new?w=majority', ' abl_new ')).not.toThrow();
  });

  it('refuses another database, and says which', () => {
    expect(() => assertExpectedDatabase(uri, 'abl_new')).toThrow(/points at database "all_black_limo".*"abl_new"/);
  });

  it('refuses a near miss: a different name, a different case, a prefix', () => {
    for (const wrong of ['abl_new2', 'ABL_NEW', 'abl', 'abl_new_old']) {
      expect(() => assertExpectedDatabase(`mongodb+srv://u:p@h/${wrong}?w=1`, 'abl_new')).toThrow();
    }
  });

  it('refuses a string with no database, which would silently use "test"', () => {
    expect(() => assertExpectedDatabase('mongodb+srv://u:p@h/?w=1', 'abl_new')).toThrow(/no database name/);
  });

  it('never puts the password in the message', () => {
    try {
      assertExpectedDatabase(uri, 'abl_new');
    } catch (err) {
      expect((err as Error).message).not.toContain('SECRET-PW');
      expect((err as Error).message).not.toContain('cluster0');
    }
  });

  it('also checks the database the driver really opened', () => {
    expect(() => assertConnectedDatabase('abl_new', 'abl_new')).not.toThrow();
    expect(() => assertConnectedDatabase('test', 'abl_new')).toThrow(/connected to database "test"/);
    expect(() => assertConnectedDatabase('anything', undefined)).not.toThrow();
  });
});
