import { describe, expect, it } from "vitest";
import { cleanPhoneInput, phoneProblem } from "../shared/phone";

describe("telefon alanı", () => {
  it("yazarken harfleri ayıklar", () => {
    expect(cleanPhoneInput("abc")).toBe("");
    expect(cleanPhoneInput("+90 (532) 123-45-67 dahili")).toBe("+90 (532) 123-45-67 ");
  });
  it("kayıtta harfli ve çok kısa numarayı reddeder, boşu kabul eder", () => {
    expect(phoneProblem("")).toBeNull();
    expect(phoneProblem("+90 532 123 45 67")).toBeNull();
    expect(phoneProblem("0532.123.45.67")).toBeNull();
    expect(phoneProblem("abc")).toMatch(/harf/);
    expect(phoneProblem("123")).toMatch(/7–15/);
  });
});
