import { describe, it, expect } from "vitest";
import { createIndstocksClient, IndstocksError } from "./indstocksClient";

/**
 * Token-resolution precedence for the hot-swap token store wiring:
 *   explicit injected config.token  →  tokenProvider()  →  env-resolved config.token
 * The provider's returned token is trimmed; blank/null provider results fall through.
 */

function fakeFetch(captured: { auth?: string }) {
  return async (_url: string, init?: { headers?: Record<string, string> }) => {
    captured.auth = init?.headers?.["Authorization"];
    return new Response(JSON.stringify({ status: "success", data: { ok: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("createIndstocksClient token resolution", () => {
  it("uses the tokenProvider token when no token is injected", async () => {
    const captured: { auth?: string } = {};
    const client = createIndstocksClient({
      config: { token: undefined },
      fetchImpl: fakeFetch(captured) as never,
      tokenProvider: async () => "DB_TOKEN",
    });
    await client.getJson("/x");
    expect(captured.auth).toBe("DB_TOKEN");
  });

  it("trims the tokenProvider token", async () => {
    const captured: { auth?: string } = {};
    const client = createIndstocksClient({
      config: { token: undefined },
      fetchImpl: fakeFetch(captured) as never,
      tokenProvider: async () => "  PADDED  ",
    });
    await client.getJson("/x");
    expect(captured.auth).toBe("PADDED");
  });

  it("an explicitly injected token wins over the tokenProvider", async () => {
    const captured: { auth?: string } = {};
    const client = createIndstocksClient({
      config: { token: "INJECTED" },
      fetchImpl: fakeFetch(captured) as never,
      tokenProvider: async () => "DB_TOKEN",
    });
    await client.getJson("/x");
    expect(captured.auth).toBe("INJECTED");
  });

  it("falls back to the env-resolved config token when the provider yields nothing", async () => {
    const captured: { auth?: string } = {};
    const client = createIndstocksClient({
      config: { token: "ENV_TOKEN" },
      fetchImpl: fakeFetch(captured) as never,
      tokenProvider: async () => null,
    });
    await client.getJson("/x");
    expect(captured.auth).toBe("ENV_TOKEN");
  });

  it("throws a config error when no token is resolvable", async () => {
    const captured: { auth?: string } = {};
    const client = createIndstocksClient({
      config: { token: undefined },
      fetchImpl: fakeFetch(captured) as never,
      tokenProvider: async () => "   ",
    });
    await expect(client.getJson("/x")).rejects.toBeInstanceOf(IndstocksError);
    expect(captured.auth).toBeUndefined();
  });
});
