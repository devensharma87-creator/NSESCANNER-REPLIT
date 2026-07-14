/**
 * BUG-85/86 Telegram bot commands — router unit tests.
 *
 * The long-poll loop is exercised end-to-end in production; here we
 * verify the command routing / recognition / help text so behaviour
 * stays stable across refactors.
 */
import { describe, it, expect } from "vitest";
import { routeCommand } from "./telegramBotCommands";

describe("BUG-85/86 telegramBotCommands.routeCommand", () => {
  it("returns null for messages that are not a slash-command", async () => {
    expect(await routeCommand("hello there")).toBeNull();
    expect(await routeCommand("")).toBeNull();
    expect(await routeCommand("/notacommand")).toBeNull();
  });

  it("/help lists every command", async () => {
    const out = await routeCommand("/help");
    expect(out).not.toBeNull();
    for (const cmd of [
      "/status",
      "/clock",
      "/positions",
      "/pnl",
      "/pause",
      "/resume",
      "/help",
    ]) {
      expect(out!).toContain(cmd);
    }
  });

  it("recognizes /command@bot_username syntax", async () => {
    const a = await routeCommand("/help");
    const b = await routeCommand("/help@some_bot");
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });

  it("strips arguments and only routes on the first token", async () => {
    // Even if the user types extra args, the first token is used;
    // handlers accept no arguments and must never blow up.
    const out = await routeCommand("/help extra ignored args");
    expect(out).not.toBeNull();
    expect(out!).toContain("/status");
  });

  it("is case-insensitive on the command name", async () => {
    const a = await routeCommand("/help");
    const b = await routeCommand("/HELP");
    expect(a).toEqual(b);
  });
});
