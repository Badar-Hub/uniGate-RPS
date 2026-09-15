/**
 * ActorScope — the second layer of authorization (architecture.md §6.1, security.md §4).
 *
 * Every repository read takes one and applies it in the WHERE clause. An out-of-scope row
 * is simply not returned, which is what makes the anti-enumeration rule (404 not 403,
 * api.md §3.2) impossible to forget on a new endpoint.
 *
 * It is a plain, serialisable value: no methods, no Prisma, so it can be built in the
 * auth middleware, logged (safely — it carries ids only), and passed into jobs.
 */

export type ScopeKind =
  /** The actor themselves — profile edits, own sessions. */
  | 'SELF'
  /** Records the actor owns — a customer's requests, an owner's vehicles. */
  | 'OWN'
  /** Records the actor is a party to — a booking the actor is customer, owner or driver of. */
  | 'PARTY'
  /** Cross-tenant, granted by an `*_any` or admin permission. */
  | 'GLOBAL';

export interface ActorIdentity {
  readonly userId: string;
  readonly sessionId: string | null;
  /** Role codes snapshotted at authentication. */
  readonly roles: readonly string[];
  /** Permission codes resolved for this request. */
  readonly permissions: ReadonlySet<string>;
  readonly customerProfileId: string | null;
  readonly ownerProfileId: string | null;
  readonly driverProfileId: string | null;
  readonly spoProfileId: string | null;
  readonly locale: 'ar' | 'en';
}

export interface ActorScope {
  readonly kind: ScopeKind;
  readonly actor: ActorIdentity;
  /** Correlation for logs and audit rows. */
  readonly requestId: string;
}

/** Scope used by system jobs and the seed — never by a request handler. */
export interface SystemScope {
  readonly kind: 'SYSTEM';
  readonly jobName: string;
  readonly requestId: string;
}

export type AnyScope = ActorScope | SystemScope;

export function isGlobalScope(scope: AnyScope): boolean {
  return scope.kind === 'GLOBAL' || scope.kind === 'SYSTEM';
}
