import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMermaidLikelyBroken,
  sanitizeMermaidInMarkdown,
  sanitizeMermaidSource,
} from "./sanitize";

describe("sanitizeMermaidSource", () => {
  it("quotes node labels with parentheses", () => {
    const out = sanitizeMermaidSource(`flowchart TD
  C[Content Delivery Network (CDN)]
`);
    assert.match(out, /C\["Content Delivery Network \(CDN\)"\]/);
  });

  it("rewrites subgraph ids with slashes", () => {
    const out = sanitizeMermaidSource(`flowchart TD
  subgraph Edge/CDN
    C[CDN]
  end
`);
    assert.match(out, /subgraph Edge_CDN\["Edge\/CDN"\]/);
    assert.doesNotMatch(out, /subgraph Edge\/CDN\s*$/m);
  });

  it("fixes the reported broken image-upload diagram shape", () => {
    const broken = `flowchart TD
  subgraph Client
    A[User Interface]
    B[Image Upload Form]
  end
  subgraph Edge/CDN
    C[Content Delivery Network (CDN)]
  end
  subgraph Backend
    D[Load Balancer]
    E[API Gateway]
    F[`;
    const out = sanitizeMermaidSource(broken);
    assert.match(out, /subgraph Edge_CDN\["Edge\/CDN"\]/);
    assert.match(out, /C\["Content Delivery Network \(CDN\)"\]/);
    assert.doesNotMatch(out, /\bF\[\s*$/m);
    // All subgraphs closed
    const subs = (out.match(/\bsubgraph\b/g) || []).length;
    const ends = (out.match(/^\s*end\s*$/gm) || []).length;
    assert.equal(subs, ends);
  });

  it("quotes labels with slashes and colons", () => {
    const out = sanitizeMermaidSource(`flowchart LR
  A[API / Services] --> B[DB: Postgres]
`);
    assert.match(out, /A\["API \/ Services"\]/);
    assert.match(out, /B\["DB: Postgres"\]/);
  });

  it("leaves already-quoted labels alone", () => {
    const src = `flowchart TD
  A["Object Storage (S3)"]
`;
    const out = sanitizeMermaidSource(src);
    assert.match(out, /A\["Object Storage \(S3\)"\]/);
  });

  it("sanitizes mermaid fences inside markdown", () => {
    const md = `## Arch
\`\`\`mermaid
flowchart TD
  subgraph Edge/CDN
    C[CDN (edge)]
  end
\`\`\`
`;
    const out = sanitizeMermaidInMarkdown(md);
    assert.match(out, /subgraph Edge_CDN\["Edge\/CDN"\]/);
    assert.match(out, /C\["CDN \(edge\)"\]/);
  });

  it("repairs an unterminated trailing ```mermaid fence in markdown", () => {
    // Generation cut off before the closing ``` — the naive regex (which
    // requires a closing fence) would skip this and the broken diagram would
    // reach the renderer.
    const md = `Here is the design:

\`\`\`mermaid
flowchart TD
  subgraph Edge/CDN
    C[Content Delivery Network (CDN)]
  end
  subgraph Backend
    D[Load Balancer]
    F[`;
    const out = sanitizeMermaidInMarkdown(md);
    // Fence is now closed (even number of ``` fences).
    assert.equal((out.match(/```/g) || []).length % 2, 0);
    assert.match(out, /subgraph Edge_CDN\["Edge\/CDN"\]/);
    assert.match(out, /C\["Content Delivery Network \(CDN\)"\]/);
    assert.doesNotMatch(out, /\bF\[\s*$/m);
  });

  it("detects still-broken truncated sources", () => {
    assert.equal(isMermaidLikelyBroken("flowchart TD\n  A["), true);
    assert.equal(
      isMermaidLikelyBroken(`flowchart TD
  A[Client] --> B[API]
`),
      false
    );
  });
});
