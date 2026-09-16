/**
 * Full interview LOOPS — the whole hiring process, not one practice session.
 *
 * A single practice session answers "can I handle a system design question?".
 * A loop answers the question candidates actually care about: "would this
 * company hire me?" So a loop is an ordered list of STAGES (recruiter screen →
 * technical screen → coding → system design → behavioral → values → hiring
 * manager), each with its own clock, its own curated questions, its own grade,
 * and at the end a single hire / no-hire debrief across all of them.
 *
 * WHY THE SHAPES BELOW: the stage lists mirror how large-company loops are
 * actually run — a recruiter/HM screen, 1-2 coding rounds and a design round for
 * engineers (design only from mid-level up), a project retrospective plus a
 * people-management round for managers, product-sense + execution/analytical +
 * strategy for PMs, SQL + statistics + experimentation for data roles (with
 * experimentation carrying the most weight), a technical/valuation round plus a
 * modelling case for finance, and a values round that every big company has
 * under some name ("Googleyness", Amazon's Bar Raiser, Meta's "Jedi"). Startups
 * get their own engineering loop because they really do interview differently:
 * pairing and a practical build instead of algorithm rounds. Each blueprint records
 * what it's modeled on in `modeledOn` so the UI can be honest that this is a
 * representative loop, not a leak of any company's real process.
 *
 * Three deliberate constraints, because they're what makes this feel real:
 *   1. `minutes` is a WALL CLOCK. Once a stage starts it runs down whether the
 *      app is open or not (see `loop-runs.ts`). There is no pause — you either
 *      finish inside the slot or you cancel, exactly like a real interview.
 *   2. `seedQuestions` are the offline floor. The question bank is
 *      authenticated-only and thin for some roles, so every stage ships with
 *      real questions of its own; `loop-curate.ts` prefers bank questions and
 *      falls back here, so a stage is never empty.
 *   3. Nothing here talks to a model. Blueprints are data, so the stage list is
 *      inspectable, testable, and identical for every user.
 */

import type {
  InterviewAnswerMode,
  InterviewCategoryId,
  InterviewDifficulty,
} from "./templates";
import type { QuestionCategory } from "./question-bank";
import type { CodingLanguage } from "./coding-runtime";
// The SQL round's questions have to match the tables the workbench actually
// loads, so the schema comes from one place.
import { SQL_SCHEMA_SUMMARY } from "./sql-fixtures";

/**
 * The kind of round. Drives the icon, the playbook lens, and which bank
 * categories the stage pulls from — NOT the wording the candidate sees (that's
 * `LoopStage.title`, which is role-specific: an EM's "technical" round is a
 * planning conversation, an SWE's is fundamentals).
 */
export type LoopStageKind =
  | "recruiter_screen"
  | "technical_screen"
  | "coding"
  | "system_design"
  | "behavioral"
  | "values_growth"
  | "hiring_manager"
  | "people_management"
  | "project_deep_dive"
  | "product_sense"
  | "analytical"
  | "strategy"
  | "case_study"
  | "modeling"
  | "exec_panel"
  // Data & analytics rounds.
  | "sql_data"
  | "statistics"
  | "experimentation"
  | "ml_fundamentals"
  | "ml_design"
  | "data_modeling"
  // Rounds that show up across every family and were missing from the first cut.
  | "take_home"
  | "presentation"
  | "code_review"
  | "pair_programming"
  | "team_matching";

/** Short label per stage kind, for chips and the stage list. */
export const LOOP_STAGE_KIND_LABELS: Record<LoopStageKind, string> = {
  recruiter_screen: "Screen",
  technical_screen: "Technical",
  coding: "Coding",
  system_design: "System design",
  behavioral: "Behavioral",
  values_growth: "Values & growth",
  hiring_manager: "Hiring manager",
  people_management: "People management",
  project_deep_dive: "Project deep dive",
  product_sense: "Product sense",
  analytical: "Analytical",
  strategy: "Strategy",
  case_study: "Case study",
  modeling: "Modeling case",
  exec_panel: "Executive panel",
  sql_data: "SQL & data",
  statistics: "Statistics",
  experimentation: "Experimentation",
  ml_fundamentals: "ML fundamentals",
  ml_design: "ML system design",
  data_modeling: "Data modeling",
  take_home: "Take-home",
  presentation: "Presentation",
  code_review: "Code review",
  pair_programming: "Pair programming",
  team_matching: "Team matching",
};

export interface LoopStage {
  /** Stable within a blueprint — persisted in saved runs, so never renumber. */
  id: string;
  kind: LoopStageKind;
  /** Role-specific round name shown to the candidate. */
  title: string;
  /** One line: what this interviewer is scoring. */
  signal: string;
  /** Wall-clock length of the slot. Real loops use 30 / 45 / 60. */
  minutes: number;
  /** How many questions to curate. Coding/design rounds get very few, on purpose. */
  questionCount: number;
  difficulty: InterviewDifficulty;
  /** Which workbench the candidate answers in. */
  answerMode: InterviewAnswerMode;
  /**
   * For a coding round, the editor it must open in. Set it when the round has a
   * language by definition — a SQL round is SQL whatever the question text looks
   * like. It also filters the bank: a round that declares a language only
   * accepts real questions that belong in that editor, so a linked-list problem
   * can't be filed into the SQL round. Unset = infer per question.
   */
  codingLanguage?: CodingLanguage;
  /** Bank categories this round draws real reported questions from. */
  bankCategories: QuestionCategory[];
  /** Feeds `template.focusAreas` → selects the playbook + role lens. */
  focusAreas: string[];
  /** Interviewer persona + what to probe. Feeds `template.notes`. */
  interviewerNotes: string;
  /** Offline question pool. Used when the bank has nothing for this round. */
  seedQuestions: string[];
}

export type LoopFamily =
  | "engineering"
  | "data"
  | "product"
  | "finance"
  | "leadership";

export const LOOP_FAMILY_LABELS: Record<LoopFamily, string> = {
  engineering: "Engineering",
  data: "Data & analytics",
  product: "Product management",
  finance: "Finance",
  leadership: "Leadership & executive",
};

export interface LoopBlueprint {
  id: string;
  /** Role name as a candidate would see it on a job posting. */
  title: string;
  family: LoopFamily;
  /** Seniority band, e.g. "New grad / Junior", "Senior", "Executive". */
  level: string;
  /** Filter category, shared with the rest of Interview Practice. */
  category: InterviewCategoryId;
  /** Drives the playbook role lens (see `playbooks.ts` ROLE_LENSES). */
  roleLevel: string;
  /** What the whole loop is testing, in one or two sentences. */
  summary: string;
  /** Honest provenance of the stage list. Rendered in the UI. */
  modeledOn: string;
  stages: LoopStage[];
}

// ── Shared question pools ────────────────────────────────────────────────────
// Kept as named constants rather than inlined so the same round can be reused
// across levels with a different difficulty and count.

const RECRUITER_SEEDS_ENG = [
  "Walk me through your background. What have you been working on most recently?",
  "Why this role, and why now?",
  "Tell me about the project you're proudest of and what your specific contribution was.",
  "What are you looking for in your next team, and what would make you turn an offer down?",
  "What's your timeline, and are you interviewing anywhere else?",
];

const TECH_SCREEN_SEEDS_SWE = [
  "How would you debug a service whose p99 latency tripled after a deploy, with no change in error rate?",
  "Walk me through what happens, step by step, when a browser makes a request to your API.",
  "When would you add an index versus denormalize a table? What does each cost you?",
  "Explain the difference between a process and a thread, and when you'd reach for each.",
  "How do you decide what to unit test versus what to cover with an integration test?",
];

const CODING_SEEDS_JUNIOR = [
  "Given an array of integers and a target, return the indices of the two numbers that add to the target. Talk through your approach before you write code.",
  "Reverse a linked list iteratively, then tell me what changes if it has to be recursive.",
  "Find the length of the longest substring without repeating characters.",
  "Given a binary tree, return its level-order traversal as a list of levels.",
  "Given a string, determine whether its brackets are balanced.",
];

const CODING_SEEDS_SENIOR = [
  "Design and implement an LRU cache with O(1) get and put. State your invariants as you go.",
  "Merge k sorted lists efficiently and give me the time and space complexity of your approach.",
  "Implement a rate limiter that allows N events per rolling minute per key, and tell me how it behaves under a burst.",
  "Find the minimum window in a string that contains every character of another string.",
  "You have a stream of numbers and need the median at any point. How do you do it, and what does it cost?",
];

const SYSTEM_DESIGN_SEEDS_MID = [
  "Design a URL shortener. Cover the API, the data model, and how you generate keys.",
  "Design a rate limiter that works across many application servers.",
  "Design an image upload and thumbnail service for a mobile app.",
  "Design a paginated activity feed for a single user's own actions.",
];

const SYSTEM_DESIGN_SEEDS_SENIOR = [
  "Design a news feed for 200M daily users. Be explicit about fan-out on write versus read.",
  "Design a distributed job scheduler with at-least-once execution and no duplicate side effects.",
  "Design the notification system for a chat product (push, email, and in-app) and state your delivery guarantees.",
  "Design a metrics pipeline ingesting 5M events per second, with 13-month retention and sub-second dashboards.",
  "Design a multi-region datastore for user profiles. Pick your consistency model and defend it.",
];

const BEHAVIORAL_SEEDS_IC = [
  "Tell me about a time you disagreed with a technical decision. What did you do?",
  "Describe a project that slipped. What did you own, and what did you change?",
  "Tell me about the hardest bug you've tracked down. How did you find it?",
  "Tell me about a time you had to influence someone without any authority over them.",
  "Describe a time you had to ship something you weren't happy with. How did you decide?",
];

const VALUES_GROWTH_SEEDS = [
  "What's the most useful piece of feedback you've received, and what did you actually change?",
  "How do you decide what to learn next, and how do you learn it?",
  "Tell me about a time you made a teammate better.",
  "Describe a situation where you had almost no direction. How did you make progress?",
  "Tell me about a time you were wrong in front of other people. How did you handle it?",
  "What does a bad day on a team look like to you, and what do you do about it?",
];

