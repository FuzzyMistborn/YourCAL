import { createHash } from 'node:crypto'
import type { DavContext } from '../../dav/context.js'

/**
 * Identifies which account's data a row belongs to -- never how to
 * authenticate to it. Deliberately excludes the password: a password
 * change should not invalidate the cache, and the raw password must never
 * be persisted to SQLite (it only ever comes from the live request's
 * session cookie).
 */
export function deriveUserKey(ctx: DavContext): string {
  return createHash('sha256').update(`${ctx.baseUrl}\n${ctx.username}`).digest('hex')
}
