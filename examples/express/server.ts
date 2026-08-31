import express, { type NextFunction, type Request, type Response } from "express";
import { January } from "@january-ai/server";

const secretKey = process.env.JANUARY_API_KEY?.trim();
if (!secretKey) {
  throw new Error("Set JANUARY_API_KEY in the SDK root .env file");
}

const january = new January({
  secretKey,
});

type AuthenticatedRequest = Request & { user?: { id: string } };

function requireAuthenticatedUser(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): void {
  // LOCAL DEMO ONLY. Replace this with the application's verified session/JWT.
  const userId = request.header("x-demo-user-id");
  if (!userId) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  request.user = { id: userId };
  next();
}

const app = express();

app.post(
  "/api/january/token",
  requireAuthenticatedUser,
  async (request: AuthenticatedRequest, response: Response) => {
    // The caller cannot choose endUserId or scopes; both are server-controlled.
    try {
      const token = await january.mintClientToken({
        endUserId: request.user!.id,
        scopes: ["foods:read"],
        ttlSeconds: 1800,
      });
      // The mobile/web token provider expects this relay shape, not SDK metadata.
      response.set("Cache-Control", "no-store").json({ token: token.token, expiresIn: token.expiresIn });
    } catch {
      // Do not return upstream response bodies, errors, or credentials.
      response.status(502).json({ error: "token_issuance_failed" });
    }
  },
);

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address !== "string") {
    console.log(`January token example listening on http://127.0.0.1:${address.port}`);
  }
});
