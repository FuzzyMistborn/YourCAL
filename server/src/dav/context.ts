export interface DavContext {
  baseUrl: string
  username: string
  password: string
  // How to authenticate with the CalDAV server. Detected once at login
  // (see dav/auth.ts `detectAuthMethod`) and carried on the session.
  // Absent means Basic -- keeps older sessions and test fixtures valid.
  authMethod?: 'Basic' | 'Digest'
}
