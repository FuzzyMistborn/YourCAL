/** Thrown when a write is rejected because the resource changed since the client last read it (HTTP 412). */
export class EtagConflictError extends Error {}

/** Thrown when a write targets a resource the caller doesn't have permission to modify (HTTP 403). */
export class ForbiddenError extends Error {}
