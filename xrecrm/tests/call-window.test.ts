import { expect, it } from "vitest";
import { callWindowState } from "../client/src/workspace/components/CallWindow";
import { recordingUrl } from "../client/src/workspace/components/CustomerTimeline";

it("arama penceresi durumu okunur metne çevirir", () => {
  expect(callWindowState("queued", 5)).toEqual({ text: "Telefonunuz çalıyor, açın…", tone: "wait" });
  expect(callWindowState(undefined, 120).text).toBe("Santralden yanıt bekleniyor");
  expect(callWindowState("ringing", 5).tone).toBe("wait");
  expect(callWindowState("in-progress", 30)).toEqual({ text: "Görüşme sürüyor", tone: "live" });
  expect(callWindowState("ended", 30).tone).toBe("done");
  expect(callWindowState("missed", 30)).toEqual({ text: "Cevap alınamadı", tone: "missed" });
});

it("ses kaydı yalnız https adresle oynatılır", () => {
  expect(recordingUrl("https://dosyaindir.example.test/kayit?q=1")).toBe("https://dosyaindir.example.test/kayit?q=1");
  expect(recordingUrl("http://ornek.test/a.mp3")).toBe("");
  expect(recordingUrl("javascript:alert(1)")).toBe("");
  expect(recordingUrl(undefined)).toBe("");
});
