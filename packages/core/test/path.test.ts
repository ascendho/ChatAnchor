import { describe, expect, it } from "vitest";
import {
  isPathInside,
  pathKey,
  relativeToRoot,
} from "../src/path.js";

describe("path helpers", () => {
  it("recognizes a project root and its descendants", () => {
    expect(isPathInside("/work/ToolSpec", "/work/ToolSpec")).toBe(true);
    expect(isPathInside("/work/ToolSpec/packages/core", "/work/ToolSpec")).toBe(true);
    expect(isPathInside("/work/ToolSpec-old", "/work/ToolSpec")).toBe(false);
    expect(relativeToRoot("/work/ToolSpec/packages/core", "/work/ToolSpec"))
      .toBe("packages/core");
  });

  it("normalizes Windows keys case-insensitively", () => {
    expect(pathKey("C:\\Users\\Ada\\Repo", "win32"))
      .toBe(pathKey("c:\\users\\ada\\repo", "win32"));
  });
});
