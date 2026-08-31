import './server-only.js';
import { GeneratedJanuary, SharedClient } from './generated/api.js';
import type { PartnerUserContext } from './generated/models.js';
import { HttpRuntime } from './runtime.js';
import { JanuaryConfigurationError, JanuaryValidationError } from './errors.js';
import type { ClientToken, CreateClientTokenInput, JanuaryOptions } from './types.js';
import { validateCreateInput } from './validation.js';

/** Trusted Node backend client. Shared operations match the January client SDK. */
export class January extends GeneratedJanuary {
  /** @deprecated Prototype compatibility alias. Prefer mintClientToken. */
  readonly clientTokens: { create(input: CreateClientTokenInput): Promise<ClientToken> };

  constructor(options: JanuaryOptions = {}) {
    super(new HttpRuntime(options));
    if (options.clientTokenPath !== undefined) throw new JanuaryConfigurationError('clientTokenPath overrides are no longer supported; endpoint paths come from the contract');
    const issuer = options.clientTokenIssuer;
    this.clientTokens = Object.freeze({
      create: async (input: CreateClientTokenInput): Promise<ClientToken> => {
        validateCreateInput(input);
        if (issuer) return issuer.create(input);
        const token = await this.mintClientToken({ ...input, ...(input.scopes ? { scopes: [...input.scopes] } : {}) } as Parameters<January['mintClientToken']>[0], {maxRetries:0});
        const result = { token: token.token, expiresIn: token.expiresIn };
        Object.defineProperty(result, Symbol.for('nodejs.util.inspect.custom'), { value: () => ({ ...result, token: '[REDACTED]' }) });
        return result;
      },
    });
    Object.freeze(this);
  }

  /** Creates an immutable view. Does not change this client's user headers. */
  forUser(input: PartnerUserContext | string): SharedClient<true> {
    const supplied = typeof input === 'string' ? { endUserId: input } : input;
    if (!supplied || typeof supplied.endUserId !== 'string' || !supplied.endUserId.trim() || /[\r\n]/.test(supplied.endUserId)) throw new JanuaryValidationError('A non-empty endUserId is required');
    if (supplied.endUserTimezone !== undefined && (typeof supplied.endUserTimezone !== 'string' || !supplied.endUserTimezone.trim() || /[\r\n]/.test(supplied.endUserTimezone))) throw new JanuaryValidationError('Invalid endUserTimezone');
    const context = Object.freeze({ endUserId: supplied.endUserId, ...(supplied.endUserTimezone !== undefined ? { endUserTimezone: supplied.endUserTimezone } : {}) });
    const view = new SharedClient<true>(this.runtime, context);
    Object.freeze(view);
    return view;
  }
}
export { January as JanuaryServerClient };
