import { JanuaryValidationError } from "./errors.js";
import { ClientScope, type CreateClientTokenInput } from "./types.js";

const CLIENT_TOKEN_SCOPES = new Set<string>(Object.values(ClientScope));

export function validateCreateInput(input: CreateClientTokenInput): void {
  if (!input || typeof input.endUserId !== "string" || input.endUserId.trim() === "") {
    throw new JanuaryValidationError("endUserId must be a non-empty string derived from the authenticated user");
  }

  if (input.endUserId.trim().length > 64) {
    throw new JanuaryValidationError("endUserId must be 64 characters or fewer");
  }

  if (
    !Array.isArray(input.scopes) || input.scopes.length === 0
    || input.scopes.length > CLIENT_TOKEN_SCOPES.size
    || input.scopes.some((scope: unknown) => typeof scope !== "string" || !CLIENT_TOKEN_SCOPES.has(scope))
  ) {
    throw new JanuaryValidationError("scopes must contain at least one scope available to client tokens");
  }

  if (
    input.ttlSeconds !== undefined
    && (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 300 || input.ttlSeconds > 7_200)
  ) {
    throw new JanuaryValidationError("ttlSeconds must be an integer from 300 through 7200");
  }
}
