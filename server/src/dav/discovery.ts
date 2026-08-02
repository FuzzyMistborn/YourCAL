import { createClient } from './client.js'
import type { DavContext } from './context.js'
import { assertHostAllowed } from './hostAllowlist.js'

/**
 * Proves credentials are valid by running full CalDAV discovery
 * (well-known -> principal -> calendar-home-set). Throws on any
 * auth or network failure; callers translate that into a 401/502.
 */
export async function verifyCredentials(ctx: DavContext): Promise<void> {
  assertHostAllowed(ctx.baseUrl)
  const client = await createClient(ctx)
  if (!client.account) {
    throw new Error('CalDAV discovery did not resolve an account')
  }
}