const HIRING_MANAGER_SEEDS_ENG = [
  "What do you want your next 18 months to look like, concretely?",
  "How do you like to be managed? Tell me about a manager who got your best work.",
  "Based on what you know about this team so far, where would you expect the risk to be?",
  "What's the most useful thing your current manager does for you, and the least?",
  "What questions do you have for me about the team, the roadmap, or how we work?",
];

const PEOPLE_MANAGEMENT_SEEDS = [
  "Walk me through how you handled an underperformer, from the first signal to the outcome.",
  "How do you run calibration, and how do you tell someone strong that they're not getting promoted?",
  "One of your best engineers says they're bored and hinting they'll leave. What do you do this week?",
  "How do you set goals for a team of eight spread across two products?",
  "You've inherited a team that missed its last three commitments. What are your first 30 days?",
  "How do you decide when to hire versus when to grow someone into the role?",
];

const PROJECT_DEEP_DIVE_SEEDS = [
  "Take me through the most complex project you've delivered end to end: scope, team, timeline, and what went wrong.",
  "What did you cut to hit the date, and who did you have to convince?",
  "How did you know afterwards whether it actually worked?",
  "What would you do differently with the same constraints?",
  "Where did you personally add the most value on that project, and where did you get in the way?",
];

const EM_TECHNICAL_SEEDS = [
  "Your team owns a service at 99.9% and the business now wants 99.99%. How do you plan that work?",
  "How do you stay technical enough to make good calls without taking work off your engineers?",
  "Your team wants a rewrite. How do you evaluate that, and how do you say no if you have to?",
  "How do you decide what technical debt to pay down in a quarter with a hard roadmap?",
  "Walk me through how you'd run an incident review that people actually learn from.",
];

const PRODUCT_SENSE_SEEDS = [
  "Pick a product you use every day and tell me how you'd improve it. Start with who you're solving for.",
  "Design a product to help people who've just moved to a new city make friends.",
  "Retention drops off after week two on a note-taking app. What would you build, and why that?",
  "How would you redesign the onboarding for a tool that takes 40 minutes to show value?",
  "Our power users love a feature that confuses everyone else. What do you do with it?",
];

const ANALYTICAL_SEEDS = [
  "Daily active users are flat but revenue is up 12%. What do you look at, and what could explain it?",
  "Checkout conversion dropped 8% week over week. Walk me through your first 48 hours.",
  "How would you set the success metrics for a feature that lets users share a document publicly?",
  "You have one engineer for six weeks. How do you decide what to build?",
  "Estimate how many food-delivery orders happen on a Friday night in a city of two million.",
];

const PM_STRATEGY_SEEDS = [
  "Build, buy, or partner for payments. Walk me through how you'd decide.",
  "What's the biggest threat to this product in three years, and what would you do about it now?",
  "How would you enter a market where the incumbent has 80% share?",
  "Our biggest customer wants a feature that's wrong for everyone else. How do you handle it?",
  "How would you decide to sunset a product that still makes money?",
];

const PM_BEHAVIORAL_SEEDS = [
  "Tell me about a time you shipped something that failed. What did you learn?",
  "Describe a time engineering and design disagreed and you had to break the tie.",
  "Tell me about a time you changed your mind because of data.",
  "How have you handled a stakeholder who kept moving the goalposts?",
  "Tell me about the hardest thing you've had to say no to.",
];

const FINANCE_TECHNICAL_SEEDS = [
  "Walk me through a DCF.",
  "What are the three financial statements, and how do they connect?",
  "EBITDA versus operating cash flow: when do they diverge, and why does that matter?",
  "A company has positive net income and negative cash flow. Give me three explanations.",
  "How would you value a company with no earnings?",
  "Walk me through what happens on the cash flow statement when working capital increases.",
];

const FINANCE_MODELING_SEEDS = [
  "Talk me through how you'd structure a three-statement model for a SaaS business, and what drives the cash balance.",
  "You're given a revenue build with 20% gross churn and 15% new-logo growth. Walk me through the model and the checks you'd run.",
  "How would you forecast next year's headcount cost, and what breaks first if hiring slips a quarter?",
  "Walk me through a budget-versus-actual variance you'd take to the CFO. What do you show, in what order?",
  "How would you build a model to decide whether to lease or buy a facility?",
];

const FINANCE_BUSINESS_PARTNER_SEEDS = [
  "Tell me about a time your forecast was wrong. What did you do about it?",
  "How do you say no to a business partner who wants budget you don't have?",
  "Describe how you've made a non-finance team care about a number.",
  "Tell me about a time you found an error late in a process. What happened?",
  "How do you handle a month-end close when a key number arrives on the last day?",
];

const EXEC_PANEL_SEEDS_FINANCE = [
  "How would you build the finance function for a company going from 200 to 1,000 people?",
  "Walk me through how you'd run an IPO-readiness review.",
  "The board wants 30% growth and breakeven in the same year. How do you respond?",
  "What three metrics would you put on the CEO's dashboard, and why those?",
  "Tell me about a time you had to deliver bad news to a board.",
  "How do you decide when to raise versus when to cut?",
];

// The capital & strategy round, kept separate from the board panel above for the
// same reason as `ENG_STRATEGY_SEEDS`: two rounds in one loop can't share a pool.
// This one is the allocation decision itself, in numbers.
const FINANCE_STRATEGY_SEEDS = [
  "Walk me through a capital allocation decision you made, with the actual numbers.",
  "We have eighteen months of runway. What do you cut first, and what would you never cut?",
  "How do you think about payback period when sales and marketing want to spend more?",
  "Talk me through the unit economics of a business like ours and which line worries you.",
  "How would you decide between raising at a flat valuation and cutting to profitability?",
  "What would make you tell the CEO that a plan they've already announced doesn't work?",
];

const EXEC_PANEL_SEEDS_ENG = [
  "How do you decide what your engineering organisation should look like in 18 months?",
  "Walk me through a technology bet you made that didn't pay off.",
  "How do you set and then defend an engineering budget?",
  "A VP of Product keeps going around you to your engineers. How do you handle it?",
  "What's your approach to build versus buy at our stage?",
  "How do you measure engineering productivity without the measure being gamed?",
];

// The technology-strategy round sits in the same loops as the board panel above,
// and a round has to have questions of its own: anything asked in an earlier
// round is off the table for the rest of the loop, so a shared pool leaves the
// second round unable to fill. This one is the architecture conversation —
// platform, migrations, debt, security, cost — where the panel is the money one.
const ENG_STRATEGY_SEEDS = [
  "Take our architecture as you understand it. What would you change first, and what breaks if you're wrong?",
  "How do you sequence a platform migration alongside a roadmap the business has already committed to?",
  "How much of your engineering capacity goes to technical debt, and how do you defend that number?",
  "Walk me through how you'd decide to consolidate onto one language or framework, or not to.",
  "Where does security sit in your engineering process, and what have you personally caught?",
  "Our infrastructure bill is growing faster than revenue. Where do you start?",
  "How do you tell the difference between an architecture that's wrong and one that's just unfamiliar?",
];

// —— Data & analytics pools ——
// Grounded in the data-science playbook (`playbooks.ts` DATA_SCIENCE): stats &
// probability, experimentation, SQL/Python, ML, and product/metrics sense.

const RECRUITER_SEEDS_DATA = [
  "Walk me through your background. What kinds of data problems have you owned end to end?",
  "Which parts of the stack do you actually work in: SQL, Python, notebooks, dbt, a warehouse?",
  "Tell me about an analysis that changed a decision. What was the decision?",
  "How much of your work has been experimentation versus modelling versus reporting?",
  "What are you looking for in your next team, and what would make you turn an offer down?",
];

const SQL_SEEDS = [
  "You have `orders(id, user_id, created_at, amount, status)`. Write the query for daily revenue over the last 30 days, excluding cancelled orders, with no gaps for days that had none.",
  "Given `events(event_id, user_id, event_name, ts, ingested_at)`, write a query for 7-day retention by signup cohort.",
  "From `orders`, return the top 3 customers by revenue per country. Say whether you used RANK or ROW_NUMBER and why.",
  "Given `sessions(user_id, started_at, ended_at)`, find users with two sessions that overlap.",
  "You join two tables and the row count goes up. Walk me through how you'd find out why, then write the fixed query.",
  "Write a query for the running 28-day active user count, and tell me what it costs on a billion-row table.",
];

const SQL_SEEDS_SENIOR = [
  "Given `subscriptions(user_id, plan, started_at, ended_at)`, write a query for month-over-month net revenue retention, and define every term you use.",
  "Compute the median order value per `users.segment` in SQL, then tell me why the average would have misled us here.",
  "The events table has duplicates from an at-least-once pipeline. Write the query that deduplicates correctly and explain your key.",
  "Write the funnel query for signup → activation → first purchase, attributing each step to the same user within 7 days.",
  "A dashboard query takes 90 seconds. Walk me through how you'd diagnose it, then what you'd change in the query and in the model.",
];

const STATISTICS_SEEDS = [
  "What exactly does a p-value of 0.03 mean? Now tell me what it does not mean.",
  "Explain a confidence interval to a product manager who thinks it's 'the range the true value is 95% likely to be in'.",
  "We ran 20 metric comparisons and one came back significant at 0.05. What do you conclude?",
  "When does the central limit theorem save you, and when does it not?",
  "Explain type I and type II error using a decision this company might actually make.",
  "You have a heavily skewed revenue-per-user distribution. Which test do you reach for, and why?",
  "A coin comes up heads 8 times in 10. Is it biased? Show me how you'd decide.",
];

const EXPERIMENTATION_SEEDS = [
  "Design an A/B test for a new onboarding flow. Take me from the hypothesis through to the ship decision.",
  "How would you pick the primary metric and the guardrails for a test on the checkout page?",
  "How do you size an experiment? Walk me through minimum detectable effect and duration with real numbers.",
  "Your test hits significance on day two. Do you ship? Why or why not?",
  "The treatment wins on the primary metric but a guardrail drops 1%. What do you do?",
  "You see a sample ratio mismatch of 51/49. How worried are you and what do you check?",
  "How would you test a feature where users influence each other: a referral or a marketplace change?",
  "You can't randomise: the change ships to a whole country at once. How do you measure it?",
];

