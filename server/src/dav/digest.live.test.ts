import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createClient } from './client.js'
import type { DavContext } from './context.js'

// A faithful-enough stand-in for Baikal/sabre's Digest handling: it issues a
// no-`algorithm`, comma-packed challenge and validates the response exactly
// per RFC 2617 (A1 = md5(user:realm:pass)). It answers the three PROPFINDs
// tsdav's discovery makes. If our davFetch handshake is correct end to end,
// createClient().login() resolves against it.

const USER = 'geoff'
const PASS = 's3cr3t pw'
const REALM = 'BaikalDAV'
const OPAQUE = 'd66d5f0524036afcb61420e358f990ce'

const md5 = (s: string): string => createHash('md5').update(s).digest('hex')

function parseAuth(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /(\w+)=(?:"([^"]*)"|([^,]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(header)) !== null) out[m[1]] = m[2] ?? m[3]
  return out
}

function digestOk(method: string, authHeader: string | undefined): boolean {
  if (!authHeader?.startsWith('Digest ')) return false
  const p = parseAuth(authHeader.slice(7))
  if (p.username !== USER || p.realm !== REALM) return false
  const ha1 = md5(`${USER}:${REALM}:${PASS}`)
  const ha2 = md5(`${method}:${p.uri}`)
  const expected = p.qop
    ? md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`)
    : md5(`${ha1}:${p.nonce}:${ha2}`)
  return p.response === expected
}

const MULTISTATUS = (inner: string): string =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${inner}</d:multistatus>`

let server: Server
let base: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'
    // Drain the request body (sabre needs it consumed; also mimics real IO).
    req.on('data', () => {})
    req.on('end', () => {
      if (url.startsWith('/.well-known/')) {
        res.writeHead(404).end()
        return
      }
      if (!digestOk(method, req.headers.authorization)) {
        res.writeHead(401, {
          'WWW-Authenticate': `Digest realm="${REALM}",qop="auth",nonce="${randomBytes(6).toString('hex')}",opaque="${OPAQUE}"`,
          'Content-Type': 'application/xml; charset=utf-8',
        }).end('<d:error xmlns:d="DAV:"><s:message>auth</s:message></d:error>')
        return
      }
      res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
      if (url === '/dav.php/' || url === '/dav.php') {
        res.end(
          MULTISTATUS(
            `<d:response><d:href>/dav.php/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/dav.php/principals/${USER}/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
          ),
        )
        return
      }
      if (url === `/dav.php/principals/${USER}/`) {
        res.end(
          MULTISTATUS(
            `<d:response><d:href>/dav.php/principals/${USER}/</d:href><d:propstat><d:prop><cal:calendar-home-set><d:href>/dav.php/calendars/${USER}/</d:href></cal:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
          ),
        )
        return
      }
      res.end(MULTISTATUS(''))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}/dav.php/`
})

afterAll(() => {
  server.close()
})

it('completes CalDAV discovery over Digest auth', async () => {
  const ctx: DavContext = { baseUrl: base, username: USER, password: PASS, authMethod: 'Digest' }
  const client = await createClient(ctx)
  expect(client.account?.principalUrl).toContain('/dav.php/principals/geoff/')
  expect(client.account?.homeUrl).toContain('/dav.php/calendars/geoff/')
})
