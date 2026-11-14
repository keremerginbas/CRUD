import { expect, it } from "vitest";
import { describeProviderError } from "../server/security";

it("dış servis hatasının nedenini okunur biçimde verir", () => {
  expect(describeProviderError({ status: 400, error: "Bad Request", response: { message: [{ exists: false, jid: "905550000001@s.whatsapp.net", number: "905550000001" }] } }, 400)).toBe("Bu numara WhatsApp'ta kayıtlı değil: 905550000001");
  expect(describeProviderError({ status: 400, error: "Bad Request", response: { message: ["instance requires property 'number'"] } }, 400)).toBe("Dış servis HTTP 400: instance requires property 'number'");
  expect(describeProviderError({ status: 500, error: "Internal Server Error", response: { message: "Connection Closed" } }, 500)).toContain("bağlantısı kopmuş");
  expect(describeProviderError({ error: { message: "Invalid OAuth access token" } }, 401)).toBe("Dış servis HTTP 401: Invalid OAuth access token");
  expect(describeProviderError({ message: "Unsupported media type" }, 415)).toBe("Dış servis HTTP 415: Unsupported media type");
  expect(describeProviderError({ raw: "<html>Bad Gateway</html>" }, 502)).toBe("Dış servis HTTP 502: <html>Bad Gateway</html>");
  expect(describeProviderError({}, 400)).toBe("Dış servis HTTP 400");
  expect(describeProviderError({ error: "Bad Request" }, 400)).toBe("Dış servis HTTP 400");
});
