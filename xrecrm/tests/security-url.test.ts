import { describe, it, expect, vi } from "vitest";
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => [
    {
      address: host === "rebinding.example" ? "127.0.0.1" : "104.18.0.1",
      family: 4,
    },
  ]),
}));
import { assertSafeOutboundUrl } from "../server/security";
describe("Dış bağlantı hedef güvenliği", () => {
  it("genel alan adlarını DNS kontrolüyle kabul eder", async () => {
    expect(
      (await assertSafeOutboundUrl("https://xre111.shop/api/v1/workflows"))
        .hostname,
    ).toBe("xre111.shop");
  });
  it.each([
    "http://xre111.shop",
    "https://localhost",
    "https://10.2.3.4",
    "https://127.0.0.1",
    "https://[::1]",
    "https://[::ffff:7f00:1]",
    "https://100.64.1.1",
    "https://user:pass@xre111.shop",
    "https://rebinding.example",
  ])("güvensiz hedefi engeller: %s", async (url) => {
    await expect(assertSafeOutboundUrl(url)).rejects.toThrow();
  });
});
