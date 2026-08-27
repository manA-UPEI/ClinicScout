export type AgentErrorKind =
  | "location_not_found"
  | "network"
  | "no_results"
  | "rate_limited"
  /** The whole deployment is at its ceiling — nothing the caller did wrong, and nothing they can fix by slowing down. */
  | "at_capacity"
  | "invalid_input";

export class AgentError extends Error {
  kind: AgentErrorKind;

  // Written out instead of a constructor parameter property: Node's
  // strip-only TypeScript execution (used by the raw `node --test` runner)
  // can erase type annotations but not this shorthand, since it also
  // declares a field — this module loads as a value import, not just types,
  // from infrastructure/geo/nominatimGeocoder.ts.
  constructor(kind: AgentErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "AgentError";
  }
}
