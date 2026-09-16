/**
 * Interview "playbooks" — distilled, authoritative guidance per category.
 *
 * These are the app's SECRET SAUCE: a compact, non-hallucinated grounding block
 * that is ALWAYS injected into hint/model-answer/grading prompts so the AI
 * coaches candidates exactly the way top companies expect — step by step. They
 * are curated from the same sources the ingestion pipeline crawls (Alex Xu's
 * System Design Interview, Grokking, GeeksforGeeks HLD/LLD, Cracking the Coding
 * Interview, STAR behavioral guides, and EM interview guides) so guidance is
 * available instantly and offline, even before/independent of the DB corpus.
 */

import { px } from "@/lib/prompts/overrides";

export type ReferenceCategory =
  | "system_design"
  | "coding"
  | "behavioral"
  | "technical"
  | "engineering_manager"
  | "product"
  | "consulting_case"
  | "finance"
  | "data_science"
  | "general";

export interface ReferenceLink {
  label: string;
  url: string;
}

export interface Playbook {
  title: string;
  /** Compact markdown grounding block injected into prompts. */
  guidance: string;
  /** "Learn more" links surfaced to the user (definitions / deeper reading). */
  learnMore: ReferenceLink[];
}

const SYSTEM_DESIGN: Playbook = {
  title: "System design interview playbook",
  guidance: `HOW TOP COMPANIES GRADE SYSTEM DESIGN (ground every answer in this):
Interviewers score signal, not buzzwords: did the candidate scope the problem, propose a
correct architecture, reason about data/scale, and name trade-offs? Weak answers jump to
"Kafka + microservices" before defining requirements, entities, or APIs.

FOLLOW THIS FRAMEWORK (Alex Xu 4-step + HLD/LLD), and walk the candidate through it step by step:
1) Requirements & scope: functional vs non-functional; clarify users, read/write ratio,
   consistency vs availability, latency SLOs, multi-tenancy, retention. State assumptions.
2) Back-of-the-envelope estimates: DAU, QPS (peak = ~2-3x avg), storage/day, bandwidth,
   cache size. Show the arithmetic.
3) High-level design (HLD): client → API gateway/LB → services → cache → datastore, plus
   async queue + workers where needed. One clear architecture diagram; label what flows on
   each edge.
4) Data model & API: key entities/tables, primary + partition/shard key, index choices,
   SQL vs NoSQL and WHY; core endpoints (method + path + purpose).
5) Deep dive (the crux): the one hard part of THIS problem done correctly: e.g. rate limiter
   algorithm, consistent hashing, fan-out on write vs read, dedup/idempotency, unique ID
   generation, ranking/feed, geo-index. Include a sequence/flow when it clarifies.
6) Scale, bottlenecks & trade-offs: replication, sharding, caching strategy & invalidation,
   single points of failure, hot keys, backpressure; then explicit trade-offs (CAP,
   strong vs eventual consistency, push vs pull, sync vs async, normalization vs denorm).

CORE CONCEPTS to reach for (define briefly when used): load balancing, caching (cache-aside,
write-through, TTL, eviction), CDN, database replication & sharding/partitioning, CAP theorem,
consistent hashing, message queues (Kafka/RabbitMQ) & event-driven design, idempotency,
rate limiting, leader election, quorum/replication factor, indexing, bloom filters, WAL,
back-pressure, observability (metrics/p95/tracing).

STRONG-ANSWER CHECKLIST: clarifies before drawing · quantifies scale · one correct diagram ·
names the partition key · addresses at least one failure mode · ends with 1-2 trade-offs and
"if I had more time…". Prefer correctness + auditability over cleverness when money/identity
/compliance are involved.`,
  learnMore: [
    { label: "System Design Handbook: the guide", url: "https://www.systemdesignhandbook.com/guides/system-design/" },
    { label: "50 System Design concepts explained (DesignGurus)", url: "https://designgurus.substack.com/p/50-system-design-concepts-explained" },
    { label: "GeeksforGeeks: HLD vs LLD, getting started", url: "https://www.geeksforgeeks.org/system-design/getting-started-with-system-design/" },
    { label: "Grokking the System Design Interview (Educative)", url: "https://www.educative.io/courses/grokking-the-system-design-interview" },
    { label: "System Design Interview: Alex Xu (ByteByteGo PDFs)", url: "https://blog.bytebytego.com/p/free-system-design-pdf-158-pages" },
  ],
};

