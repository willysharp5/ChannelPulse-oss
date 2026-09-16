/**
 * Shared house style for interview model answers (bank generation + assessments).
 * Rendered with Markdown + Mermaid + a code-panel UI for fenced code.
 */

/**
 * Rigorous, book-grounded system-design solution format (matches Alex Xu's
 * "System Design Interview" framework). Used by the bank generator AND the
 * end-of-session assessment so both read the same way — well-baked, with a
 * sophisticated architecture diagram and flows.
 */
export const SYSTEM_DESIGN_SOLUTION_FORMAT = `SYSTEM DESIGN model_answer MUST be a DETAILED, well-baked solution for THIS problem
(not a short bullet list). GitHub-flavored Markdown with blank lines between sections. Include
concrete numbers, formulas, API names, data models, and failure modes. Follow Alex Xu's framework.
Use these EXACT ### headings, in this order:

### 1. Requirements & scale
Functional + non-functional requirements (bullets). Then back-of-the-envelope estimates
(QPS, storage, bandwidth) with brief math.

### 2. High-level architecture
ONE sophisticated, VALID \`\`\`mermaid flowchart TD that uses subgraphs to group tiers
(Client, Edge/CDN, Load Balancer, API / Services, Cache, Datastores, Message Queue, Workers).
Label edges with the request/data that flows between them. Keep node text short.

CRITICAL: Mermaid must parse. Follow these rules exactly:
- Node ids: letters/numbers/underscore only (Client, Edge_CDN). Never put "/" or spaces in ids.
- Labels with parentheses, slashes, colons, commas MUST use quotes inside brackets:
  Good: CDN["Edge / CDN"]  Store["Object Storage (S3)"]
  Bad:  CDN[Edge/CDN]      Store[Object Storage (S3)]
- Subgraphs with special characters:
  Good: subgraph edge_cdn["Edge / CDN"]
  Bad:  subgraph Edge/CDN
- Close every subgraph with "end". Never leave a truncated node like \`F[\`.
- No classDef / styling. Prefer short labels.

### 3. API design
Key endpoints (method + path + purpose) in a short list or fenced block.

### 4. Data model & storage
Chosen datastores and why (SQL / NoSQL / blob / cache / search), key tables/collections,
and the partition/shard key.

### 5. Deep dive
The crux of THIS problem: the core algorithm/technique done correctly (e.g. rate-limiting
algorithm, consistent hashing, fan-out, dedup, ID generation, ranking). Add a
\`\`\`mermaid sequenceDiagram of the main request/data flow when it clarifies the design.

### 6. Scale, bottlenecks & trade-offs
Replication, sharding, caching strategy, single points of failure, and explicit trade-offs
(CAP, consistency vs availability, push vs pull, sync vs async, SQL vs NoSQL).

Aim 500–900 words. Depth and at least one correct Mermaid diagram (plus a flow where useful)
are REQUIRED: never return just a diagram + 3 bullets.`;

/**
 * Product-manager interview answer format (product sense/design, strategy, and
 * analytical/metrics execution). Structured, speakable, no code.
 */
