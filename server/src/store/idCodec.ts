export function encodeId(url: string): string {
  return Buffer.from(url, 'utf8').toString('base64url')
}

export function decodeId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8')
}
