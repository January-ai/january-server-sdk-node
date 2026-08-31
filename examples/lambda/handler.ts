import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { January } from "@january-ai/server";

const secretKey = process.env.JANUARY_API_KEY?.trim();
if (!secretKey) {
  throw new Error("JANUARY_API_KEY is required");
}

const january = new January({
  secretKey,
});

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  // API Gateway's configured JWT authorizer verifies this claim before invocation.
  const endUserId = event.requestContext.authorizer.jwt.claims.sub;
  if (typeof endUserId !== "string" || !endUserId) {
    return { statusCode: 401, body: JSON.stringify({ error: "unauthorized" }) };
  }

  try {
    const token = await january.mintClientToken({ endUserId, scopes: ["foods:read"], ttlSeconds: 1800 });
    return {
      statusCode: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify({ token: token.token, expiresIn: token.expiresIn }),
    };
  } catch {
    return { statusCode: 502, body: JSON.stringify({ error: "token_issuance_failed" }) };
  }
};
