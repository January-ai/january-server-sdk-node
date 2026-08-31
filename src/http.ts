import { operations } from './generated/operations.js';
import type { ClientTokenResponseDto } from './generated/models.js';
import { HttpRuntime } from './runtime.js';
import { JanuaryConfigurationError } from './errors.js';
import type { ClientTokenIssuer, HttpClientTokenIssuerOptions } from './types.js';
import { validateCreateInput } from './validation.js';

/** Prototype compatibility adapter; the endpoint is generated from the contract. */
export function createHttpTokenIssuer(options: HttpClientTokenIssuerOptions): ClientTokenIssuer {
  if (!options.secretKey?.trim()) throw new JanuaryConfigurationError('secretKey is required');
  if (options.clientTokenPath !== undefined) throw new JanuaryConfigurationError('Endpoint paths come from the contract; use baseUrl for a mock service');
  const runtime = new HttpRuntime({...options, maxRetries:0});
  return Object.freeze({
    async create(input) {
      validateCreateInput(input);
      const token = await runtime.request<ClientTokenResponseDto>(operations.mintClientToken!, { ...input });
      return { token: token.token, expiresIn: token.expiresIn };
    },
  } satisfies ClientTokenIssuer);
}
