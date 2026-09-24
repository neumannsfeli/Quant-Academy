import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/tex";

describe("renderMarkdown", () => {
  it("keeps KaTeX's inline positioning styles", () => {
    expect(renderMarkdown("so $\\binom{10}{3} = 120$")).toMatch(/style="height:/);
  });
  it("strips script and event handlers from authored markdown", () => {
    const h = renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a>');
    expect(h).not.toMatch(/<script|onerror|javascript:/);
  });
});
