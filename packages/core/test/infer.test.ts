import { describe, expect, it } from "vitest";
import { infer } from "../src/infer";
import { templatePath } from "../src/path";

describe("infer", () => {
  it("detects scalar types and formats", () => {
    expect(infer("2026-11-17T10:00:00Z")).toEqual({ type: "string", format: "date-time", example: "2026-11-17T10:00:00Z" });
    expect(infer("a@b.co").format).toBe("email");
    expect(infer(3).type).toBe("integer");
    expect(infer(3.5).type).toBe("number");
  });

  it("merges array items into optional and nullable fields", () => {
    const node = infer([
      { id: 1, note: "x", coupon: null },
      { id: 2, coupon: "SAVE" },
    ]);
    expect(node.items?.fields).toEqual([
      { name: "id", required: true, schema: { type: "integer", example: 1 } },
      { name: "note", required: false, schema: { type: "string", example: "x" } },
      { name: "coupon", required: true, schema: { type: "string", nullable: true, example: "SAVE" } },
    ]);
  });

  it("widens integer and number, and marks mixed types", () => {
    expect(infer([1, 2.5]).items?.type).toBe("number");
    expect(infer([1, "a"]).items).toMatchObject({ type: "mixed", variants: [{ type: "integer" }, { type: "string" }] });
  });

  it("handles empty arrays", () => {
    expect(infer([])).toEqual({ type: "array", items: { type: "unknown" } });
  });
});

describe("templatePath", () => {
  it("templates id-like segments and names them from the previous segment", () => {
    const { template, params } = templatePath("/v1/users/8f1c2d3e-0000-4000-8000-000000000001/orders/42");
    expect(template).toBe("/v1/users/{userId}/orders/{orderId}");
    expect(params.map((p) => [p.name, p.type, p.format])).toEqual([
      ["userId", "string", "uuid"],
      ["orderId", "integer", undefined],
    ]);
  });

  it("keeps explicit templates", () => {
    expect(templatePath("/users/%7Bid%7D/posts/:slug").template).toBe("/users/{id}/posts/{slug}");
  });

  it("doesn't mangle words ending in -us or -ss", () => {
    expect(templatePath("/status/422").template).toBe("/status/{statusId}");
    expect(templatePath("/addresses/7").template).toBe("/addresses/{addressId}");
    expect(templatePath("/boxes/7").template).toBe("/boxes/{boxId}");
    expect(templatePath("/address/7").template).toBe("/address/{addressId}");
  });

  it("leaves normal paths alone", () => {
    expect(templatePath("/v1/categories/search").params).toEqual([]);
  });
});