const CODING: Playbook = {
  title: "Coding interview playbook",
  guidance: `HOW TOP COMPANIES GRADE CODING (ground every answer in this):
They evaluate problem-solving process, correctness, complexity, and communication, not memorized
answers. Coach the candidate through the process, then show an optimal, idiomatic solution.

WALK THE CANDIDATE THROUGH THESE STEPS:
1) Clarify: restate the problem, confirm input/output types, ranges, duplicates, empties,
   sortedness, and edge cases. Ask before assuming.
2) Examples: a concrete example + at least one edge case (empty, single, huge, negative).
3) Brute force first: state the naive approach and its Big-O, THEN optimize (interviewers
   explicitly reward "start simple, then improve").
4) Pick a pattern: map the problem to a known pattern and say why.
5) Plan then code: outline the algorithm in 1-3 lines, then write clean, correct code with
   good names and no dead code.
6) Test & analyze: dry-run the example, fix bugs, then state final time & space Big-O and any
   further optimization/trade-off.

THE 20 CORE PATTERNS (name the one you're using): two pointers · sliding window · fast/slow
pointers · merge intervals · cyclic sort · in-place linked-list reversal · BFS · DFS ·
backtracking · two heaps · subsets · modified binary search · top-K (heap) · K-way merge ·
topological sort · tries · union-find · greedy · dynamic programming (memo/tabulation) ·
bitwise. Know the go-to data structures: array, hashmap/set, stack, queue/deque, heap,
linked list, tree/BST, graph (adj list), trie.

COMPLEXITY: always give time AND space Big-O; know common costs (hashmap O(1) avg, sort
O(n log n), heap ops O(log n), BST balanced O(log n)). Prefer the optimal approach; mention
the trade-off if you choose a simpler one.

SOLUTION FORMAT: the app's sandbox runs JavaScript (or Python if asked); solutions MUST be in
JavaScript/Python, NEVER bash/shell/SQL, even for "CLI/one-liner" phrasing. One fenced code
block, inline comments, then a 2-4 bullet approach and **Complexity:** line.`,
  learnMore: [
    { label: "Grokking the Coding Interview: 28 patterns (Educative)", url: "https://www.educative.io/courses/grokking-coding-interview" },
    { label: "Cracking the Coding Interview (189 problems, PDF)", url: "https://github.com/kaushik27mishra/Daily_Practice_CP-DSA/blob/master/Cracking-the-Coding-Interview-6th-Edition-189-Programming-Questions-and-Solutions.pdf" },
    { label: "Coding Interview Patterns: Alex Xu (book)", url: "https://dokumen.pub/coding-interview-patterns-nail-your-next-coding-interview-1736049135-9781736049136.html" },
    { label: "Software Engineer Coding Interviews (notes)", url: "https://github.com/junfanz1/Software-Engineer-Coding-Interviews" },
  ],
};

