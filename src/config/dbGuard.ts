/**
 * A seat belt for the database connection.
 *
 * Everything this app does is addressed to the database named in MONGO_URI. On a cluster
 * that also holds other live databases, and with a login that can reach all of them, one
 * wrong character in that string would quietly point the app at someone else's data. With
 * EXPECTED_DB_NAME set, the app refuses to start unless MONGO_URI names exactly that
 * database. It is opt-in: left unset, nothing changes.
 *
 * Messages never include the connection string itself, which carries the password.
 */
export function databaseNameOf(uri: string): string {
  // Parsed by hand, not with URL: a password containing "@" or "/" (unescaped, which the
  // driver itself would later reject) makes a URL parser quietly answer with the wrong
  // piece. The host is whatever follows the LAST "@"; the database is the first path
  // segment after it.
  const withoutScheme = uri.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const beforeQuery = withoutScheme.split('?')[0];
  const hostAndPath = beforeQuery.includes('@') ? beforeQuery.slice(beforeQuery.lastIndexOf('@') + 1) : beforeQuery;
  const slash = hostAndPath.indexOf('/');
  if (slash === -1) return '';
  const name = hostAndPath.slice(slash + 1).split('/')[0];
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function assertExpectedDatabase(uri: string, expected: string | undefined): void {
  const want = expected?.trim();
  if (!want) return;

  const actual = databaseNameOf(uri);
  if (actual !== want) {
    throw new Error(
      `Refusing to start: MONGO_URI points at ${actual ? `database "${actual}"` : 'no database name (the driver would use "test")'}, ` +
        `but EXPECTED_DB_NAME is "${want}". Fix MONGO_URI so it ends in /${want}, or change EXPECTED_DB_NAME on purpose.`,
    );
  }
}

/** After connecting: the database the driver actually opened must be the expected one too. */
export function assertConnectedDatabase(connectedName: string, expected: string | undefined): void {
  const want = expected?.trim();
  if (want && connectedName !== want) {
    throw new Error(`Refusing to continue: connected to database "${connectedName}", expected "${want}".`);
  }
}