export const PRODUCT_SOLUTION_FORMAT = `PRODUCT (PM) model_answer MUST be a structured, speakable answer that shows product judgment,
NOT code. GitHub-flavored Markdown with **bold** section headers and blank lines between them.
Pick the shape that fits the question:

For a PRODUCT SENSE / DESIGN / "improve X" / "design X for Y" question, use these headers in order:
1. **Clarify & scope**: restate the goal; state 2–4 assumptions (who is this for, platform, business goal,
   constraints). Ask the clarifying questions a strong candidate would.
2. **User segments & pain points**: name 2–3 segments, pick ONE to focus on, and its key jobs-to-be-done /
   pain points (with a quick rationale for the choice).
3. **Goals & success metrics**: the product goal and a **North Star metric** plus 2–3 supporting/guardrail
   metrics you'd move.
4. **Solutions**: 2–3 concrete, differentiated ideas as bullets; then **Recommendation:** pick one and say
   why (impact vs effort / reach). A small \`\`\`mermaid flowchart of the user flow is welcome when it clarifies.
5. **Prioritization & trade-offs**: how you'd sequence (e.g. RICE / impact-effort), what you'd cut, and the
   key trade-offs/risks.
6. **MVP, measurement & rollout**: the smallest testable version, the experiment/metric to validate it, and
   how you'd ship (beta → rollout).

For an ANALYTICAL / METRICS / "diagnose the drop" / "which metric" question, use:
1. **Clarify & framing** · 2. **Define the metric(s)** (formula + why) · 3. **Break it down** (funnel /
segments / dimensions; a \`\`\`mermaid flowchart of the funnel helps) · 4. **Hypotheses** (internal vs external,
ranked) · 5. **How to investigate** (what data/cuts confirm each) · 6. **Decision & guardrails**.

Aim 300–550 words. First person, crisp, structured. NEVER include a code solution.`;

export const MODEL_ANSWER_FORMAT_RULES = `model_answer FORMATTING (rendered with syntax highlighting + Mermaid + a code UI):
Use short lines, bullets or numbered steps, and blank lines between sections where helpful.
A reader should be able to study the answer and know what a strong response looks like.

- "coding": The solution MUST be in JavaScript by default (the app's coding sandbox), or Python if the
  question explicitly calls for it, NEVER bash/shell, SQL, or any other language. Even if the question is
  phrased as a shell/CLI/one-liner task, implement the equivalent logic in JavaScript (or Python). Use one
  fenced code block with the matching language tag (\`\`\`javascript or \`\`\`python), a complete working
  solution, and clear inline comments. After the code, at most 2–4 short bullets for the approach, then
  **Complexity:** time / space (Big-O). No long paragraphs.
- "technical": Numbered steps or tight bullets. If the answer involves a flow, process, protocol,
  or architecture, INCLUDE a \`\`\`mermaid diagram (flowchart TD or sequenceDiagram). Each bullet = one idea.
- "system_design": ${SYSTEM_DESIGN_SOLUTION_FORMAT}
- "behavioral": A DETAILED, speakable STAR answer, long enough to speak in ~2–3 minutes (roughly
  250–400 words), with real specifics, not a 4-line summary. Labeled sections with blank lines between them:
  1. **Situation** 2–3 sentences: concrete context, your role, the scale/stakes (team size, users,
     timeline, business impact) and why it mattered.
  2. **Task** 1–2 sentences: the specific goal you owned and the key constraint/tension.
  3. **Action** 4–6 sub-bullets: the specific steps YOU took, the decisions/trade-offs you made and WHY,
     how you influenced people, plus a concrete example. First person, showing judgment (not generic verbs).
  4. **Result** 2–3 sentences: quantified outcome (metrics), team/business impact, and a brief reflection
     on what you learned or would do differently.
  First person, natural spoken tone, no code. Depth and specifics are required.
- "product": ${PRODUCT_SOLUTION_FORMAT}`;

/**
 * Fallback Tips walkthrough when no bank model answer is available.
 * Same section shape as SYSTEM_DESIGN_SOLUTION_FORMAT so the UI stays consistent.
 */
