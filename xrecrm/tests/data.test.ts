import { describe, it, expect } from "vitest";
import {
  lines,
  makeDemo,
  stages,
  formatPhone,
} from "../client/src/workspace/data";
describe("XRE hat envanteri", () => {
  it("47 benzersiz numarayı ve 8/16/23 grup dağılımını korur", () => {
    expect(lines).toHaveLength(47);
    expect(new Set(lines.map((l) => l.phone)).size).toBe(47);
    expect(lines.filter((l) => l.group === "ai")).toHaveLength(8);
    expect(lines.filter((l) => l.group === "office")).toHaveLength(16);
    expect(lines.filter((l) => l.group === "cloud")).toHaveLength(23);
  });
  it("13 ICCID eşleşmesini karakter dizisi olarak eksiksiz saklar", () => {
    const cloud = lines.filter((l) => l.iccid);
    expect(cloud).toHaveLength(13);
    expect(cloud[0]).toMatchObject({
      phone: "+905553000001",
      iccid: "89900000000000000001",
    });
    expect(cloud[12]).toMatchObject({
      phone: "+905553000013",
      iccid: "89900000000000000013",
    });
    expect(cloud.every((l) => l.iccid?.length === 20)).toBe(true);
  });
  it("850 AI numarasını ve telefon formatını korur", () => {
    expect(
      lines.some((l) => l.phone === "+908500000006" && l.group === "ai"),
    ).toBe(true);
    expect(formatPhone("+905551000001")).toBe("+90 555 100 00 01");
  });
});
describe("Güvenli demo verileri", () => {
  it("her örnek müşteri demo kimliği ile ayrılır ve bağlı hesap üretmez", () => {
    const d = makeDemo();
    expect(d.leads.every((l) => l.id.startsWith("demo-"))).toBe(true);
    expect(d.connections).toEqual([]);
    expect(d.calls).toEqual([]);
    expect(d.events.every((e) => e.status === "demo")).toBe(true);
  });
  it("her örnek aşama ve konuşma CRM kaydına bağlıdır", () => {
    const d = makeDemo();
    expect(d.leads.every((l) => stages.some((s) => s.id === l.stage))).toBe(
      true,
    );
    expect(
      d.messages.every((m) => d.leads.some((l) => l.id === m.leadId)),
    ).toBe(true);
  });
});