const ML_FUNDAMENTALS_SEEDS = [
  "You're asked to predict churn. Define the label, the prediction window, and the baseline before any model.",
  "Which metric do you optimise for a fraud model where a false positive blocks a real customer? Defend it.",
  "Explain the bias-variance trade-off using a model you've actually trained.",
  "Your model scores 0.98 AUC offline and does nothing in production. Give me your list of causes, ranked.",
  "How do you split data when the rows are correlated in time and by user?",
  "Explain regularisation to an engineer, then tell me how you'd choose the strength.",
  "When would you use gradient boosting over a neural network, and when neither?",
  "How would you detect and handle label leakage?",
];

const ML_DESIGN_SEEDS = [
  "Design the recommendation system for a video app: candidate generation, ranking, features, training, and serving.",
  "Design a fraud-detection system that scores a transaction in under 100ms and retrains daily.",
  "Design the ML system behind search ranking, and be explicit about how you'd evaluate it online and offline.",
  "Design a forecasting service that produces daily demand predictions per city, including backfills and monitoring.",
  "Design an end-to-end pipeline for a churn model: features, training cadence, serving, drift detection, and rollback.",
];

const DS_PRODUCT_CASE_SEEDS = [
  "Daily active users dropped 5% week over week. Walk me through your first 48 hours.",
  "How would you measure whether a new feature was a success? Give me the primary metric and the counter-metric.",
  "Leadership wants one number for 'product health'. What do you give them, and what does it hide?",
  "Engagement is up but revenue is flat. What are your hypotheses, and which query settles it first?",
  "How would you decide whether to invest in retention or acquisition next quarter, using data we already have?",
  "A metric looks great in aggregate and worse in every segment. What's going on, and what do you report?",
];

const DS_BEHAVIORAL_SEEDS = [
  "Tell me about an analysis whose conclusion nobody wanted to hear. What happened?",
  "Describe a time you found an error in your own numbers after you'd shared them.",
  "Tell me about a time a stakeholder asked for a number to support a decision they'd already made.",
  "Describe the most technically wrong thing you've had to talk someone out of.",
  "Tell me about a model or dashboard you built that nobody used. Why not?",
  "How have you handled a request where the data genuinely couldn't answer the question?",
];

const DATA_MODELING_SEEDS = [
  "Design the warehouse model for a subscription business: facts, dimensions, grain, and how you'd handle a plan change.",
  "How would you model slowly changing dimensions for a customer whose account owner and country both change over time?",
  "Design the event schema for a product analytics pipeline. What's your naming contract, and how do you version it?",
  "We have one wide table everyone queries and nobody trusts. Walk me through how you'd break it up.",
  "How do you decide what belongs in a staging model versus a mart, and who owns each?",
];

const PIPELINE_DESIGN_SEEDS = [
  "Design a pipeline ingesting 50M events a day into a warehouse with hourly freshness and exactly-once semantics at the mart layer.",
  "Design a CDC pipeline from a production Postgres to the warehouse without hurting the production database.",
  "Your nightly job failed at 3am and downstream dashboards are stale. Design the system so this fails safely and is reprocessable.",
  "Design the batch and streaming paths for the same metric and explain how you'd keep them reconciled.",
  "How would you build data-quality checks that block a bad load instead of shipping bad numbers?",
];

const DS_MANAGER_SEEDS = [
  "How do you decide what your data team should work on when every team wants a dashboard?",
  "Half your team's time goes to ad-hoc requests. What do you change, and how do you sell that to stakeholders?",
  "How do you grow an analyst who's technically strong but nobody acts on their work?",
  "How do you evaluate whether your data team is having impact, without counting tickets?",
  "Walk me through how you'd handle two teams reporting the same metric with different numbers.",
  "When would you centralise data scientists versus embed them in product teams?",
];

// The data-strategy round shares a loop with the people-management round above,
// so it needs its own questions (see `ENG_STRATEGY_SEEDS`). People management is
// about the team; this is about the numbers the company runs on.
const DS_STRATEGY_SEEDS = [
  "Nobody trusts the numbers in this company. Where do you start, and what does month three look like?",
  "What would you invest your team's time in that nobody is currently asking for?",
  "A VP wants a dashboard by Friday and it's the third one this month. Talk me through the conversation.",
  "How do you decide which metrics are worth defining company-wide, and who owns them?",
  "An experiment says ship and your instinct says don't. What do you do?",
  "How would you know within a quarter whether your data strategy is working?",
];

// —— Cross-family rounds ——
// Common rounds the first cut of this file didn't model: async assignments,
// presenting your own work, reviewing someone else's code, building alongside an
// interviewer, and the team-matching conversation that decides where you land.

const TAKE_HOME_SEEDS_SWE = [
  "Build a small command-line tool that reads a CSV of transactions and reports the top spender per month. Talk me through your structure as you go.",
  "Implement a paginated in-memory API for a list of items, with tests for the edge cases you consider important.",
  "Here's a failing test suite for a date-range utility. Make it pass, and tell me which behaviours you chose to define.",
  "Write a small rate limiter with tests, then tell me what you'd change to make it production-ready.",
];

const TAKE_HOME_SEEDS_DATA = [
  "You've been given a raw events file with duplicates, nulls, and mixed time zones. Walk me through your cleaning steps, then the three findings you'd present.",
  "Build the analysis that answers 'did the pricing change work?' from an orders table. State every assumption you make.",
  "Here's a dataset with a churn label. Take me through your baseline, your features, and the metric you'd report to a product manager.",
  "Produce the query and the chart you'd put in front of leadership for weekly active users, and defend the definition you chose.",
];

const TAKE_HOME_SEEDS_PM = [
  "Write the one-page product brief for a feature that improves week-two retention: problem, user, hypothesis, scope, and success metric.",
  "Draft the launch plan for a feature that only 5% of users will ever need but that closes enterprise deals.",
  "Write the PRD summary for a change you'd make to onboarding, including what you're explicitly not doing.",
  "Given three competing requests and one engineering team for six weeks, write your prioritisation and the reasoning.",
];

const PRESENTATION_SEEDS = [
  "Present a project you led, in ten minutes, to people who don't know the domain. Start with the decision it changed.",
  "What was the hardest trade-off in that work, and who disagreed with you about it?",
  "Which number in your results are you least confident about, and why?",
  "If you had another month, what would you have done differently?",
  "Tell me what you'd say to a skeptical executive who thinks this project wasn't worth the investment.",
];

const CODE_REVIEW_SEEDS = [
  "Here's a pull request that adds a caching layer to a user endpoint. Walk me through your review. What blocks the merge, and what's just a comment?",
  "This function passes its tests but has a race condition. Find it, then tell me how you'd prove it exists.",
  "A colleague's change silently swallows an exception in a payment path. How do you raise that, and what do you propose instead?",
  "Review this schema migration for a table with 200M rows. What would you say before it ships?",
  "You're handed a 900-line file to change. How do you decide what to refactor now versus leave alone?",
];

const PAIR_PROGRAMMING_SEEDS = [
  "We're going to build a small feature together: an endpoint that returns a user's recent orders with pagination. Drive, and tell me what you're doing.",
  "Let's extend what we just built to filter by status. Where does that change belong, and what test do you write first?",
  "Something's broken in the code we just wrote. Debug it out loud. I'll answer questions as your teammate.",
  "Take this working-but-ugly function and improve it while I watch. Explain each change before you make it.",
];

const TEAM_MATCHING_SEEDS = [
  "Which of our teams sounds like the best fit for you, based on what you know, and why that one?",
  "What kind of work makes you want to come back the next day, and what drains you?",
  "How much ambiguity do you actually want? Tell me about a time there was too much.",
  "What would make you leave a team after six months?",
  "What do you want to be trusted with in a year that you're not trusted with today?",
];

const LEADERSHIP_BEHAVIORAL_SEEDS = [
  "Tell me about the hardest people decision you've made.",
  "Describe a time you inherited a mess. What did you do first?",
  "Tell me about a peer relationship you had to repair.",
  "When have you changed a strategy you'd publicly committed to?",
  "Tell me about a time you had to cut a team or a project.",
];

// ── Stage factories ─────────────────────────────────────────────────────────
// Every stage is built through one of these so a round of the same kind is
// consistent across roles and levels, and so adding a blueprint is a few lines
// rather than a wall of literals.

type StageOverrides = Partial<Omit<LoopStage, "id" | "kind">>;

function stage(base: LoopStage, over?: StageOverrides): LoopStage {
  return { ...base, ...over };
}

const recruiterScreen = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "recruiter_screen",
      kind: "recruiter_screen",
      title: "Recruiter phone screen",
      signal: "Motivation, story, and whether the basics line up",
      minutes: 30,
      questionCount: 4,
      difficulty: "easy",
      answerMode: "spoken",
      bankCategories: ["behavioral"],
      focusAreas: ["motivation", "background", "communication"],
      interviewerNotes:
        "You are a recruiter, not an engineer. Keep it warm and fast. Check the story hangs together, the motivation is real, and the level looks right. Do not go deep technically. If the candidate dives into detail, pull them back up to the summary.",
      seedQuestions: RECRUITER_SEEDS_ENG,
    },
    over
  );

const technicalScreen = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "technical_screen",
      kind: "technical_screen",
      title: "Technical screen",
      signal: "Fundamentals and how the candidate reasons out loud",
      minutes: 45,
      questionCount: 4,
      difficulty: "medium",
      answerMode: "spoken",
      bankCategories: ["technical"],
      focusAreas: ["fundamentals", "debugging", "technical communication"],
      interviewerNotes:
        "Probe fundamentals with follow-ups rather than trivia. Ask 'why' twice on every answer. Reward a candidate who states assumptions and admits the edge of their knowledge; push back once on anything hand-waved.",
      seedQuestions: TECH_SCREEN_SEEDS_SWE,
    },
    over
  );

const codingRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "coding",
      kind: "coding",
      title: "Coding & algorithms",
      signal: "Working code, complexity awareness, and testing instinct",
      minutes: 45,
      questionCount: 2,
      difficulty: "medium",
      answerMode: "coding",
      bankCategories: ["coding"],
      focusAreas: ["coding", "algorithms", "data structures", "problem solving"],
      interviewerNotes:
        "One problem at a time. Expect the candidate to clarify the problem, state an approach and its complexity BEFORE coding, then test with a real example. Give a hint only after they're genuinely stuck, and say what the hint cost them.",
      seedQuestions: CODING_SEEDS_JUNIOR,
    },
    over
  );

const systemDesignRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "system_design",
      kind: "system_design",
      title: "System design",
      signal: "Scoping, architecture, data model, and honest trade-offs",
      minutes: 60,
      questionCount: 1,
      difficulty: "hard",
      answerMode: "system_design",
      bankCategories: ["system_design"],
      focusAreas: ["system design", "scalability", "architecture", "trade-offs"],
      interviewerNotes:
        "Make them scope before they draw. Requirements and estimates first, then a high-level design, then the data model and API, then one deep dive on the hard part. Ask for the trade-off they rejected and why. Buzzwords without a reason score zero.",
      seedQuestions: SYSTEM_DESIGN_SEEDS_MID,
    },
    over
  );

const behavioralRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "behavioral",
      kind: "behavioral",
      title: "Behavioral",
      signal: "Ownership, collaboration, and whether the stories are specific",
      minutes: 45,
      questionCount: 4,
      difficulty: "medium",
      answerMode: "spoken",
      bankCategories: ["behavioral"],
      focusAreas: ["collaboration", "ownership", "conflict", "impact"],
      interviewerNotes:
        "Insist on one real situation per question, in STAR shape, with the candidate's own actions and a measurable result. When you hear 'we', ask what THEY did. Follow up on anything vague with 'what specifically?'.",
      seedQuestions: BEHAVIORAL_SEEDS_IC,
    },
    over
  );

const valuesGrowthRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "values_growth",
      kind: "values_growth",
      title: "Values & growth",
      signal: "Self-awareness, coachability, and how they raise the people around them",
      minutes: 30,
      questionCount: 4,
      difficulty: "medium",
      answerMode: "spoken",
      bankCategories: ["behavioral"],
      focusAreas: [
        "self-awareness",
        "feedback",
        "learning",
        "collaboration",
        "values",
      ],
      interviewerNotes:
        "This is the round big companies run as 'Googleyness' or a Bar Raiser: how the candidate handles feedback, ambiguity, and being wrong, and whether they develop the people around them. Reward specific, unflattering honesty over polish. A candidate who cannot name a real weakness has not passed this round.",
      seedQuestions: VALUES_GROWTH_SEEDS,
    },
    over
  );

const hiringManagerRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "hiring_manager",
      kind: "hiring_manager",
      title: "Hiring manager",
      signal: "Fit for THIS team, expectations, and what they'd need from you",
      minutes: 45,
      questionCount: 4,
      difficulty: "medium",
      answerMode: "spoken",
      bankCategories: ["behavioral"],
      focusAreas: ["role fit", "expectations", "working style", "motivation"],
      interviewerNotes:
        "You are the manager who will own this hire. Be direct. Test whether what they want matches what the job actually is, and whether they've thought about the team rather than just the title. Leave time for their questions, and judge the quality of those questions.",
      seedQuestions: HIRING_MANAGER_SEEDS_ENG,
    },
    over
  );

const peopleManagementRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "people_management",
      kind: "people_management",
      title: "People management",
      signal: "Performance, growth, and hard conversations actually held",
      minutes: 45,
      questionCount: 4,
      difficulty: "hard",
      answerMode: "spoken",
      bankCategories: ["behavioral"],
      focusAreas: [
        "people management",
        "performance management",
        "coaching",
        "hiring",
        "retention",
      ],
      interviewerNotes:
        "Every answer needs a real person and a real outcome, no frameworks in the abstract. Push for what they actually said in the hard conversation, how long they waited, and what happened to that person afterwards. Vagueness here is the strongest negative signal in the loop.",
      seedQuestions: PEOPLE_MANAGEMENT_SEEDS,
    },
    over
  );

const projectDeepDiveRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "project_deep_dive",
      kind: "project_deep_dive",
      title: "Project deep dive",
      signal: "Scope of real ownership, judgement under constraint, and results",
      minutes: 45,
      questionCount: 4,
      difficulty: "hard",
      answerMode: "spoken",
      bankCategories: ["behavioral", "technical"],
      focusAreas: ["delivery", "execution", "prioritization", "impact"],
      interviewerNotes:
        "Pick ONE project and stay on it for the whole round, going deeper each turn. Establish the size (people, time, money), then the decisions the candidate personally made, then the trade-offs, then the measured outcome. Drill until you hit either detail or the limit of their involvement.",
      seedQuestions: PROJECT_DEEP_DIVE_SEEDS,
    },
    over
  );

const productSenseRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "product_sense",
      kind: "product_sense",
      title: "Product sense & design",
      signal: "User empathy, structured thinking, and a defensible choice",
      minutes: 45,
      questionCount: 2,
      difficulty: "medium",
      answerMode: "spoken",
      bankCategories: ["product"],
      focusAreas: ["product sense", "user empathy", "prioritization", "design"],
      interviewerNotes:
        "Expect a structure: user and problem, segments, goal, ideas, then ONE prioritized recommendation with a reason. Ask who they chose NOT to serve. A list of features with no user and no trade-off is a fail, however long the list is.",
      seedQuestions: PRODUCT_SENSE_SEEDS,
    },
    over
  );

const analyticalRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "analytical",
      kind: "analytical",
      title: "Analytical & execution",
      signal: "Metrics judgement, diagnosis, and arithmetic done out loud",
      minutes: 45,
      questionCount: 3,
      difficulty: "medium",
      answerMode: "spoken",
      bankCategories: ["product", "technical"],
      focusAreas: ["metrics", "analytics", "diagnosis", "execution"],
      interviewerNotes:
        "Make them show the arithmetic and state assumptions out loud. On a diagnosis question, expect them to segment before guessing at causes. On a metrics question, expect a primary metric, a counter-metric, and what they'd do if the two disagreed.",
      seedQuestions: ANALYTICAL_SEEDS,
    },
    over
  );

const strategyRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "strategy",
      kind: "strategy",
      title: "Strategy",
      signal: "Market thinking, a real position, and the cost of being wrong",
      minutes: 45,
      questionCount: 3,
      difficulty: "hard",
      answerMode: "spoken",
      bankCategories: ["product"],
      focusAreas: ["strategy", "market", "competition", "trade-offs"],
      interviewerNotes:
        "Force a position, not a survey of options. Then attack it once and see whether they defend it with reasoning or abandon it. Ask what would have to be true for them to be wrong.",
      seedQuestions: PM_STRATEGY_SEEDS,
    },
    over
  );

const financeTechnicalRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "finance_technical",
      kind: "technical_screen",
      title: "Technical & accounting",
      signal: "Statements, valuation mechanics, and precision under follow-up",
      minutes: 45,
      questionCount: 4,
      difficulty: "medium",
      answerMode: "spoken",
      bankCategories: ["technical"],
      focusAreas: ["accounting", "valuation", "financial statements", "modeling"],
      interviewerNotes:
        "Precision matters here. Follow every answer with a mechanical 'and what happens to the other two statements?'. Accept a candidate who says 'I'd check' over one who invents a number. Wrong sign conventions are a real miss, not a slip.",
      seedQuestions: FINANCE_TECHNICAL_SEEDS,
    },
    over
  );

const modelingRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "modeling",
      kind: "modeling",
      title: "Modeling case",
      signal: "Model structure, drivers, and the checks they'd actually run",
      minutes: 60,
      questionCount: 2,
      difficulty: "hard",
      answerMode: "spoken",
      bankCategories: ["technical"],
      focusAreas: ["financial modeling", "forecasting", "scenarios", "variance"],
      interviewerNotes:
        "There's no spreadsheet in this room, so make them describe the model out loud: tabs, drivers, the order things calculate in, and the sanity checks. Ask what breaks if a driver moves 20%. Reward anyone who names their circularity and their error checks.",
      seedQuestions: FINANCE_MODELING_SEEDS,
    },
    over
  );

const businessPartnerRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "business_partner",
      kind: "behavioral",
      title: "Business partnering",
      signal: "Influence without authority and holding a number under pressure",
      minutes: 45,
      questionCount: 4,
      difficulty: "medium",
      answerMode: "spoken",
      bankCategories: ["behavioral"],
      focusAreas: ["influence", "stakeholders", "communication", "ownership"],
      interviewerNotes:
        "Finance only works through other people's decisions. Test whether they've changed one. Push for the moment of friction: who pushed back, what they said, and what the number ended up being.",
      seedQuestions: FINANCE_BUSINESS_PARTNER_SEEDS,
    },
    over
  );

const execPanelRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "exec_panel",
      kind: "exec_panel",
      title: "Executive panel",
      signal: "Judgement at company scale, and whether a board would trust them",
      minutes: 60,
      questionCount: 4,
      difficulty: "hard",
      answerMode: "spoken",
      bankCategories: ["behavioral", "technical"],
      focusAreas: ["strategy", "organisation", "capital allocation", "leadership"],
      interviewerNotes:
        "You are a panel of executives and one board member. Interrupt. Ask for the number behind the claim. Test whether the candidate can hold a position against a CEO who disagrees, and whether they distinguish what they'd decide from what they'd delegate.",
      seedQuestions: EXEC_PANEL_SEEDS_ENG,
    },
    over
  );

// —— Data & analytics rounds ——
// `bankCategories[0]` also decides the workbench a seed question opens in
// (`loop-curate.ts` files seeds under the first category), so a SQL round leads
// with "coding" to get the editor and a modelling round leads with
// "system_design" to get the canvas.

const sqlRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "sql_data",
      kind: "sql_data",
      title: "SQL & data manipulation",
      signal: "Correct SQL at the right grain, and the checks they run on it",
      minutes: 45,
      questionCount: 2,
      difficulty: "medium",
      answerMode: "coding",
      // The workbench opens in SQL for this round no matter what the question
      // text looks like, and the bank can only contribute actual SQL questions.
      // Without this, layer 1 of curation filled the round with real reported
      // *algorithm* questions (the bank has no SQL category, so it draws from
      // "coding") and the candidate got a JavaScript editor in the SQL round.
      codingLanguage: "sql",
      bankCategories: ["coding", "technical"],
      focusAreas: ["SQL", "data manipulation", "analytics", "debugging"],
      interviewerNotes:
        "Make them state the grain before writing a line. Expect a CTE rather than nested subqueries, an explicit choice between RANK and ROW_NUMBER when there are ties, and a sentence on NULLs and duplicates. Ask what the query costs on a billion rows. A query that returns the right answer for the wrong grain is a fail. " +
        // The workbench runs SQL against a real in-memory SQLite seeded with
        // these tables, so ask against them and the candidate can actually run
        // and check the query (see sql-fixtures.ts).
        `The candidate writes in a live SQLite editor loaded with sample rows for these tables, so ask questions against them and nothing else:\n${SQL_SCHEMA_SUMMARY}`,
      seedQuestions: SQL_SEEDS,
    },
    over
  );

const statisticsRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "statistics",
      kind: "statistics",
      title: "Statistics & probability",
      signal: "Correct definitions, stated assumptions, and honest uncertainty",
      minutes: 45,
      questionCount: 4,
      difficulty: "medium",
      answerMode: "spoken",
      bankCategories: ["technical"],
      focusAreas: [
        "statistics",
        "probability",
        "inference",
        "assumptions",
      ],
      interviewerNotes:
        "Definitions matter here and sloppiness is the signal. A p-value is P(data this extreme | null true). Anyone who says 'the probability the null is true' has missed the round's main question. Make them name the assumption behind every method and say what breaks if it fails. Reward 'I'd check' over a confident wrong number.",
      seedQuestions: STATISTICS_SEEDS,
    },
    over
  );

const experimentationRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "experimentation",
      kind: "experimentation",
      title: "Experimentation & A/B testing",
      signal: "Design, power, threats to validity, and the ship decision",
      minutes: 60,
      questionCount: 2,
      difficulty: "hard",
      answerMode: "spoken",
      bankCategories: ["technical", "product"],
      focusAreas: [
        "experimentation",
        "A/B testing",
        "metrics",
        "causal inference",
      ],
      interviewerNotes:
        "This is the highest-signal round for a data scientist, so drive the full arc: hypothesis and primary metric plus guardrails, unit of randomisation and why, minimum detectable effect BEFORE duration, validity checks (sample ratio mismatch, no peeking), reading effect size and interval rather than significance alone, then a ship / iterate / kill decision. Raise novelty effects and interference if they don't. Stopping at 'run a t-test and check p < 0.05' is a fail at any level.",
      seedQuestions: EXPERIMENTATION_SEEDS,
    },
    over
  );

const mlFundamentalsRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "ml_fundamentals",
      kind: "ml_fundamentals",
      title: "ML fundamentals & modelling",
      signal: "Problem framing, the right metric, and validation that holds up",
      minutes: 45,
      questionCount: 3,
      difficulty: "hard",
      answerMode: "spoken",
      bankCategories: ["technical"],
      focusAreas: [
        "machine learning",
        "model evaluation",
        "feature engineering",
        "validation",
      ],
      interviewerNotes:
        "Framing before models: the label, the prediction window, and a baseline. Then the metric that matches the cost of the errors (plain accuracy on imbalanced data is a miss) and a validation split that respects time and grouping. Probe leakage and drift. Someone who names a fashionable model before defining the label has failed the round.",
      seedQuestions: ML_FUNDAMENTALS_SEEDS,
    },
    over
  );

const mlDesignRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "ml_design",
      kind: "ml_design",
      title: "ML system design",
      signal: "The whole system: data, training, serving, and monitoring",
      minutes: 60,
      questionCount: 1,
      difficulty: "hard",
      answerMode: "system_design",
      bankCategories: ["system_design", "technical"],
      focusAreas: [
        "ML system design",
        "feature pipelines",
        "serving",
        "monitoring",
      ],
      interviewerNotes:
        "A model is not a system. Require: the objective and how it maps to a business metric, data and label sourcing, offline evaluation, candidate generation versus ranking where relevant, feature freshness (and training/serving skew), latency budget at serving time, then monitoring, drift, and rollback. Ask what they'd ship in week one instead of the full design.",
      seedQuestions: ML_DESIGN_SEEDS,
    },
    over
  );

const dataModelingRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "data_modeling",
      kind: "data_modeling",
      title: "Data modeling & warehouse design",
      signal: "Grain, dimensions, contracts, and who can trust the table",
      minutes: 60,
      questionCount: 1,
      difficulty: "hard",
      answerMode: "system_design",
      bankCategories: ["system_design", "technical"],
      focusAreas: [
        "data modeling",
        "warehouse design",
        "dimensional modeling",
        "data quality",
      ],
      interviewerNotes:
        "Make them declare the grain of every table out loud before drawing relationships. Push on slowly changing dimensions, late-arriving facts, idempotent reloads, and what happens when a source changes its schema without telling anyone. Ask who owns each layer and how a consumer knows a table is trustworthy.",
      seedQuestions: DATA_MODELING_SEEDS,
    },
    over
  );

// —— Cross-family rounds ——

const takeHomeRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "take_home",
      kind: "take_home",
      title: "Take-home assignment",
      signal: "Independent work: structure, judgement, and what they chose to cut",
      minutes: 60,
      questionCount: 1,
      difficulty: "medium",
      answerMode: "coding",
      bankCategories: ["coding", "technical"],
      focusAreas: ["independent work", "structure", "trade-offs", "communication"],
      interviewerNotes:
        "A real take-home is done alone against a clock, so give the brief, then get out of the way: answer clarifying questions, but do not coach or hint. Score what a reviewer would actually see: does it run, is it structured, are the assumptions written down, and did they say what they deliberately left out. At the end ask what they'd do with another day.",
      seedQuestions: TAKE_HOME_SEEDS_SWE,
    },
    over
  );

const presentationRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "presentation",
      kind: "presentation",
      title: "Project presentation",
      signal: "Can they make a room care, and survive the questions after",
      minutes: 45,
      questionCount: 3,
      difficulty: "hard",
      answerMode: "spoken",
      bankCategories: ["behavioral", "technical"],
      focusAreas: ["communication", "storytelling", "impact", "audience"],
      interviewerNotes:
        "You are a mixed panel: one expert, two people from other functions. Let them present, then interrogate. Score the structure (decision first, not chronology), whether they pitch at the right level for a non-expert, and how they handle a challenge to their headline number. Being unable to say what they're least confident about is the common failure here.",
      seedQuestions: PRESENTATION_SEEDS,
    },
    over
  );

const codeReviewRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "code_review",
      kind: "code_review",
      title: "Code review & debugging",
      signal: "Judgement on someone else's code, and how they give feedback",
      minutes: 45,
      questionCount: 2,
      difficulty: "medium",
      answerMode: "coding",
      bankCategories: ["coding", "technical"],
      focusAreas: ["code review", "debugging", "quality", "feedback"],
      interviewerNotes:
        "Two things are being scored: what they catch, and how they'd say it. Push for a ranked review: what blocks the merge (correctness, security, data loss) versus what's a preference, and make them justify anything they'd block. Then have them find and prove the real bug. Someone who rewrites the whole thing to their taste has failed the collaboration half.",
      seedQuestions: CODE_REVIEW_SEEDS,
    },
    over
  );

const pairProgrammingRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "pair_programming",
      kind: "pair_programming",
      title: "Pair programming",
      signal: "Working with a teammate on real code, not solo puzzle-solving",
      minutes: 60,
      questionCount: 1,
      difficulty: "medium",
      answerMode: "coding",
      bankCategories: ["coding"],
      focusAreas: ["collaboration", "coding", "incremental delivery", "testing"],
      interviewerNotes:
        "You are a teammate, not an examiner: answer questions honestly, suggest one thing halfway through, and see whether they engage with it or steamroll it. Score narration, small working increments, and asking rather than guessing. Silence for ten minutes is a fail in this round even if the code is right.",
      seedQuestions: PAIR_PROGRAMMING_SEEDS,
    },
    over
  );

const teamMatchingRound = (over?: StageOverrides): LoopStage =>
  stage(
    {
      id: "team_matching",
      kind: "team_matching",
      title: "Team matching",
      signal: "Where they'd actually thrive, and how they choose",
      minutes: 30,
      questionCount: 3,
      difficulty: "easy",
      answerMode: "spoken",
      bankCategories: ["behavioral"],
      focusAreas: ["motivation", "team fit", "working style", "growth"],
      interviewerNotes:
        "The hire is already leaning yes; this decides where they land, and a bad match here is how good hires quit in six months. Be candid about trade-offs between teams and see whether they ask real questions. Score self-knowledge: someone who says every team sounds great has told you nothing.",
      seedQuestions: TEAM_MATCHING_SEEDS,
    },
    over
  );

// ── The blueprints ──────────────────────────────────────────────────────────