export const DEFAULT_SYSTEM_DESIGN_GUIDE = `## What's being tested
System design interviews test whether you can turn an ambiguous product problem into a correct,
operable backend: clear requirements, a concrete data model, a request/data flow you can draw,
and explicit trade-offs. Interviewers care less about buzzwords and more about invariants:
idempotency, consistency boundaries, failure modes, and how money/time/identity are represented.

A strong answer balances a simple first design (often a single service + primary database) with
a clear path to scale, audit, and recover. Weak answers jump to Kafka / microservices before
naming entities, APIs, or correctness rules.

## Architecture
\`\`\`mermaid
flowchart TD
  Client["Client / Admin"] --> LB["API Gateway / LB"]
  LB --> API[App Service]
  API --> Cache[(Cache)]
  API --> DB[(Primary DB)]
  API --> Q[Async Queue]
  Q --> Worker[Workers]
  Worker --> DB
  Worker --> Ext[External APIs]
\`\`\`

## Core knowledge
- **Clarify first.** Users, scale (QPS, data size), latency, consistency, multi-tenancy, and
  what "success" means for writes vs reads.
- **Name the entities.** Tables/collections, key fields, uniqueness, and what is immutable
  vs mutable. Prefer append-only events for money and audits.
- **Draw the write path and the read path separately.** Writes create durable records;
  reads may use caches, projections, or pre-aggregates.
- **Idempotency.** Every money-moving or side-effecting API needs an Idempotency-Key (or
  deterministic natural key) and a stored request → result mapping.
- **State machines for lifecycle.** e.g. CALCULATED → APPROVED → SUBMITTED → PAID with
  guarded transitions under row locks or optimistic versions.
- **Money & time.** Integer minor units (cents); half-open time intervals \`[start, end)\`;
  explicit timezones and rounding policy.
- **Concurrency.** State the consistency boundary (per user, per tenant, per payroll run)
  and the lock/CAS strategy inside it; avoid global locks.
- **Failure modes.** Retries, poison messages, partial outages, late events, duplicate
  delivery, and how the design stays correct under each.
- **Observability.** Metrics (QPS, lag, error rate, p95), audit logs, and a way to answer
  "why did this record end up in this state?"
- **Scale only after correctness.** Partitioning, queues, and caches come after the
  single-node invariants are clear.

## Worked example
1. **Clarify scope**: "Are we calculating only, or also moving money? What's the peak
   QPS and retention? Multi-tenant?"
2. **Data model**: list 4–8 entities with primary keys and one invariant each
   (e.g. payout rows are immutable once PAID).
3. **Happy path**: validate input → persist event → compute / enqueue → update state
   → return idempotent response.
4. **Hard parts**: overlaps, rate changes, duplicates, concurrent updates; name the
   algorithm or lock and the Big-O if relevant.
5. **Close**: one trade-off you chose, one you deferred, and "If I had more time…"
   (corrections, backfills, richer audit).

## A second angle
Reframe the same problem as either (a) live aggregation under concurrency or
(b) settlement / compliance with immutable snapshots. Keep the same fundamentals
(precision, idempotency, audit) but shift which component is the center of gravity.

## Common pitfalls
**Pitfall: Jumping to distributed architecture before correctness.**
Start with schema, algorithms, transactions, and idempotency. Add Kafka and shards only
after the invariants are explicit.

**Pitfall: Vague boxes without contracts.**
Every arrow should imply an API or event with fields, failure behavior, and whether
retries are safe.

**Pitfall: Ignoring historical / audit correctness.**
Financial and HR systems must explain past decisions under the policy/version that was
active then, not only the latest rules.

## Trade-offs
- **On-demand compute vs materialized snapshots**: snapshots win once approval or money
  movement begins.
- **SQL ledger vs NoSQL analytics**: strong consistency for money; separate store for
  reporting.
- **Sync API vs async workers**: sync for low-latency validation; async for heavy runs
  and external payouts.
- **Exact vs approximate aggregates**: prefer exact for money; approximations only for
  dashboards where stated.

## Interview tip
Spend the first 60 seconds on requirements and assumptions, then draw. Talk while you
draw: data model → path → failure → scale. Prefer correctness and auditability over
cleverness when the domain touches money, identity, or compliance.

## Connections
Expect pivots into coding (interval merge, rate limiting), API design (idempotent POST),
ledger / event sourcing, concurrency control, and observability. Be ready to implement a
slice of the calculation or state machine on a whiteboard.
`;