const BEHAVIORAL: Playbook = {
  title: "Behavioral interview playbook",
  guidance: `HOW TOP COMPANIES GRADE BEHAVIORAL (ground every answer in this):
They probe real, first-person stories for leadership signals: ownership, impact, dealing with
conflict/ambiguity, collaboration, and growth. Vague or "we did X" answers score poorly.

USE STAR, and coach the candidate to a SPEAKABLE 2-3 minute answer (~250-400 words):
- Situation (2-3 sentences): concrete context, YOUR role, the scale/stakes (team size, users,
  timeline, business impact) and why it mattered.
- Task (1-2 sentences): the specific goal you owned and the key tension/constraint.
- Action (4-6 bullets): the specific steps YOU took, the decisions & trade-offs and WHY, how
  you influenced people: first person ("I"), showing judgment, not generic verbs.
- Result (2-3 sentences): quantified outcome (metrics), team/business impact, and a brief
  reflection on what you learned or would do differently.

TIPS interviewers reward: pick a story that truly maps to the competency; lead with your
individual contribution; quantify; own mistakes and show growth; keep it structured (the "Rule
of Three"), and don't hedge. Prepare stories covering: leadership/influence, conflict, failure
/mistake, ambiguity, disagreement with a manager, tight deadline, mentoring, and a proud
project.

COMMON COMPETENCIES & prompts: "Tell me about a time you led without authority / resolved a
conflict / dealt with a low performer / disagreed with your manager / handled a missed
deadline / drove a project end-to-end." Map each to a distinct, specific story.`,
  learnMore: [
    { label: "Awesome Behavioral Interviews (curated)", url: "https://github.com/ashishps1/awesome-behavioral-interviews" },
    { label: "Cracking the Behavioral Interview for SWEs (book)", url: "https://dokumen.pub/cracking-the-behavioral-interviews-for-software-engineers-2459154715.html" },
    { label: "STAR method & sample answers (guide)", url: "https://www.law.georgetown.edu/wp-content/uploads/2020/12/9781438198590.pdf" },
  ],
};

const TECHNICAL: Playbook = {
  title: "Technical / knowledge interview playbook",
  guidance: `HOW TOP COMPANIES GRADE TECHNICAL Q&A (ground every answer in this):
They want precise, structured explanations that show depth AND the ability to teach: define the
concept, explain how/why it works, give a concrete example, then state trade-offs and when to
use it.

ANSWER SHAPE (walk step by step):
1) One-line definition.
2) How it works: the mechanism, in numbered steps or a small diagram (include a mermaid
   flowchart/sequence when a process/protocol/architecture is involved).
3) Concrete example or use case.
4) Trade-offs / alternatives and when you'd choose each.
5) Gotchas & failure modes (what breaks in production).

Reach for the right fundamentals depending on the topic: data structures & Big-O, OS
(processes/threads, locks, deadlock, context switching, scheduling), networking (DNS, TCP/UDP,
HTTP/HTTPS, TLS, WebSockets), databases (indexes, transactions/ACID, isolation levels, SQL vs
NoSQL), concurrency, caching, and security (authN vs authZ, OAuth/JWT, hashing). Be precise and
correct; say "it depends" only with the deciding factors.`,
  learnMore: [
    { label: "GeeksforGeeks: System Design & CS fundamentals", url: "https://www.geeksforgeeks.org/system-design/getting-started-with-system-design/" },
    { label: "50 concepts every engineer should know", url: "https://designgurus.substack.com/p/50-system-design-concepts-explained" },
  ],
};

const ENGINEERING_MANAGER: Playbook = {
  title: "Engineering manager interview playbook",
  guidance: `HOW TOP COMPANIES GRADE ENGINEERING MANAGERS (ground every answer in this):
EM loops blend (a) people/leadership, (b) project & execution, (c) technical/system design, and
sometimes (d) coding. They want a leader who is technical enough to earn trust AND excellent at
growing people and delivering.

PEOPLE & LEADERSHIP (use STAR, first person, quantified): performance management (coaching low
performers, motivating high performers, PIPs done humanely), 1:1s & career growth, hiring & bar
raising, handling conflict (with ICs, peers, PMs, your own manager), building diverse/inclusive
teams, spotting & preventing burnout, and driving culture. Show frameworks AND a concrete story.

PROJECT & EXECUTION: prioritization across competing demands, scope/quality/schedule trade-offs,
managing cross-team dependencies, agile/process (and signals of too much/too little), how you
measure success/failure, and driving decisions with data.

TECHNICAL / SYSTEM DESIGN: EMs still design systems; apply the full system-design framework
(requirements → estimates → HLD diagram → data/API → deep dive → scale/trade-offs) but also
speak to team topology, build-vs-buy, tech-debt strategy, and operational excellence (on-call,
SLOs, incident review).

STRONG-ANSWER CHECKLIST: leads with impact & ownership; balances empathy with accountability;
gives a repeatable framework + a specific quantified example; connects team health to business
outcomes.`,
  learnMore: [
    { label: "Google Engineering Manager interview prep guide (PDF)", url: "https://hbcuconnect.com/ads/google/GoogleManager.pdf" },
    { label: "The Software Engineering Manager Interview Guide (2nd ed.)", url: "https://www.managersclub.com/posts/software-engineering-manager-interview-guide-2nd-edition" },
    { label: "Cracking the EM interview (Medium series)", url: "https://medium.com/srivatsan-sridharan/cracking-the-engineering-manager-interview-part-1-adb0b63c7f2f" },
  ],
};