export const LOOP_BLUEPRINTS: LoopBlueprint[] = [
  // —— Engineering ——
  {
    id: "loop-swe-junior",
    title: "Software Engineer",
    family: "engineering",
    level: "New grad / Junior",
    category: "engineering",
    roleLevel: "Junior Software Engineer",
    summary:
      "The standard early-career engineering loop: a recruiter screen, one technical screen, two coding rounds' worth of algorithms, and a values round. Design is deliberately absent; most companies don't run it below mid-level.",
    modeledOn:
      "Representative new-grad loop at large tech companies (recruiter screen → technical screen → coding → values → hiring manager)",
    stages: [
      recruiterScreen(),
      technicalScreen({ questionCount: 3, difficulty: "easy" }),
      codingRound({
        seedQuestions: CODING_SEEDS_JUNIOR,
        difficulty: "easy",
        signal: "Correct code, clear reasoning, and testing without being asked",
      }),
      takeHomeRound({
        title: "Practical build",
        difficulty: "easy",
        signal: "Something that runs, structured well, with its assumptions stated",
      }),
      behavioralRound({ questionCount: 3 }),
      valuesGrowthRound(),
      hiringManagerRound({ minutes: 30, questionCount: 3 }),
    ],
  },
  {
    id: "loop-swe-senior",
    title: "Senior Software Engineer",
    family: "engineering",
    level: "Senior / Staff",
    category: "engineering",
    roleLevel: "Senior Software Engineer",
    summary:
      "The full senior loop, and the one most people fail on system design. Two technical rounds, a 60-minute design round, and a behavioral round that expects scope beyond your own keyboard.",
    modeledOn:
      "Representative senior (L5/E5) onsite loop: technical screen → coding → system design → behavioral → values → hiring manager",
    stages: [
      recruiterScreen(),
      technicalScreen(),
      codingRound({
        seedQuestions: CODING_SEEDS_SENIOR,
        difficulty: "hard",
        minutes: 45,
      }),
      systemDesignRound({
        seedQuestions: SYSTEM_DESIGN_SEEDS_SENIOR,
        difficulty: "hard",
      }),
      codeReviewRound({ difficulty: "hard" }),
      behavioralRound({
        difficulty: "hard",
        interviewerNotes:
          "At senior level the bar is scope and influence, not effort. Expect stories where the candidate changed how a team worked, not just what they personally shipped. Ask who else was affected by each decision.",
      }),
      valuesGrowthRound({ minutes: 45 }),
      hiringManagerRound(),
      teamMatchingRound(),
    ],
  },
  {
    id: "loop-swe-startup",
    title: "Software Engineer (startup / scale-up)",
    family: "engineering",
    level: "Mid / Senior",
    category: "engineering",
    roleLevel: "Senior Software Engineer",
    summary:
      "Startups interview differently: less algorithm trivia, more building something with you and reviewing real code. Shorter loop, higher weight on whether you'd be pleasant to work next to.",
    modeledOn:
      "Representative startup / scale-up loop: founder or recruiter chat → pair programming → practical build → code review → pragmatic design → founder & values conversation",
    stages: [
      recruiterScreen({
        title: "Intro call",
        interviewerNotes:
          "You are an early employee or founder, not a recruiter reading a script. Be direct about the stage of the company. Find out whether they've worked without much structure and whether they actually want to.",
      }),
      pairProgrammingRound(),
      takeHomeRound({
        title: "Practical build",
        signal: "A working slice of a real feature, and sensible shortcuts",
      }),
      codeReviewRound(),
      systemDesignRound({
        minutes: 45,
        difficulty: "medium",
        title: "Pragmatic design",
        seedQuestions: SYSTEM_DESIGN_SEEDS_MID,
        interviewerNotes:
          "This is a design round for a company with three engineers and no platform team. Reward the smallest thing that works, an honest note on what it won't survive, and knowing which managed service to buy instead of building. Planet-scale architecture with no traffic to justify it is the failure mode here.",
      }),
      valuesGrowthRound({
        title: "Founder & values conversation",
        minutes: 45,
        signal: "Ownership without direction, and how they handle being wrong",
      }),
    ],
  },
  {
    id: "loop-em",
    title: "Engineering Manager",
    family: "engineering",
    level: "Manager (first line)",
    category: "engineering",
    roleLevel: "Engineering Manager",
    summary:
      "An EM loop trades one coding round for people management and a project retrospective, but keeps a technical round; you still have to be credible with your own engineers.",
    modeledOn:
      "Representative EM loop: recruiter screen → people management → project retrospective → technical/planning → system design → values → hiring manager (skip-level)",
    stages: [
      recruiterScreen({
        interviewerNotes:
          "You are a recruiter hiring a manager. Check team size, scope, and whether they've actually managed people versus led projects. Get the numbers: how many reports, how many teams, how long.",
      }),
      peopleManagementRound(),
      projectDeepDiveRound(),
      stage(
        {
          id: "em_technical",
          kind: "technical_screen",
          title: "Technical judgement",
          signal: "Still credible technically, without doing the work himself",
          minutes: 45,
          questionCount: 4,
          difficulty: "medium",
          answerMode: "spoken",
          bankCategories: ["technical", "system_design"],
          focusAreas: [
            "technical judgement",
            "architecture",
            "technical debt",
            "delivery",
          ],
          interviewerNotes:
            "You're testing whether this manager can be trusted with technical decisions, not whether they can still code fast. Probe how they evaluate a proposal they don't fully understand, and how they disagree with a strong engineer.",
          seedQuestions: EM_TECHNICAL_SEEDS,
        },
        undefined
      ),
      systemDesignRound({
        minutes: 45,
        difficulty: "medium",
        signal: "Enough depth to lead the review, not to win it",
        interviewerNotes:
          "A manager's design round is about judgement and questions, not the perfect diagram. Expect requirements, one workable architecture, and clear naming of what they'd delegate and what they'd insist on.",
      }),
      valuesGrowthRound({
        title: "Values & people development",
        signal: "How they grow people, take feedback, and behave under pressure",
      }),
      hiringManagerRound({
        title: "Skip-level with the director",
        interviewerNotes:
          "You are this manager's future manager. Test how they'd handle a peer conflict, how they escalate, and what they'd want from you. Judge whether you'd hand them a struggling team.",
      }),
    ],
  },
  {
    id: "loop-eng-director",
    title: "Director / VP of Engineering",
    family: "leadership",
    level: "Director / VP",
    category: "executive",
    roleLevel: "Director of Engineering",
    summary:
      "A leadership loop: organisation design, cross-functional conflict, budget, and a panel that will interrupt you. Almost no whiteboard, all judgement.",
    modeledOn:
      "Representative Director/VP Engineering loop: recruiter screen → org & people → cross-functional partnership → technical strategy → executive panel",
    stages: [
      recruiterScreen({
        interviewerNotes:
          "You are an executive recruiter. Establish org size, budget owned, and the scope of the last two roles in numbers. Probe why they're leaving at this level.",
      }),
      peopleManagementRound({
        title: "Organisation & people",
        minutes: 60,
        signal: "Org design, leader development, and performance at scale",
        interviewerNotes:
          "At this level you're hiring someone who hires managers. Test how they've built a management layer, how they've removed a leader who wasn't working, and how they know what's happening two levels down without micromanaging.",
      }),
      stage(
        {
          id: "cross_functional",
          kind: "behavioral",
          title: "Cross-functional partnership",
          signal: "Peer relationships with product, design, sales, and finance",
          minutes: 45,
          questionCount: 4,
          difficulty: "hard",
          answerMode: "spoken",
          bankCategories: ["behavioral"],
          focusAreas: ["influence", "conflict", "stakeholders", "leadership"],
          interviewerNotes:
            "You are the VP of Product. Test whether this person fights fair, escalates cleanly, and can be trusted with a shared commitment. Bring up a case where engineering missed a date and watch how they handle the blame.",
          seedQuestions: LEADERSHIP_BEHAVIORAL_SEEDS,
        },
        undefined
      ),
      stage(
        {
          id: "tech_strategy",
          kind: "strategy",
          title: "Technical strategy",
          signal: "Platform bets, build-versus-buy, and paying for the future",
          minutes: 45,
          questionCount: 3,
          difficulty: "hard",
          answerMode: "spoken",
          bankCategories: ["system_design", "technical"],
          focusAreas: ["strategy", "architecture", "build vs buy", "roadmap"],
          interviewerNotes:
            "Ask for a bet they made, its cost, and how it turned out. Push on how they'd sequence a migration alongside a roadmap the business already committed to.",
          seedQuestions: ENG_STRATEGY_SEEDS,
        },
        undefined
      ),
      presentationRound({
        title: "Strategy presentation",
        minutes: 60,
        signal: "A 90-day plan that survives a room of peers",
        interviewerNotes:
          "You are a panel of peers: product, design, and another engineering director. They present what they'd do in their first 90 days with this organisation. Score whether it's specific to what they've been told, whether they sequenced it, and how they handle a peer saying the first item is wrong.",
      }),
      execPanelRound({ seedQuestions: EXEC_PANEL_SEEDS_ENG }),
    ],
  },
  {
    id: "loop-cto",
    title: "CTO",
    family: "leadership",
    level: "Executive",
    category: "executive",
    roleLevel: "CTO",
    summary:
      "A CTO loop is a series of conversations with peers and the board, not an interview in the usual sense. Expect to be interrupted, and to be asked for numbers you're expected to know by heart.",
    modeledOn:
      "Representative CTO process: founder/CEO conversation → org & talent → technical strategy → board/investor panel",
    stages: [
      stage(
        {
          id: "ceo_conversation",
          kind: "hiring_manager",
          title: "Conversation with the CEO",
          signal: "Partnership with the CEO, and a point of view on the business",
          minutes: 60,
          questionCount: 4,
          difficulty: "hard",
          answerMode: "spoken",
          bankCategories: ["behavioral"],
          focusAreas: ["leadership", "strategy", "partnership", "motivation"],
          interviewerNotes:
            "You are the founder and CEO. You care whether this person makes you better and whether they'll tell you when you're wrong. Ask what they think the company's real constraint is, and disagree with their answer once.",
          seedQuestions: [
            "What do you think is actually holding this company back technically?",
            "Tell me about a time you told a CEO something they didn't want to hear.",
            "How would you spend your first 90 days here?",
            "What would you need from me to succeed?",
            "How do you decide when engineering says no to the business?",
          ],
        },
        undefined
      ),
      peopleManagementRound({
        title: "Organisation & talent",
        minutes: 60,
        difficulty: "hard",
        signal: "Building a leadership bench and fixing the one that isn't working",
      }),
      stage(
        {
          id: "tech_strategy_cto",
          kind: "strategy",
          title: "Technology strategy & architecture",
          signal: "Bets, platform, security, and cost at company scale",
          minutes: 60,
          questionCount: 3,
          difficulty: "hard",
          answerMode: "spoken",
          bankCategories: ["system_design", "technical"],
          focusAreas: ["strategy", "architecture", "security", "cost"],
          interviewerNotes:
            "Test breadth with depth on demand: ask for the architecture, then drop two levels into one part of it. Cover security and infrastructure cost; a CTO who can't discuss either has not passed.",
          seedQuestions: ENG_STRATEGY_SEEDS,
        },
        undefined
      ),
      execPanelRound({
        title: "Board & investor panel",
        signal: "Credibility with people who control the money",
      }),
    ],
  },

  // —— Data & analytics ——
  // `roleLevel` is what selects the data-science playbook lens (see ROLE_LENSES
  // in `playbooks.ts`), so these strings say "Data Analyst" / "Data Scientist"
  // rather than a title of our own invention.
  {
    id: "loop-data-analyst",
    title: "Data / Product Analyst",
    family: "data",
    level: "Junior / Mid",
    category: "product",
    roleLevel: "Data Analyst",
    summary:
      "An analyst loop is SQL first and communication second: can you get the right number at the right grain, and can you make a product team act on it. Modelling is deliberately absent.",
    modeledOn:
      "Representative analyst process: recruiter screen → SQL screen → analytics case → stakeholder/behavioral → hiring manager",
    stages: [
      recruiterScreen({ seedQuestions: RECRUITER_SEEDS_DATA }),
      sqlRound({ difficulty: "easy", questionCount: 2 }),
      analyticalRound({
        title: "Analytics & metrics case",
        signal: "Diagnosis, metric definitions, and arithmetic out loud",
        seedQuestions: DS_PRODUCT_CASE_SEEDS,
        interviewerNotes:
          "Give them a business situation, not a puzzle. Expect them to confirm the metric definition, check instrumentation before behaviour, segment before hypothesising, and end with the one query they'd run first. Make them do the arithmetic aloud.",
      }),
      statisticsRound({ minutes: 30, questionCount: 3, difficulty: "easy" }),
      behavioralRound({
        title: "Stakeholders & communication",
        seedQuestions: DS_BEHAVIORAL_SEEDS,
        interviewerNotes:
          "An analyst's job is other people's decisions. Test a time their work changed one, a time it didn't, and how they handle being asked for a number to justify a decision already made.",
      }),
      hiringManagerRound({ minutes: 30, questionCount: 3 }),
    ],
  },
  {
    id: "loop-data-scientist",
    title: "Data Scientist",
    family: "data",
    level: "Mid-level",
    category: "engineering",
    roleLevel: "Data Scientist",
    summary:
      "The standard product data science loop: SQL, statistics, experimentation, a metrics case, and behavioral. Experimentation is the round that decides it.",
    modeledOn:
      "Representative product/analytics DS loop: recruiter screen → SQL & coding → statistics → experimentation → product & metrics case → values → hiring manager",
    stages: [
      recruiterScreen({ seedQuestions: RECRUITER_SEEDS_DATA }),
      sqlRound(),
      statisticsRound(),
      experimentationRound({ minutes: 45, difficulty: "medium" }),
      analyticalRound({
        title: "Product & metrics case",
        signal: "Metric judgement, diagnosis, and a decision at the end",
        seedQuestions: DS_PRODUCT_CASE_SEEDS,
      }),
      behavioralRound({ seedQuestions: DS_BEHAVIORAL_SEEDS }),
      valuesGrowthRound(),
      hiringManagerRound(),
    ],
  },
  {
    id: "loop-data-scientist-senior",
    title: "Senior Data Scientist",
    family: "data",
    level: "Senior / Staff",
    category: "engineering",
    roleLevel: "Senior Data Scientist",
    summary:
      "The senior DS loop keeps every technical round and adds modelling depth, a take-home, and a presentation. At this level you're hired to be believed, not just to be correct.",
    modeledOn:
      "Representative senior DS loop: screen → SQL → statistics & experimentation → ML fundamentals → take-home → presentation → behavioral → hiring manager",
    stages: [
      recruiterScreen({ seedQuestions: RECRUITER_SEEDS_DATA }),
      sqlRound({ seedQuestions: SQL_SEEDS_SENIOR, difficulty: "hard" }),
      statisticsRound({ difficulty: "hard" }),
      experimentationRound(),
      mlFundamentalsRound(),
      takeHomeRound({
        title: "Take-home analysis",
        seedQuestions: TAKE_HOME_SEEDS_DATA,
        signal: "Independent analysis: assumptions, rigour, and what they cut",
      }),
      presentationRound({
        title: "Present your analysis",
        signal: "Landing a result with people who won't read the notebook",
      }),
      behavioralRound({
        difficulty: "hard",
        seedQuestions: DS_BEHAVIORAL_SEEDS,
        interviewerNotes:
          "Senior bar: influence and judgement, not effort. Expect a time they stopped a bad decision with evidence, and a time they were the one who was wrong. Ask who else changed what they did because of their work.",
      }),
      hiringManagerRound(),
    ],
  },
  {
    id: "loop-ml-engineer",
    title: "Machine Learning Engineer",
    family: "data",
    level: "Mid / Senior",
    category: "engineering",
    roleLevel: "Machine Learning Engineer",
    summary:
      "Half software engineer, half data scientist: real coding, ML fundamentals, and an ML system design round that covers training, serving, and what happens when the model drifts.",
    modeledOn:
      "Representative MLE loop: screen → coding → ML fundamentals → ML system design → system design → behavioral → hiring manager",
    stages: [
      recruiterScreen({ seedQuestions: RECRUITER_SEEDS_DATA }),
      codingRound({ seedQuestions: CODING_SEEDS_SENIOR, difficulty: "hard" }),
      mlFundamentalsRound(),
      mlDesignRound(),
      sqlRound({ minutes: 30, questionCount: 1, difficulty: "medium" }),
      behavioralRound({ seedQuestions: DS_BEHAVIORAL_SEEDS }),
      valuesGrowthRound({ minutes: 30, questionCount: 3 }),
      hiringManagerRound(),
    ],
  },
  {
    id: "loop-data-engineer",
    title: "Data Engineer",
    family: "data",
    level: "Mid / Senior",
    category: "engineering",
    roleLevel: "Data Engineer",
    summary:
      "A data engineering loop is SQL depth, warehouse modelling, and pipeline design under failure. Most candidates lose it on idempotency and late-arriving data, not on syntax.",
    modeledOn:
      "Representative DE loop: screen → SQL → coding → data modeling → pipeline design → behavioral → hiring manager",
    stages: [
      recruiterScreen({ seedQuestions: RECRUITER_SEEDS_DATA }),
      sqlRound({ seedQuestions: SQL_SEEDS_SENIOR, difficulty: "hard" }),
      codingRound({
        minutes: 45,
        questionCount: 2,
        signal: "Working code for data work: parsing, batching, and edge cases",
      }),
      dataModelingRound(),
      systemDesignRound({
        title: "Pipeline & platform design",
        signal: "Throughput, freshness, failure, and reprocessing",
        seedQuestions: PIPELINE_DESIGN_SEEDS,
        interviewerNotes:
          "Scope first: volume, freshness target, and delivery guarantee. Then batch versus streaming with a reason, schema evolution, idempotent reprocessing, backfills, and how the on-call person finds out something is wrong. Ask what breaks when a source doubles overnight.",
      }),
      behavioralRound({ seedQuestions: DS_BEHAVIORAL_SEEDS }),
      hiringManagerRound(),
    ],
  },
  {
    id: "loop-data-science-manager",
    title: "Data Science / Analytics Manager",
    family: "data",
    level: "Manager / Director",
    category: "engineering",
    roleLevel: "Data Science Manager",
    summary:
      "A data leadership loop: still technical enough to review the work, but judged on prioritisation, team growth, and whether the organisation trusts your numbers.",
    modeledOn:
      "Representative data leadership loop: screen → people management → project deep dive → technical judgement (SQL & experimentation) → stakeholder strategy → skip-level",
    stages: [
      recruiterScreen({
        seedQuestions: RECRUITER_SEEDS_DATA,
        interviewerNotes:
          "You are a recruiter hiring a data leader. Get the numbers: how many analysts or scientists, which teams they supported, and whether they owned the data platform or only the analysis.",
      }),
      peopleManagementRound({
        seedQuestions: DS_MANAGER_SEEDS,
        signal: "Growing analysts, and protecting them from the request queue",
      }),
      projectDeepDiveRound({
        title: "Analysis deep dive",
        signal: "Depth on one piece of work, and the decision it moved",
      }),
      statisticsRound({
        title: "Technical judgement",
        minutes: 45,
        questionCount: 3,
        signal: "Enough rigour to catch a bad analysis before it ships",
        interviewerNotes:
          "You're testing whether this manager can review work, not produce it. Give them a flawed analysis and see what they catch: the wrong test, the peeked experiment, the metric that moved because of a logging change. Ask what they'd send back and how they'd say it.",
      }),
      strategyRound({
        title: "Data strategy & stakeholders",
        signal: "Roadmap, trust in the numbers, and saying no well",
        seedQuestions: DS_STRATEGY_SEEDS,
        interviewerNotes:
          "You are the VP of Product. Every team wants a dashboard tomorrow. Test how they prioritise, how they handle two teams reporting different numbers for the same metric, and what they'd invest in that nobody is asking for.",
      }),
      hiringManagerRound({
        title: "Skip-level with the director",
        interviewerNotes:
          "You are this manager's future manager. Test how they escalate, how they'd handle inheriting a team nobody trusts, and what they'd want from you in the first month.",
      }),
    ],
  },

  // —— Product ——
  {
    id: "loop-pm",
    title: "Product Manager",
    family: "product",
    level: "PM / Associate PM",
    category: "product",
    roleLevel: "Product Manager",
    summary:
      "The classic PM loop: product sense, analytical/execution, technical fluency, and behavioral. Structure matters more than the answer in every round.",
    modeledOn:
      "Representative PM loop: recruiter screen → product sense → analytical/execution → technical → behavioral → hiring manager",
    stages: [
      recruiterScreen({
        seedQuestions: [
          "Walk me through your background and the products you've owned.",
          "Why product, and why this product?",
          "What's a product decision you made that you'd defend to me right now?",
          "What are you looking for in your next role?",
        ],
      }),
      productSenseRound(),
      analyticalRound(),
      stage(
        {
          id: "pm_technical",
          kind: "technical_screen",
          title: "Technical fluency",
          signal: "Can hold their own with engineers and scope realistically",
          minutes: 45,
          questionCount: 3,
          difficulty: "medium",
          answerMode: "spoken",
          bankCategories: ["technical", "system_design"],
          focusAreas: ["technical fluency", "scoping", "trade-offs", "APIs"],
          interviewerNotes:
            "You are a tech lead. You're not testing whether they can code; you're testing whether they can be lied to. Ask them to explain a system they've worked on, then push on what they'd cut to halve the build time.",
          seedQuestions: [
            "Explain how the product you last worked on actually worked, end to end.",
            "An engineer tells you a two-week feature will take two months. How do you respond?",
            "What's an API, and how would you decide what belongs in one?",
            "How would you scope a feature so it can ship in half the time?",
            "How do you decide when technical debt is worth paying down?",
          ],
        },
        undefined
      ),
      behavioralRound({ seedQuestions: PM_BEHAVIORAL_SEEDS }),
      hiringManagerRound(),
    ],
  },
  {
    id: "loop-pm-senior",
    title: "Senior / Principal Product Manager",
    family: "product",
    level: "Senior / Principal",
    category: "product",
    roleLevel: "Senior Product Manager",
    summary:
      "The senior PM loop adds strategy and expects leadership without authority. The product-sense round gets harder because 'ship more features' stops being an answer.",
    modeledOn:
      "Representative senior PM loop: screen → product sense → analytical → strategy → leadership/behavioral → hiring manager",
    stages: [
      recruiterScreen(),
      productSenseRound({
        difficulty: "hard",
        interviewerNotes:
          "Senior bar: expect a segment-level choice, a stated goal metric, and an explicit decision about who they will not serve. Ask what they'd kill to fund this.",
      }),
      analyticalRound({ difficulty: "hard" }),
      takeHomeRound({
        title: "Written product exercise",
        answerMode: "spoken",
        bankCategories: ["product"],
        seedQuestions: TAKE_HOME_SEEDS_PM,
        signal: "Written clarity: problem, scope, metric, and what's out",
        interviewerNotes:
          "This is the written round PM loops use to see how someone thinks on paper. Give the brief and stay quiet. Score structure over polish: is there one problem, one user, one hypothesis, a success metric, and an explicit list of what they are not doing. A feature list with no metric fails.",
      }),
      strategyRound(),
      behavioralRound({
        title: "Leadership & influence",
        difficulty: "hard",
        seedQuestions: PM_BEHAVIORAL_SEEDS,
        interviewerNotes:
          "Test influence over people who don't report to them, and a time they changed an organisation's mind. Vague 'alignment' language without a decision is a miss.",
      }),
      valuesGrowthRound(),
      hiringManagerRound(),
    ],
  },

  // —— Finance ——
  {
    id: "loop-finance-analyst",
    title: "Financial Analyst / FP&A",
    family: "finance",
    level: "Analyst / Senior Analyst",
    category: "finance",
    roleLevel: "Financial Analyst",
    summary:
      "A finance loop is technical precision plus a modelling case, then whether the business will actually listen to you. Sign conventions and cash-versus-accrual mistakes are what fail people here.",
    modeledOn:
      "Representative FP&A / analyst process: recruiter screen → technical & accounting → modelling case → business partnering → hiring manager",
    stages: [
      recruiterScreen({
        seedQuestions: [
          "Walk me through your background. Which parts of the close and the forecast have you owned?",
          "Why this role, and why now?",
          "What systems have you worked in, and how comfortable are you in Excel?",
          "What kind of finance team do you want to be part of?",
        ],
      }),
      financeTechnicalRound(),
      modelingRound(),
      businessPartnerRound(),
      valuesGrowthRound({ minutes: 30, questionCount: 3 }),
      hiringManagerRound({
        interviewerNotes:
          "You are the finance manager who'll own this hire. Test attention to detail, how they handle a close under time pressure, and whether they'd tell you about their own error.",
      }),
    ],
  },
  {
    id: "loop-finance-director",
    title: "Finance Manager / Director",
    family: "finance",
    level: "Manager / Director",
    category: "finance",
    roleLevel: "Finance Director",
    summary:
      "Still technical, but now judged on the team, the calendar, and whether the numbers you present survive contact with a CFO.",
    modeledOn:
      "Representative finance leadership process: screen → technical → planning & process → team & partnering → executive conversation",
    stages: [
      recruiterScreen(),
      financeTechnicalRound({ difficulty: "hard", questionCount: 3 }),
      stage(
        {
          id: "planning_process",
          kind: "case_study",
          title: "Planning & process",
          signal: "Owning the calendar: close, forecast, budget, and controls",
          minutes: 60,
          questionCount: 3,
          difficulty: "hard",
          answerMode: "spoken",
          bankCategories: ["technical", "behavioral"],
          focusAreas: ["FP&A", "forecasting", "controls", "process"],
          interviewerNotes:
            "Test whether they've run a cycle, not just contributed to one. Ask for the calendar, who owns each input, where it breaks, and what they changed to fix it. Push on materiality thresholds and controls.",
          seedQuestions: [
            "Walk me through the annual planning process you ran: dates, owners, and where it went wrong.",
            "How do you shorten a close that currently takes twelve days?",
            "Your forecast has missed three quarters in a row. What do you change?",
            "How do you handle a business leader who submits a budget you know is unrealistic?",
            "What controls would you put in place first at a company that has none?",
          ],
        },
        undefined
      ),
      peopleManagementRound({
        title: "Team & partnering",
        minutes: 45,
        difficulty: "medium",
        signal: "Growing analysts and holding the line with the business",
      }),
      hiringManagerRound({
        title: "Conversation with the CFO",
        minutes: 45,
        interviewerNotes:
          "You are the CFO. Be brisk and numerate. Ask what they'd tell you in their first week, and interrupt for the number behind any claim.",
      }),
    ],
  },
  {
    id: "loop-cfo",
    title: "CFO",
    family: "leadership",
    level: "Executive",
    category: "executive",
    roleLevel: "CFO",
    summary:
      "A CFO process is capital, credibility, and the board. Expect to be asked what you'd do with a number you don't like, in front of people who already have an opinion.",
    modeledOn:
      "Representative CFO process: CEO conversation → finance organisation → capital & strategy → board/audit panel",
    stages: [
      stage(
        {
          id: "ceo_conversation_cfo",
          kind: "hiring_manager",
          title: "Conversation with the CEO",
          signal: "Partnership, candour, and a point of view on the business model",
          minutes: 60,
          questionCount: 4,
          difficulty: "hard",
          answerMode: "spoken",
          bankCategories: ["behavioral"],
          focusAreas: ["leadership", "strategy", "partnership", "candour"],
          interviewerNotes:
            "You are the founder and CEO, and you want a CFO who will tell you no with a reason. Ask what they think the company's unit economics really are, then disagree once.",
          seedQuestions: [
            "What do you think our biggest financial risk is, based on what you know?",
            "Tell me about a time you told a CEO or board something they didn't want to hear.",
            "How would you spend your first 90 days?",
            "When would you tell me to slow down hiring?",
            "How do you think about the trade-off between growth and margin here?",
          ],
        },
        undefined
      ),
      peopleManagementRound({
        title: "Finance organisation",
        minutes: 45,
        difficulty: "hard",
        signal: "Building controllership, FP&A, and a bench that can scale",
      }),
      stage(
        {
          id: "capital_strategy",
          kind: "strategy",
          title: "Capital & strategy",
          signal: "Allocation, fundraising, and defending a plan under pressure",
          minutes: 60,
          questionCount: 3,
          difficulty: "hard",
          answerMode: "spoken",
          bankCategories: ["technical"],
          focusAreas: [
            "capital allocation",
            "fundraising",
            "unit economics",
            "strategy",
          ],
          interviewerNotes:
            "Ask for a real allocation decision with the numbers. Push on what they'd cut first, what they'd never cut, and how they'd know they were wrong. Expect fluency on cash runway, payback, and dilution.",
          seedQuestions: FINANCE_STRATEGY_SEEDS,
        },
        undefined
      ),
      execPanelRound({
        title: "Board & audit committee",
        signal: "Credibility with the board, auditors, and investors",
        seedQuestions: EXEC_PANEL_SEEDS_FINANCE,
      }),
    ],
  },
];

export function getLoopBlueprint(id: string): LoopBlueprint | null {
  return LOOP_BLUEPRINTS.find((b) => b.id === id) ?? null;
}

export function getLoopStage(
  blueprint: LoopBlueprint,
  stageId: string
): LoopStage | null {
  return blueprint.stages.find((s) => s.id === stageId) ?? null;
}

/** Total wall-clock minutes for a set of stages. */
export function loopTotalMinutes(stages: LoopStage[]): number {
  return stages.reduce((sum, s) => sum + s.minutes, 0);
}

/** "3h 45m" / "45m" — loops are long enough that raw minutes read badly. */
export function formatLoopDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Blueprints grouped by family, in the order families are declared. */
export function loopBlueprintsByFamily(): {
  family: LoopFamily;
  label: string;
  blueprints: LoopBlueprint[];
}[] {
  const families: LoopFamily[] = [
    "engineering",
    "data",
    "product",
    "finance",
    "leadership",
  ];
  return families.map((family) => ({
    family,
    label: LOOP_FAMILY_LABELS[family],
    blueprints: LOOP_BLUEPRINTS.filter((b) => b.family === family),
  }));
}
