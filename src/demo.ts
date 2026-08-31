import { JanuaryConfigurationError } from "./errors.js";
import type {
  ClientToken,
  ClientTokenIssuer,
  CreateClientTokenInput,
  DemoClientTokenIssuerOptions,
} from "./types.js";
import { validateCreateInput } from "./validation.js";

export function createDemoTokenIssuer(options: DemoClientTokenIssuerOptions): ClientTokenIssuer {
  const token = options.token?.trim();
  if (!token) {
    throw new JanuaryConfigurationError("Demo token must be a non-empty string");
  }
  if (token.startsWith("sk-")) {
    throw new JanuaryConfigurationError("Refusing to expose a January sk- secret as a demo client token");
  }

  const expiresIn = options.expiresIn ?? 3_600;
  if (!Number.isInteger(expiresIn) || expiresIn <= 0) {
    throw new JanuaryConfigurationError("Demo expiresIn must be a positive integer number of seconds");
  }

  return {
    async create(input: CreateClientTokenInput): Promise<ClientToken> {
      validateCreateInput(input);
      return {
        token,
        expiresIn,
      };
    },
  };
}
