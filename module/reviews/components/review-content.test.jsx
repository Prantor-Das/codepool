import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewContent } from "./review-content";

const base = { walkthrough: "Changed the handler.", summary: "One finding.", strengths: [], suggestions: [] };

describe("ReviewContent", () => {
  test("renders a model fix prompt in its own code block", () => {
    const html = renderToStaticMarkup(<ReviewContent review={{ ...base, issues: [{ title: "Validate input", file: "app/api/route.ts", lineStart: 10, lineEnd: 12, description: "Input is unchecked.", severity: "high", fixPrompt: "In app/api/route.ts:10-12, validate the input before use." }] }} />);
    expect(html).toContain("In app/api/route.ts:10-12, validate the input before use.");
    expect(html).toContain("<pre>");
  });
  test("uses a useful fallback when fixPrompt is absent", () => {
    const html = renderToStaticMarkup(<ReviewContent review={{ ...base, issues: [{ title: "Validate input", file: "app/api/route.ts", lineStart: 10, lineEnd: 12, description: "Input is unchecked.", severity: "high" }] }} />);
    expect(html).toContain("Inspect app/api/route.ts:10-12 and implement the change described above.");
  });
  test("does not render injected HTML from a fix prompt", () => {
    const html = renderToStaticMarkup(<ReviewContent review={{ ...base, issues: [{ title: "Unsafe text", file: "app/api/route.ts", lineStart: 1, lineEnd: 1, description: "Test.", severity: "low", fixPrompt: "<script>window.pwned=true</script>" }] }} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