const PRODUCT: Playbook = {
  title: "Product (PM) interview playbook",
  guidance: `HOW TOP COMPANIES GRADE PRODUCT (PM) INTERVIEWS (ground every answer in this):
They test product JUDGMENT, not code: can the candidate scope an ambiguous prompt, pick a user and
their real pain, propose and prioritize solutions, define the right metrics, and reason about
trade-offs? Weak answers jump to features before naming the user, goal, or success metric.

WALK THE CANDIDATE THROUGH THE RIGHT FRAMEWORK:
Product sense / design / "improve X" / "design X for Y":
1) Clarify & scope: restate the goal; state assumptions (who is this for, platform, business goal,
   constraints); ask the clarifying questions a strong PM asks.
2) User segments & pain points: name 2–3 segments, pick ONE, and its jobs-to-be-done / pains (say why).
3) Goals & success metrics: the product goal + a North Star metric and 2–3 supporting/guardrail metrics.
4) Solutions: 2–3 concrete, differentiated ideas; then recommend one (impact vs effort / reach).
5) Prioritization & trade-offs: sequence with RICE / impact-effort; what you cut and why; key risks.
6) MVP, measurement & rollout: smallest testable version, the experiment/metric to validate, rollout plan.

Analytical / metrics / "diagnose the drop" / "which metric":
define the metric (formula + why) → break down (funnel/segments/dimensions) → ranked hypotheses
(internal vs external) → how to investigate each with data → decision + guardrails.

CORE CONCEPTS: users & JTBD, North Star + guardrail metrics, funnels & retention/engagement, A/B testing
and significance, prioritization frameworks (RICE, impact/effort, Kano), MVP & hypothesis-driven rollout,
trade-offs (growth vs trust, speed vs quality), and market/competitive framing.

STRONG-ANSWER CHECKLIST: clarifies before ideating · picks a specific user & pain · ties every idea to a
metric · prioritizes explicitly · names trade-offs and an MVP. Structured and speakable, never code.`,
  learnMore: [
    { label: "Exponent: Product Manager interview prep", url: "https://www.tryexponent.com/courses/pm" },
    { label: "SVPG (Marty Cagan): product essays", url: "https://www.svpg.com/articles/" },
    { label: "Lenny's Newsletter: PM interviews", url: "https://www.lennysnewsletter.com/" },
  ],
};

