function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  sessionSecret: required('SESSION_SECRET'),
  // Both the encrypted session payload's own expiry (@fastify/secure-session's
  // `expiry` option, checked server-side against a timestamp baked into the
  // payload) and the cookie's `maxAge` are tied to this -- previously only
  // the former was set (implicitly, to the library's 24h default) and the
  // cookie had no maxAge at all, making it a browser-session cookie that's
  // wiped on browser close regardless of the 24h the payload allowed for.
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 86400),
  allowedCalDavHosts: process.env.ALLOWED_CALDAV_HOSTS
    ? process.env.ALLOWED_CALDAV_HOSTS.split(',').map((h) => h.trim())
    : null,
  cacheEnabled: process.env.CACHE_ENABLED === 'true',
  sqlitePath: process.env.SQLITE_PATH ?? './data/cache.db',
  cacheSyncTtlMs: Number(process.env.CACHE_SYNC_TTL_MS ?? 30000),
  // Fallback timezone the client pre-selects for a *new* event, in place of
  // the browser's own auto-detected zone -- useful for a shared/kiosk
  // instance, or an admin who just wants everyone defaulting to one org
  // timezone rather than wherever each browser happens to think it is. Not
  // validated against the IANA tz database here; an invalid value just
  // means the client's <select> won't have a matching option pre-selected
  // (see EventEditDialog.vue), not a startup failure.
  defaultTimezone: process.env.DEFAULT_TIMEZONE || null,
}
