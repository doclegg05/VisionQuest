export function assertDisposableE2eDatabaseUrl(
  databaseUrl: string | undefined,
  confirmedDisposable: string | undefined,
): string {
  const trimmed = databaseUrl?.trim();
  if (!trimmed) {
    throw new Error(
      "DATABASE_URL must be explicitly set to a disposable E2E database.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("E2E DATABASE_URL must use PostgreSQL.");
  }

  if (confirmedDisposable !== "true") {
    throw new Error(
      "E2E database must be explicitly confirmed disposable with " +
        "E2E_DATABASE_CONFIRMED_DISPOSABLE=true.",
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(hostname);
  if (!isLoopback) {
    throw new Error("E2E refused a non-loopback DATABASE_URL.");
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!/^visionquest_e2e(?:[_-][a-z0-9][a-z0-9_-]*)?$/i.test(databaseName)) {
    throw new Error(
      "E2E requires a dedicated database named visionquest_e2e or " +
        "visionquest_e2e_<run-id>.",
    );
  }
  return trimmed;
}
