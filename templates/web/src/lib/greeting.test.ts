import { describe, expect, it } from "vitest";
import { greeting } from "./greeting";

describe("greeting", () => {
  it("names the app", () => {
    expect(greeting("Labs")).toBe("Welcome to Labs");
  });
});
