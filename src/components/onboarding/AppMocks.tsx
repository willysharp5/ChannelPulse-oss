import { EyeOffIcon, StarIcon } from "lucide-react";

/**
 * Animated mock diagrams recreated from the landing page — used in onboarding /
 * "How it works" to showcase what the app does with minimal text. Colors mirror
 * the marketing site (ink / forest / lavender / ember).
 */

const WAVE_HEIGHTS = [8, 18, 12, 22, 10, 16, 20];

function Wave({ forest = false }: { forest?: boolean }) {
  return (
    <span className={`cp-wave${forest ? " cp-wave--forest" : ""}`} aria-hidden>
      {WAVE_HEIGHTS.slice(0, forest ? 5 : 7).map((h, i) => (
        <span key={i} style={{ height: h }} />
      ))}
    </span>
  );
}

function LiveChip({ light = false }: { light?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-semibold"
      style={
        light
          ? { background: "rgba(255,169,70,0.18)", color: "#b26a00" }
          : { background: "rgba(255,169,70,0.16)", color: "#ffa946" }
      }
    >
      <span className="size-2 rounded-full" style={{ background: "#ffa946" }} />
      Listening
    </span>
  );
}

function WindowBar({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 border-b-2 border-[#1a1a1a] px-4 py-3 text-sm text-[#8a8a80]">
      <span className="size-2.5 rounded-full bg-[#e5e7eb]" />
      <span className="size-2.5 rounded-full bg-[#e5e7eb]" />
      <span className="size-2.5 rounded-full bg-[#e5e7eb]" />
      <span className="ml-1">{label}</span>
    </div>
  );
}

// The light-card mocks use a 2px near-black border to match the landing look.

function Chip({ label, selected }: { label: string; selected?: boolean }) {
  return (
    <span
      className={`rounded-full border-2 border-[#1a1a1a] px-2.5 py-1 text-2xs font-semibold ${
        selected ? "bg-[#f0d7ff] text-[#1a1a1a]" : "bg-white text-[#222222]"
      }`}
    >
      {label}
      {selected ? " ✓" : ""}
    </span>
  );
}

/** The dark "velvet" live-coaching overlay with a Suggested reply. */
export function OverlayMock() {
  return (
    <div className="cp-float mx-auto w-full max-w-[22.5rem] rounded-[28px] bg-[#1a1a1a] p-3 text-[#f3f4f6] shadow-xl">
      <div className="mb-2.5 flex items-center justify-between gap-3 rounded-full bg-white/[0.06] px-3 py-2">
        <div className="flex items-center gap-2.5">
          <img src="/app-icon.png" alt="" className="h-5 w-5 rounded-md" />
          <Wave />
        </div>
        <LiveChip />
      </div>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 rounded-full bg-white/[0.12] px-2.5 py-1 text-2xs font-semibold text-[#e5e7eb]">
            Them
          </span>
          <p className="flex-1 rounded-2xl bg-white/[0.06] px-3 py-2 text-sm leading-snug">
            So how would you scale this to a million users?
          </p>
        </div>
        <div className="flex items-start gap-2">
          <span className="mt-0.5 rounded-full bg-[#034f46] px-2.5 py-1 text-2xs font-semibold text-[#f3f4f6]">
            You
          </span>
          <p className="flex-1 rounded-2xl bg-white/[0.06] px-3 py-2 text-sm leading-snug">
            Good question. Let me walk through the architecture…
          </p>
        </div>
        <div className="rounded-[18px] bg-[#034f46] p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold text-[#f0d7ff]">
            <StarIcon className="size-3.5" />
            Suggested reply
          </div>
          <ul className="space-y-1 text-xs leading-snug">
            {[
              "Shard the DB by tenant; cache hot reads in Redis.",
              "Queue writes async so spikes don't block requests.",
              "Autoscale stateless workers behind a load balancer.",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span style={{ color: "#ffa946" }}>✓</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Light "Live transcript" card — speaker-aware lines. */
export function TranscriptMock() {
  return (
    <div className="mx-auto w-full max-w-[22.5rem] overflow-hidden rounded-[24px] border-2 border-[#1a1a1a] bg-[#f3f4f6] text-[#222222]">
      <WindowBar label="Live transcript" />
      <div className="space-y-2.5 p-4">
        <div className="flex items-center justify-between">
          <LiveChip light />
          <Wave forest />
        </div>
        <Line who="Them" text="What's your timeline for the rollout?" />
        <Line who="You" text="Phase one ships in two weeks…" />
        <Line who="Speaker 2" text="Can we pull that forward?" />
      </div>
    </div>
  );
}

function Line({ who, text }: { who: "Them" | "You" | "Speaker 2"; text: string }) {
  const style =
    who === "You"
      ? { background: "#f0d7ff", color: "#1a1a1a" }
      : who === "Speaker 2"
        ? { background: "#eef0e2", color: "#034f46" }
        : { background: "#e5e7eb", color: "#222222" };
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-2xs font-semibold"
        style={style}
      >
        {who}
      </span>
      <p className="flex-1 text-sm">{text}</p>
    </div>
  );
}

/** Light "Files & Resume" card — résumé grounding. */
export function FilesMock() {
  return (
    <div className="mx-auto w-full max-w-[22.5rem] overflow-hidden rounded-[24px] border-2 border-[#1a1a1a] bg-[#f3f4f6] text-[#222222]">
      <WindowBar label="Files & Resume" />
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between rounded-xl border-2 border-[#1a1a1a] px-3 py-2 text-sm">
          <span className="font-medium">resume.pdf</span>
          <span className="rounded-full bg-[#034f46] px-2 py-0.5 text-2xs font-semibold text-[#f3f4f6]">
            On
          </span>
        </div>
        <div className="rounded-2xl border-2 border-[#1a1a1a] p-3">
          <div className="mb-1.5 text-xs font-semibold text-[#034f46]">
            From your résumé
          </div>
          <ul className="space-y-1 text-sm">
            {[
              "Led payments migration at Stripe.",
              "Cut p99 latency 40% on checkout.",
              "Mentored 4 engineers to promotion.",
            ].map((t) => (
              <li key={t} className="flex gap-1.5">
                <span style={{ color: "#034f46" }}>✓</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Light "Set up your interview" card — pick a company + focus, then start. */
export function PracticePickMock() {
  return (
    <div className="mx-auto w-full max-w-[22.5rem] overflow-hidden rounded-[24px] border-2 border-[#1a1a1a] bg-[#f3f4f6] text-[#222222]">
      <WindowBar label="Set up your interview" />
      <div className="space-y-3 p-4">
        <div>
          <div className="mb-1.5 text-xs font-semibold text-[#034f46]">
            Company
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip label="Google" selected />
            <Chip label="Meta" />
            <Chip label="Amazon" />
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-[#034f46]">Focus</div>
          <div className="flex flex-wrap gap-1.5">
            <Chip label="Coding" selected />
            <Chip label="System design" />
            <Chip label="Behavioral" />
            <Chip label="Product" />
          </div>
        </div>
        <div className="flex justify-end pt-0.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#034f46] px-3.5 py-1.5 text-xs font-semibold text-[#f3f4f6]">
            Start practice →
          </span>
        </div>
      </div>
    </div>
  );
}

/** Dark editor card — answer in any format (behavioral / coding / system design). */
export function AnswerFormatsMock() {
  return (
    <div className="mx-auto w-full max-w-[22.5rem] overflow-hidden rounded-[24px] border-2 border-[#1a1a1a] bg-[#f3f4f6] text-[#222222]">
      <WindowBar label="Your answer" />
      <div className="space-y-2.5 p-4">
        <div className="flex flex-wrap gap-1.5">
          <Chip label="Behavioral" />
          <Chip label="Coding" selected />
          <Chip label="System design" />
        </div>
        <div className="rounded-xl border-2 border-[#1a1a1a] bg-[#0d1117] p-3 font-mono text-2xs leading-relaxed text-[#c9d1d9]">
          <div>
            <span className="text-[#ff7b72]">function</span>{" "}
            <span className="text-[#d2a8ff]">twoSum</span>(nums, target) {"{"}
          </div>
          <div className="pl-3">
            <span className="text-[#ff7b72]">const</span> seen ={" "}
            <span className="text-[#ff7b72]">new</span> Map();
          </div>
          <div className="pl-3 text-[#8b949e]">// one pass, O(n)</div>
          <div>{"}"}</div>
        </div>
      </div>
    </div>
  );
}

/** Light "Interview practice" card — a mock interview with scored feedback. */
export function InterviewPracticeMock() {
  return (
    <div className="mx-auto w-full max-w-[22.5rem] overflow-hidden rounded-[24px] border-2 border-[#1a1a1a] bg-[#f3f4f6] text-[#222222]">
      <WindowBar label="Interview practice" />
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <span
            className="mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-2xs font-semibold"
            style={{ background: "#e5e7eb", color: "#222222" }}
          >
            Interviewer
          </span>
          <p className="flex-1 text-sm">
            Design a URL shortener that scales to 1B links.
          </p>
        </div>
        <div className="rounded-2xl border-2 border-[#1a1a1a] bg-white p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#034f46]">
              Scored feedback
            </span>
            <span className="rounded-full bg-[#034f46] px-2 py-0.5 text-2xs font-semibold text-[#f3f4f6]">
              8 / 10
            </span>
          </div>
          <ul className="space-y-1 text-sm">
            <li className="flex gap-1.5">
              <span style={{ color: "#034f46" }}>✓</span> Clear API and data
              model.
            </li>
            <li className="flex gap-1.5">
              <span style={{ color: "#034f46" }}>✓</span> Handled hashing &amp;
              collisions.
            </li>
            <li className="flex gap-1.5">
              <span style={{ color: "#ffa946" }}>△</span> Add caching for hot
              reads.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Light "Question bank" card — real questions from top companies. */
export function QuestionBankMock() {
  const companies = ["Google", "Meta", "Amazon", "OpenAI"];
  const rows: { cat: string; q: string; tint: string; fg: string }[] = [
    { cat: "Coding", q: "Two-sum in one pass", tint: "#eef0e2", fg: "#034f46" },
    {
      cat: "System design",
      q: "Design a rate limiter",
      tint: "#f0d7ff",
      fg: "#1a1a1a",
    },
    {
      cat: "Product",
      q: "Improve Maps for drivers",
      tint: "#e5e7eb",
      fg: "#222222",
    },
  ];
  return (
    <div className="mx-auto w-full max-w-[22.5rem] overflow-hidden rounded-[24px] border-2 border-[#1a1a1a] bg-[#f3f4f6] text-[#222222]">
      <WindowBar label="Question bank" />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {companies.map((c) => (
            <span
              key={c}
              className="rounded-full bg-[#e5e7eb] px-2.5 py-1 text-2xs font-semibold text-[#222222]"
            >
              {c}
            </span>
          ))}
          <span className="text-2xs font-medium text-[#8a8a80]">
            + hundreds
          </span>
        </div>
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.q}
              className="flex items-center gap-2 rounded-xl border-2 border-[#1a1a1a] bg-white px-3 py-2"
            >
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-3xs font-semibold"
                style={{ background: r.tint, color: r.fg }}
              >
                {r.cat}
              </span>
              <span className="truncate text-sm">{r.q}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Light "screen share" card for the onboarding privacy step — the same call
 * that's happening on your screen, seen from the other side.
 *
 * `hidden` mirrors Privacy Mode, so flipping the choice redraws the overlay as
 * a dashed ghost instead of a real panel. Showing the difference is the whole
 * point: "content protection" means nothing until you see the window vanish
 * from what the interviewer is looking at.
 */
export function PrivacyMock({ hidden }: { hidden: boolean }) {
  return (
    <div className="mx-auto w-full max-w-[22.5rem] overflow-hidden rounded-[24px] border-2 border-[#1a1a1a] bg-[#f3f4f6] text-[#222222]">
      <WindowBar label="What they see on your screen" />
      <div className="space-y-2.5 p-3">
        <div className="flex items-center justify-between rounded-full border-2 border-[#1a1a1a] bg-white px-3 py-1.5 text-2xs font-semibold">
          <span className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ background: "#e5484d" }}
            />
            Sharing your screen
          </span>
          <span className="font-medium text-[#8a8a80]">Interview · 24:10</span>
        </div>

        {/* The shared screen, with the floating window sitting on top of it. */}
        {/* `pb` reserves room for the absolutely-positioned window below the
            tiles, so the two never overlap. */}
        <div className="relative overflow-hidden rounded-2xl border-2 border-[#1a1a1a] bg-white p-2.5 pb-[5.5rem]">
          <div className="grid grid-cols-2 gap-2">
            {[
              { who: "Interviewer", tint: "#e5e7eb", fg: "#222222" },
              { who: "You", tint: "#f0d7ff", fg: "#1a1a1a" },
            ].map((t) => (
              <div
                key={t.who}
                className="flex h-12 flex-col items-center justify-center gap-1 rounded-xl"
                style={{ background: t.tint, color: t.fg }}
              >
                <span className="size-5 rounded-full bg-white/70" />
                <span className="text-3xs font-semibold">{t.who}</span>
              </div>
            ))}
          </div>

          {hidden ? (
            <div className="cp-ghost absolute bottom-2.5 left-3 right-3 rounded-[16px] border-2 border-dashed border-[#034f46]/45 bg-[#034f46]/[0.06] p-2.5">
              <div className="flex items-center gap-2 text-2xs font-semibold text-[#034f46]">
                <EyeOffIcon className="size-3.5" />
                Your notes window, not in the share
              </div>
              <div className="mt-1.5 space-y-1" aria-hidden>
                <span className="block h-1.5 w-4/5 rounded-full bg-[#034f46]/15" />
                <span className="block h-1.5 w-3/5 rounded-full bg-[#034f46]/15" />
              </div>
            </div>
          ) : (
            <div className="cp-float absolute bottom-2.5 left-3 right-3 rounded-[16px] bg-[#1a1a1a] p-2.5 text-[#f3f4f6] shadow-lg">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <img src="/app-icon.png" alt="" className="size-4 rounded" />
                  <Wave />
                </div>
                <LiveChip />
              </div>
              <p className="rounded-xl bg-white/[0.08] px-2 py-1 text-2xs leading-snug">
                Shard the DB by tenant; cache hot reads in Redis.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Light "Personas" card — persona grid. */
export function PersonasMock() {
  return (
    <div className="mx-auto w-full max-w-[22.5rem] overflow-hidden rounded-[24px] border-2 border-[#1a1a1a] bg-[#f3f4f6] text-[#222222]">
      <WindowBar label="Personas" />
      <div className="p-4">
        <p className="mb-3 text-xs text-[#8a8a80]">
          Layer a persona on top of the system prompt.
        </p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl border-2 border-[#1a1a1a] bg-[#f0d7ff] px-3 py-2 font-medium">
            Interview coach ✓
          </div>
          {["Behavioral", "System design", "Coding"].map((p) => (
            <div
              key={p}
              className="rounded-xl border-2 border-[#1a1a1a] px-3 py-2 font-medium text-[#222222]"
            >
              {p}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── The full interview loop (the "Full loop" tab's how-it-works) ────────────
   Four cards that tell the loop in order: pick the role, choose the rounds, sit
   one round against its clock, get the committee's call. These carry the small
   staggered animations (`cp-pop`, `cp-drain`, `cp-fill`) because the whole point
   of the loop is that it *progresses* — a still picture of a checklist doesn't
   say "these happen one after another, each on its own clock".            */

/** Light "Start a loop" card — the role you're interviewing for. */
export function LoopRoleMock() {
  const roles: { label: string; sub: string; selected?: boolean }[] = [
    { label: "Senior Software Engineer", sub: "7 rounds · 5h 30m", selected: true },
    { label: "Data Scientist", sub: "6 rounds · 4h 45m" },
    { label: "Product Manager", sub: "6 rounds · 4h 30m" },
  ];
  return (
    <div className="mx-auto w-full max-w-[22.5rem] overflow-hidden rounded-[24px] border-2 border-[#1a1a1a] bg-[#f3f4f6] text-[#222222]">
      <WindowBar label="Start a loop" />
      <div className="space-y-2 p-4">
        <p className="text-xs text-[#8a8a80]">
          Pick the role and level you're interviewing for.
        </p>
        {roles.map((r, i) => (
          <div
            key={r.label}
            className={`cp-pop flex items-center justify-between gap-2 rounded-xl border-2 border-[#1a1a1a] px-3 py-2 ${
              r.selected ? "bg-[#f0d7ff]" : "bg-white"
            }`}
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {r.label}
              </span>
              <span className="block text-3xs text-[#8a8a80]">{r.sub}</span>
            </span>
            {r.selected ? (
              <span className="shrink-0 text-sm font-bold text-[#034f46]">✓</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Light "Choose your rounds" card — the checklist ticking itself off. */
export function LoopRoundsMock() {
  const rounds: { label: string; mins: string; on: boolean }[] = [
    { label: "Recruiter screen", mins: "30m", on: true },
    { label: "Technical screen", mins: "45m", on: true },
    { label: "Coding", mins: "60m", on: true },
    { label: "System design", mins: "60m", on: true },
    { label: "Behavioral", mins: "45m", on: false },
    { label: "Hiring manager", mins: "45m", on: true },
  ];
  return (
    <div className="mx-auto w-full max-w-[22.5rem] overflow-hidden rounded-[24px] border-2 border-[#1a1a1a] bg-[#f3f4f6] text-[#222222]">
      <WindowBar label="Choose your rounds" />
      <div className="space-y-2 p-4">
        <div className="space-y-1.5">
          {rounds.map((r, i) => (
            <div
              key={r.label}
              className="flex items-center gap-2 rounded-lg border-2 border-[#1a1a1a] bg-white px-2.5 py-1.5"
            >
              <span
                className={`cp-pop grid size-4 shrink-0 place-items-center rounded border-2 border-[#1a1a1a] text-3xs font-bold ${
                  r.on ? "bg-[#034f46] text-[#f3f4f6]" : "bg-white text-transparent"
                }`}
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                ✓
              </span>
              <span className="flex-1 truncate text-sm">{r.label}</span>
              <span className="shrink-0 text-3xs font-semibold text-[#8a8a80]">
                {r.mins}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-0.5">
          <span className="text-2xs font-semibold text-[#034f46]">
            5 of 6 rounds · 4h
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#034f46] px-3 py-1.5 text-2xs font-semibold text-[#f3f4f6]">
            Start loop →
          </span>
        </div>
      </div>
    </div>
  );
}

/** Dark-accent "round in progress" card — one round, one clock, no pause. */
export function LoopClockMock() {
  return (
    <div className="mx-auto w-full max-w-[22.5rem] overflow-hidden rounded-[24px] border-2 border-[#1a1a1a] bg-[#f3f4f6] text-[#222222]">
      <WindowBar label="System design · in progress" />
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-[#f0d7ff] px-2.5 py-1 text-2xs font-semibold text-[#1a1a1a]">
            Round 4 of 6
          </span>
          <span className="rounded-full bg-[#1a1a1a] px-2.5 py-1 font-mono text-2xs font-semibold text-[#f3f4f6]">
            41:08 left
          </span>
        </div>
        {/* The clock is a wall clock, not a timer — the bar drains whether or
            not you're in the room, which is exactly the thing to show. */}
        <div className="h-1.5 overflow-hidden rounded-full bg-[#e5e7eb]">
          <div className="cp-drain h-full rounded-full bg-[#034f46]" />
        </div>
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0 rounded-full bg-[#e5e7eb] px-2.5 py-1 text-2xs font-semibold">
            Interviewer
          </span>
          <p className="flex-1 text-sm">
            Design a URL shortener that scales to 1B links.
          </p>
        </div>
        <p className="text-3xs font-medium text-[#8a8a80]">
          Can't be paused. Closing the app doesn't stop the clock.
        </p>
      </div>
    </div>
  );
}

/** Light "Decision" card — per-round grades plus the committee's one call. */
export function LoopVerdictMock() {
  const rounds: { label: string; score: number }[] = [
    { label: "Technical screen", score: 4 },
    { label: "Coding", score: 5 },
    { label: "System design", score: 4 },
    { label: "Behavioral", score: 3 },
  ];
  return (
    <div className="mx-auto w-full max-w-[22.5rem] overflow-hidden rounded-[24px] border-2 border-[#1a1a1a] bg-[#f3f4f6] text-[#222222]">
      <WindowBar label="The decision" />
      <div className="space-y-2.5 p-4">
        {rounds.map((r, i) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate text-2xs font-medium">
              {r.label}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e5e7eb]">
              <span
                className="cp-fill block h-full rounded-full bg-[#034f46]"
                style={{
                  ["--cp-fill-to" as string]: `${r.score * 20}%`,
                  animationDelay: `${i * 0.12}s`,
                }}
              />
            </span>
            <span className="w-6 shrink-0 text-right text-2xs font-semibold tabular-nums">
              {r.score}/5
            </span>
          </div>
        ))}
        <div
          className="cp-pop flex items-center justify-between gap-2 rounded-xl border-2 border-[#1a1a1a] bg-[#eef0e2] px-3 py-2"
          style={{ animationDelay: "0.5s" }}
        >
          <span className="text-sm font-semibold text-[#034f46]">Hire</span>
          <span className="text-3xs font-medium text-[#8a8a80]">
            Across all 6 rounds
          </span>
        </div>
      </div>
    </div>
  );
}
