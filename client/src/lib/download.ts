// Triggers a browser download for a same-origin URL whose response sets
// Content-Disposition: attachment (the export routes) -- a plain anchor
// click rather than fetch()+Blob, since the session cookie already rides
// along on a normal same-origin navigation and the server-provided
// filename (via Content-Disposition) is honored automatically this way.
export function triggerDownload(url: string): void {
  const link = document.createElement('a')
  link.href = url
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}
