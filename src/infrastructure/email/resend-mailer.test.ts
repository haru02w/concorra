import { describe, expect, it, vi } from "vitest";
import { ConsoleMailer, ResendMailer } from "./resend-mailer";

const message = { to: ["a@b.c"], subject: "Oi", html: "<p>Oi</p>", text: "Oi" };

describe("ResendMailer", () => {
  it("sends with the configured sender", async () => {
    const send = vi.fn(async () => ({ error: null }));
    await new ResendMailer({ apiKey: "re_x", from: "Concorra <no-reply@x>" }, { emails: { send } }).send(message);
    expect(send).toHaveBeenCalledWith({ from: "Concorra <no-reply@x>", ...message });
  });

  it("throws on API errors", async () => {
    const send = vi.fn(async () => ({ error: { message: "invalid from" } }));
    await expect(new ResendMailer({ apiKey: "re_x", from: "x" }, { emails: { send } }).send(message)).rejects.toThrow("invalid from");
  });
});

describe("ConsoleMailer", () => {
  it("logs instead of sending", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await new ConsoleMailer().send(message);
    expect(log.mock.calls[0][0]).toContain("a@b.c");
    log.mockRestore();
  });
});
