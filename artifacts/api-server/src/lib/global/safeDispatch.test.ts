import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { safeFireAndForget } from "./safeDispatch";
import { logger } from "../logger";

const flush = () => new Promise<void>((res) => setImmediate(res));

describe("safeFireAndForget (W6-P5 Phase 1G)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns void (callers keep their fire-and-forget shape)", () => {
    const r = safeFireAndForget("ok", async () => {});
    expect(r).toBeUndefined();
  });

  it("does not warn on the success path", async () => {
    safeFireAndForget("ok", async () => {});
    await flush();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("catches an async rejection (no unhandled rejection) and logs the label", async () => {
    safeFireAndForget("async-label", async () => {
      throw new Error("boom-async");
    });
    await flush();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [payload] = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(payload).toMatchObject({ label: "async-label", err: "boom-async" });
  });

  it("catches a synchronous throw (before the promise is created) without throwing to the caller", () => {
    expect(() =>
      safeFireAndForget("sync-label", () => {
        throw new Error("boom-sync");
      }),
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [payload] = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(payload).toMatchObject({ label: "sync-label", err: "boom-sync" });
  });

  it("stringifies non-Error rejections", async () => {
    safeFireAndForget("str", async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "plain-string";
    });
    await flush();
    const [payload] = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(payload).toMatchObject({ label: "str", err: "plain-string" });
  });
});
