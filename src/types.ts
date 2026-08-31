export const ClientScope = {
  foodsRead: "foods:read",
  foodScansWrite: "food_scans:write",
  foodLogsRead: "food_logs:read",
  foodLogsWrite: "food_logs:write",
  glucoseRead: "glucose:read",
  restaurantsRead: "restaurants:read",
} as const;
export type ClientScope = typeof ClientScope[keyof typeof ClientScope];

export interface CreateClientTokenInput {
  readonly endUserId: string;
  readonly scopes?: readonly ClientScope[];
  /** Token lifetime in seconds. January accepts 300 through 7200. */
  readonly ttlSeconds?: number;
}

export interface ClientToken {
  readonly token: string;
  readonly expiresIn: number;
}

export interface ClientTokenIssuer {
  create(input: CreateClientTokenInput): Promise<ClientToken>;
}

export interface JanuaryOptions {
  /** Overrides HTTP issuance, primarily for deterministic tests. */
  readonly clientTokenIssuer?: ClientTokenIssuer;

  /** Server-side partner secret. Never expose this value to clients. */
  readonly secretKey?: string;

  /** Overrides the January API origin, for example the local mock service. */
  readonly baseUrl?: string;

  /** @deprecated Unsupported: paths are generated from the contract. Use baseUrl. */
  readonly clientTokenPath?: string;

  /** Overall request timeout in milliseconds. Defaults to 30 seconds. */
  readonly timeoutMs?: number;

  /** Injectable Fetch implementation for tests. This package requires Node.js. */
  readonly fetch?: typeof globalThis.fetch;
}

export interface DemoClientTokenIssuerOptions {
  /** The opaque value the client will use as its temporary credential. */
  readonly token: string;
  /** Synthetic cache lifetime for provider integration. Defaults to one hour. */
  readonly expiresIn?: number;
  /** Injectable clock for deterministic tests. */
}

export interface HttpClientTokenIssuerOptions {
  readonly secretKey: string;
  readonly baseUrl?: string;
  readonly clientTokenPath?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}
