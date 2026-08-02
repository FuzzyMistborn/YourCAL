import { createHash } from 'node:crypto'
import { DAVClient } from 'tsdav'
import type { DavContext } from './context.js'

// createClient's login() runs full CalDAV discovery (well-known -> principal
// -> calendar-home-set), several HTTP round trips, before doing anything
// useful. Every CalendarStore method was calling it fresh on every request.
// tsdav's DAVClient sends Basic auth on each individual request rather than
// holding a server-side session, so the discovered client is safe to reuse
// across requests for the same credentials -- cache it for a bounded TTL
// instead of rediscovering on every call.
const CLIENT_TTL_MS = 10 * 60 * 1000

interface CachedClient {
  client: DAVClient
  expiresAt: number
}

const cache = new Map<string, CachedClient>()

// Lazy TTL checks on read alone would let an entry for a session that's
// never accessed again (e.g. the user logged out or abandoned the tab)
// linger in memory forever, holding a plaintext password. Sweep
// periodically instead. unref() so this timer never keeps the process alive.
setInterval(
  () => {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key)
    }
  },
  CLIENT_TTL_MS,
).unref()

function cacheKey(ctx: DavContext): string {
  return createHash('sha256').update(`${ctx.baseUrl}\n${ctx.username}\n${ctx.password}`).digest('hex')
}

export async function createClient(ctx: DavContext): Promise<DAVClient> {
  const key = cacheKey(ctx)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.client
  }

  const client = new DAVClient({
    serverUrl: ctx.baseUrl,
    credentials: {
      username: ctx.username,
      password: ctx.password,
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  })
  await client.login()

  cache.set(key, { client, expiresAt: Date.now() + CLIENT_TTL_MS })
  return client
}

export function evictClient(ctx: DavContext): void {
  cache.delete(cacheKey(ctx))
}
