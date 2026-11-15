import { describe, expect, it } from "vitest";
import { rankForDrop, sortLeads } from "../shared/kanban-order";

const lead = (id: string, name: string, value: number, createdAt: string, rank?: number) => ({ id, name, value, createdAt, lastActivity: createdAt, rank });
const A = lead("a", "Çağla", 300, "2026-01-01T00:00:00Z");
const B = lead("b", "Ahmet", 900, "2026-03-01T00:00:00Z");
const C = lead("c", "Zeynep", 100, "2026-02-01T00:00:00Z");
const ids = (list: { id: string }[]) => list.map((l) => l.id).join("");

describe("kanban sıralaması", () => {
  it("tarihe, tutara ve ada göre sıralar", () => {
    expect(ids(sortLeads([A, B, C], "date"))).toBe("bca");
    expect(ids(sortLeads([A, B, C], "value"))).toBe("bac");
    expect(ids(sortLeads([A, B, C], "name"))).toBe("bac"); // Ahmet, Çağla, Zeynep
  });
  it("elle sırada hiç taşınmamış kartlar yeniden eskiye durur", () => {
    expect(ids(sortLeads([A, B, C], "manual"))).toBe("bca");
  });
  it("kart bırakıldığı yerde kalır: başa, araya ve sona", () => {
    const column = sortLeads([A, B, C], "manual"); // b, c, a
    const place = (beforeId: string | null) => ids(sortLeads([...column, lead("x", "Yeni", 0, "2020-01-01T00:00:00Z", rankForDrop(column, beforeId))], "manual"));
    expect(place("b")).toBe("xbca");
    expect(place("c")).toBe("bxca");
    expect(place("a")).toBe("bcxa");
    expect(place(null)).toBe("bcax");
    expect(rankForDrop([], null)).toBe(0);
  });
  it("art arda aynı araya bırakılan kartlar da sırasını korur", () => {
    let column = sortLeads([A, B], "manual"); // b, a
    for (const id of ["x", "y", "z"]) column = sortLeads([...column, lead(id, id, 0, "2020-01-01T00:00:00Z", rankForDrop(column, "a"))], "manual");
    expect(ids(column)).toBe("bxyza");
  });
});
