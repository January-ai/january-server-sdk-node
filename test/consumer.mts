import { January, ClientScope, type ClientToken } from "@january-ai/server";

const client = new January({ secretKey: "fixture" });
const result: Promise<ClientToken> = client.clientTokens.create({
  endUserId: "fixture-user", scopes: [ClientScope.foodsRead], ttlSeconds: 300,
});
type IsAny<T> = 0 extends (1 & T) ? true : false;
const notAny: IsAny<Awaited<typeof result>> = false;
void notAny;
// @ts-expect-error Unknown scopes must not typecheck.
client.clientTokens.create({ endUserId: "user", scopes: ["made-up:scope"] });
// @ts-expect-error Identity is required.
client.clientTokens.create({});
// @ts-expect-error No string coercion for TTL.
client.clientTokens.create({ endUserId: "user", ttlSeconds: "300" });
// @ts-expect-error Exact optional properties distinguish undefined from omission.
client.clientTokens.create({ endUserId: "user", ttlSeconds: undefined });
// @ts-expect-error Browser client resources are not part of this prototype.
client.foods.search({ query: "banana" });
