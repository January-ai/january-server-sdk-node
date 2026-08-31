import { January } from "@january-ai/server";

interface Env {
  JANUARY_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/api/january/token") {
      return new Response("Not found", { status: 404 });
    }

    // LOCAL DEMO ONLY. Replace this with verified session/JWT handling.
    const endUserId = request.headers.get("x-demo-user-id")?.trim();
    if (!endUserId) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    try {
      const january = new January({
        secretKey: env.JANUARY_API_KEY,
      });
      // Ignore request bodies: identity comes from authentication, permissions
      // and lifetime are server-selected. Never forward caller-chosen scopes.
      const { token, expiresIn } = await january.mintClientToken({
        endUserId,
        scopes: ["foods:read"],
        ttlSeconds: 1800,
      });
      return Response.json({ token, expiresIn }, {
        headers: { "cache-control": "no-store" },
      });
    } catch {
      // Do not expose upstream errors, credentials, or configuration details.
      return Response.json({ error: "token_unavailable" }, {
        status: 502,
        headers: { "cache-control": "no-store" },
      });
    }
  },
} satisfies ExportedHandler<Env>;