const CONSULTING_CASE: Playbook = {
  title: "Consulting case interview playbook",
  guidance: `HOW MBB AND THE BIG FOUR GRADE CASE INTERVIEWS (ground every answer in this):
They test structured problem solving, quantitative comfort, business judgment and
communication. Weak answers recite a memorized framework (never "let me use Porter's Five
Forces") instead of building a structure tailored to THIS client's problem, and never
commit to a recommendation.

WALK THE CANDIDATE THROUGH THE CASE ARC:
1) Repeat back & clarify: restate the client, the objective and the success metric in one
   sentence. Ask 2-3 clarifying questions (business model, geography, time horizon, what
   "success" means numerically). Then ask for a moment to structure.
2) Structure: a MECE tree, 2-4 branches, custom to the problem, stated out loud before
   analysing anything. Say which branch you'd start with and WHY (biggest expected impact).
3) Analyse branch by branch: ask for the data you need, do the arithmetic out loud, round
   aggressively, and after each number say "so what": the implication, not the figure.
4) Hypothesis: commit early and refine: "my hypothesis is the margin decline is
   cost-driven, specifically COGS per unit; let me test that."
5) Synthesise top-down: recommendation first, then the 2-3 reasons, then risks and next
   steps. Answer-first, as if the client CEO has 60 seconds.

THE CORE STRUCTURES (build, don't recite):
- Profitability: $\\text{Profit} = \\text{Revenue} - \\text{Cost}$; revenue = price x volume
  (segment it), cost = fixed + variable per unit. Isolate which term moved, then why.
- Market entry: market attractiveness (size, growth, margins) -> competition -> our
  right to win (capabilities, cost position) -> entry mode (build / buy / partner) -> financials.
- Market sizing: population -> segment -> penetration -> units per person per year -> price.
  Pick ONE driver per step so you never double-count frequency. State every assumption and
  sanity-check the total against something you know.
- M&A / growth: strategic rationale -> target attractiveness -> synergies (revenue vs cost,
  net of costs to achieve) -> valuation & price discipline -> integration risk.
- Pricing: cost-plus vs competitor benchmark vs value-based (willingness to pay); recommend
  value-based with a reference price.

CASE MATH: round to clean numbers, keep units visible, work in millions/billions
consistently, and state the answer with its unit ("about $40bn a year"). Always sanity-check.

PEI / FIT (McKinsey's Personal Experience Interview): one story, deep: personal impact,
entrepreneurial drive, courageous change, inclusive leadership. Same STAR discipline as a
behavioral answer but far more probing on YOUR specific actions, the resistance you faced
and the numbers.

STRONG-ANSWER CHECKLIST: clarifies the objective · structure stated before analysis and
genuinely MECE · arithmetic done out loud with a "so what" · hypothesis committed and
tested · recommendation first in the synthesis, with risks and next steps.`,
  learnMore: [
    { label: "McKinsey: how to prepare for case interviews", url: "https://www.mckinsey.com/careers/interviewing" },
    { label: "BCG: interview preparation", url: "https://careers.bcg.com/interview-prep" },
    { label: "Bain: the case interview", url: "https://www.bain.com/careers/hiring-process/interviewing/" },
    { label: "IGotAnOffer: case interview guide", url: "https://igotanoffer.com/blogs/mckinsey-case-interview-blog/consulting-case-interview" },
  ],
};

