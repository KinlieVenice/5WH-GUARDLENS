import { describe, it, expect } from "vitest";
import { formSchema } from "../../shared/report-schema.js";

const ok = [
  { key: "location", label: "Location", type: "text", required: true },
  { key: "severity", label: "Severity", type: "dropdown", required: true, options: ["Low", "High"] },
  { key: "photo", label: "Photo", type: "photo", required: false },
  { key: "injured", label: "Injured?", type: "yesno", required: false },
];

describe("formSchema", () => {
  it("accepts a well-formed field list", () => {
    expect(formSchema.parse(ok)).toHaveLength(4);
  });

  it("rejects an unknown field type", () => {
    expect(() => formSchema.parse([{ key: "x", label: "X", type: "slider", required: false }])).toThrow();
  });

  it("rejects duplicate keys within a form", () => {
    expect(() =>
      formSchema.parse([
        { key: "dup", label: "A", type: "text", required: false },
        { key: "dup", label: "B", type: "text", required: false },
      ]),
    ).toThrow();
  });

  it("rejects a dropdown without options", () => {
    expect(() => formSchema.parse([{ key: "d", label: "D", type: "dropdown", required: true }])).toThrow();
  });

  it("rejects a non-dropdown carrying options", () => {
    expect(() => formSchema.parse([{ key: "t", label: "T", type: "text", required: false, options: ["a"] }])).toThrow();
  });

  it("rejects an empty label", () => {
    expect(() => formSchema.parse([{ key: "t", label: "", type: "text", required: false }])).toThrow();
  });

  it("rejects a dropdown with an empty options array", () => {
    expect(() => formSchema.parse([{ key: "d", label: "D", type: "dropdown", required: true, options: [] }])).toThrow();
  });
});