const FINANCE: Playbook = {
  title: "Finance & investment banking interview playbook",
  guidance: `HOW BANKS, PE FUNDS AND HEDGE FUNDS GRADE FINANCE INTERVIEWS (ground every
answer in this):
Technicals are pass/fail; they are testing whether you can be trusted with a model at 2am.
Answers must be precise, use the right vocabulary, and follow the standard mechanics in the
standard order. "It depends" without the deciding factor scores zero.

ANSWER SHAPE: state the mechanic in order, then the number, then the intuition ("so the
levered return is higher because..."). Short, confident, no rambling.

THE MECHANICS TO KNOW COLD:
- Three statements: income statement -> cash flow statement (start at net income, add back
  non-cash, working-capital changes, capex/financing) -> balance sheet. Net income flows to
  retained earnings; cash from the CFS is the balance-sheet cash line. Always be able to
  walk a change (e.g. depreciation +$10) through all three.
- DCF: project unlevered free cash flow ($\\text{EBIT} \\times (1-t) + \\text{D\\&A} -
  \\Delta\\text{NWC} - \\text{capex}$) -> discount at WACC -> terminal value (Gordon growth
  or exit multiple) -> enterprise value -> bridge to equity value (less net debt) -> per share.
- Valuation trio: DCF (intrinsic), comparable companies (current market view), precedent
  transactions (control premium, usually highest). Know why each is high or low.
- Multiples: use EV/EBITDA when capital structures differ, EV/EBIT when capex intensity
  differs, P/E only for like-for-like leverage and never with negative earnings.
- LBO: sources & uses -> operating case -> debt schedule and paydown -> exit at a multiple ->
  IRR and MOIC, then attribute returns to deleveraging, EBITDA growth and multiple expansion.
  Returns come from cash flow, not financial engineering alone.
- Accretion/dilution: pro forma EPS vs standalone; cash is cheapest, stock is dilutive when
  the acquirer's P/E is below the target's implied P/E.
- Stock pitch: recommendation -> business & how it makes money -> 2-3 differentiated reasons
  the market is wrong -> valuation and price target with the math -> risks and what would
  change your mind.

FIT / "WHY BANKING": a specific, true narrative; the moment you got interested, what you did
about it (a deal you followed, a model you built, a club or internship), and why this group at
this firm. Name a live transaction and have a view on it.

MENTAL MATH & BRAINTEASERS: think out loud, round, state assumptions, and give the answer
with units. For probability questions define the sample space explicitly before computing.

STRONG-ANSWER CHECKLIST: correct order of mechanics · correct vocabulary (unlevered vs
levered, EV vs equity value) · a number where a number is expected · the intuition in one
line · risks named without prompting.`,
  learnMore: [
    { label: "Mergers & Inquisitions: IB interview questions", url: "https://mergersandinquisitions.com/investment-banking-interview-questions/" },
    { label: "Wall Street Prep: LBO modeling test", url: "https://www.wallstreetprep.com/knowledge/lbo-model-test/" },
    { label: "Wall Street Oasis: technical interview guide", url: "https://www.wallstreetoasis.com/resources/interviews/investment-banking-interview-questions" },
  ],
};

const DATA_SCIENCE: Playbook = {
  title: "Data science interview playbook",
  guidance: `HOW TOP COMPANIES GRADE DATA SCIENCE INTERVIEWS (ground every answer in this):
DS loops blend (a) statistics & probability, (b) experimentation, (c) SQL / Python, (d) machine
learning, and (e) product & metrics sense. They want someone who reaches for the simplest
correct method, states assumptions, and connects the analysis to a decision.

STATISTICS & PROBABILITY: define the sample space or the estimator before computing. Name the
assumption (independence, normality, equal variance) and what breaks if it fails. Know
p-values (P(data this extreme | null true), never "probability the null is true"), confidence
intervals, CLT, type I/II error, power, Bayes' rule, and the common distributions and when
each applies.

EXPERIMENTATION / A/B TESTING (the highest-signal area):
1) Hypothesis & metric: one primary metric tied to the decision, plus guardrails.
2) Unit of randomisation & design: user vs session vs cluster; why.
3) Power & sample size: minimum detectable effect first, then duration.
4) Run & validate: sample ratio mismatch, randomisation check, no peeking.
5) Read the result: effect size and CI, not just significance; segment carefully and correct
   for multiple comparisons.
6) Threats: novelty and primacy effects, network interference, seasonality, Simpson's paradox.
7) Decision: ship / iterate / kill, and what you'd measure post-launch.

SQL: read the schema -> pick the grain -> join and filter -> aggregate or window -> check
NULLs, duplicates and ties. Prefer a CTE over nested subqueries; use RANK/ROW_NUMBER for
"top N per group" and say which you chose and why.

MACHINE LEARNING: frame the problem and the label -> baseline first -> features -> model
choice with a reason -> the metric that matches the cost of errors (precision/recall, AUC,
calibration, never plain accuracy on imbalanced data) -> validation split that respects time
and grouping -> overfitting controls (regularisation, early stopping) -> how it ships and how
you'd monitor drift. Explain the bias-variance trade-off with a concrete example.

PRODUCT & METRICS CASES ("a metric dropped 5%"): confirm the metric definition -> check
instrumentation first (logging, bots, release) -> slice by segment, platform, geography,
cohort and time -> ranked hypotheses, internal vs external -> the query or test that
distinguishes them -> decision and guardrail.

STRONG-ANSWER CHECKLIST: states assumptions · picks the simplest method that works · gives
the actual number or query · says how the result changes the decision · names the threat to
validity before being asked.`,
  learnMore: [
    { label: "Trustworthy Online Controlled Experiments (Kohavi et al.)", url: "https://experimentguide.com/" },
    { label: "Ace the Data Science Interview: SQL & stats practice", url: "https://datalemur.com/questions" },
    { label: "Google: experiment design & statistics refresher", url: "https://developers.google.com/machine-learning/crash-course" },
  ],
};

const GENERAL: Playbook = {
  title: "Interview playbook",
  guidance: `Coach the candidate with structure: clarify the question, think out loud, give a
well-organized answer with concrete specifics and trade-offs, and end with a crisp summary.
Prefer correctness and clear communication over jargon.`,
  learnMore: [],
};

export const PLAYBOOKS: Record<ReferenceCategory, Playbook> = {
  system_design: SYSTEM_DESIGN,
  coding: CODING,
  behavioral: BEHAVIORAL,
  technical: TECHNICAL,
  engineering_manager: ENGINEERING_MANAGER,
  product: PRODUCT,
  consulting_case: CONSULTING_CASE,
  finance: FINANCE,
  data_science: DATA_SCIENCE,
  general: GENERAL,
};

/**
 * Role-driven lenses layered on top of the category playbook.
 *
 * The bank's five DB categories can't express a track: a consulting profitability
 * case and a PM "improve X" question are both `product`, and a DCF walkthrough and
 * a TCP question are both `technical`. The role the question was filed under is
 * what disambiguates them, so it selects an extra playbook to blend in.
 *
 * Order matters — first match wins, and the EM lens stays first so existing
 * engineering-manager behaviour is unchanged.
 */
const ROLE_LENSES: {
  test: RegExp;
  lens: ReferenceCategory;
  label: string;
}[] = [
  {
    test: /\b(engineering manager|eng manager|\bem\b|manager|director|head of|vp)\b/i,
    lens: "engineering_manager",
    label: "EM",
  },
  {
    test: /\b(consultant|consulting|strategy analyst)\b/i,
    lens: "consulting_case",
    label: "consulting",
  },
  {
    test: /\b(investment bank\w*|banking analyst|ib analyst|equity research|private equity|financial analyst|finance|trader)\b/i,
    lens: "finance",
    label: "finance",
  },
  {
    test: /\b(data scientist|data analyst|product analyst|analytics)\b/i,
    lens: "data_science",
    label: "data science",
  },
];

/**
 * Pick the right playbook. When the role carries its own lens (engineering
 * manager, consulting, finance, data science) we blend that lens on top of the
 * category-specific playbook.
 */
export function resolvePlaybook(
  category: ReferenceCategory,
  roleLevel?: string | null
): Playbook {
  // Resolve each playbook's guidance through the prompt store (admin-editable),
  // falling back to the code default.
  const guidanceFor = (cat: ReferenceCategory, base: Playbook) =>
    px(`playbook.${cat}`, base.guidance);
  const base = PLAYBOOKS[category] ?? GENERAL;
  const hit = ROLE_LENSES.find((l) => l.test.test(roleLevel || ""));
  if (hit && hit.lens !== category) {
    const lens = PLAYBOOKS[hit.lens];
    return {
      title: `${base.title} (${hit.label} lens)`,
      guidance: `${guidanceFor(category, base)}\n\n${guidanceFor(
        hit.lens,
        lens
      )}`,
      learnMore: [...base.learnMore, ...lens.learnMore],
    };
  }
  return { ...base, guidance: guidanceFor(category, base) };
}
