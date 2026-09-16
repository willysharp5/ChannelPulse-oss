import {
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { ProfileBuilder } from "@/pages/settings/components/ProfileBuilder";
import { SAMPLE_SYSTEM_PROMPTS } from "@/config/sample-prompts";
import { createSystemPrompt, getAllSystemPrompts } from "@/lib/database";
import { getUserProfile, setUserProfile } from "@/lib/memory";
import { useApp } from "@/contexts";
import { safeLocalStorage } from "@/lib/storage";
import { STORAGE_KEYS } from "@/config";
import {
  DEFAULT_USER_PROFILE,
  DEFAULT_PERSONA_ID,
  setOnboardingComplete,
  persistOnboarding,
} from "@/lib/onboarding";
import {
  SparklesIcon,
  CheckIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  LoaderIcon,
  EyeIcon,
  EyeOffIcon,
  SettingsIcon,
  ChevronRightIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isWeb } from "@/lib/platform";
import {
  OverlayMock,
  InterviewPracticeMock,
  QuestionBankMock,
  FilesMock,
  PersonasMock,
  PrivacyMock,
} from "./AppMocks";

type Step = "welcome" | "profile" | "persona" | "privacy" | "tour";

// Personas are omitted from the web build (see src/routes/web.tsx), so its
// onboarding skips the persona step and the persona showcase slide.
const WEB = isWeb();

const STEPS: Step[] = WEB
  ? ["welcome", "profile", "privacy", "tour"]
  : ["welcome", "profile", "persona", "privacy", "tour"];

/** The persona step sits between Profile and Privacy on desktop only, so on the
 *  web build Profile's Continue/Skip goes straight to Privacy, and Privacy's
 *  Back returns to Profile. */
const AFTER_PROFILE: Step = WEB ? "privacy" : "persona";
const BEFORE_PRIVACY: Step = WEB ? "profile" : "persona";

/**
 * Visual showcase for the final onboarding step — reuses the landing page's
 * animated diagrams so the "what is this app" story is shown, not told.
 */
const SHOWCASE: { node: ReactNode; title: string; caption: string }[] = [
  {
    node: <OverlayMock />,
    title: "Your live interview coach",
    caption:
      "It hears the question and hands you a quick talking point to work from.",
  },
  {
    node: <InterviewPracticeMock />,
    title: "Practice with scored feedback",
    caption:
      "Run mock interviews that grade your answers and show model responses.",
  },
  {
    node: <QuestionBankMock />,
    title: "Real questions, top companies",
    caption:
      "Coding, system design, behavioral & PM, from hundreds of companies.",
  },
  {
    node: <FilesMock />,
    title: "Grounded in your résumé",
    caption: "Answers pull from your real background and files.",
  },
  // Persona showcase slide is desktop-only — personas don't exist on the web build.
  ...(WEB
    ? []
    : [
        {
          node: <PersonasMock />,
          title: "Tuned to your scenario",
          caption: "Behavioral, system design, coding. Pick a persona.",
        },
      ]),
];

// ── Landing-styled controls (self-contained palette: forest / ink / silver) ──

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement>;

const PrimaryBtn = ({ className, ...p }: BtnProps) => (
  <button
    {...p}
    className={cn(
      "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full bg-[#034f46] px-5 py-2.5 text-sm font-semibold text-[#f3f4f6] shadow-sm transition-all hover:bg-[#023a34] disabled:cursor-not-allowed disabled:opacity-60",
      className
    )}
  />
);

const OutlineBtn = ({ className, ...p }: BtnProps) => (
  <button
    {...p}
    className={cn(
      "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full border-2 border-[#1a1a1a]/15 bg-white px-4 py-2 text-sm font-medium text-[#222222] transition-colors hover:border-[#1a1a1a]/35 disabled:opacity-60",
      className
    )}
  />
);

const TextBtn = ({ className, ...p }: BtnProps) => (
  <button
    {...p}
    className={cn(
      "cursor-pointer text-sm font-medium text-[#8a8a80] transition-colors hover:text-[#222222] disabled:opacity-60",
      className
    )}
  />
);

const Eyebrow = ({ children }: { children: ReactNode }) => (
  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#034f46]">
    {children}
  </span>
);

/**
 * One of the two privacy choices — same selectable-card language as the persona
 * grid, so "pick one" reads the same way twice.
 */
const PrivacyChoice = ({
  icon: Icon,
  title,
  body,
  active,
  badge,
  onClick,
}: {
  icon: typeof EyeIcon;
  title: string;
  body: string;
  active: boolean;
  badge?: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      "flex cursor-pointer flex-col gap-1.5 rounded-2xl border-2 p-3.5 text-left transition-colors",
      active
        ? "border-[#034f46] bg-[#034f46]/[0.06]"
        : "border-[#1a1a1a]/10 bg-white hover:border-[#034f46]/40"
    )}
  >
    <div className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-[#034f46]" />
      <span className="text-sm font-semibold">{title}</span>
      {active ? (
        <CheckIcon className="ml-auto size-4 shrink-0 text-[#034f46]" />
      ) : (
        badge && (
          <span className="ml-auto shrink-0 rounded-full bg-[#f0d7ff] px-2 py-0.5 text-3xs font-medium text-[#1a1a1a]">
            {badge}
          </span>
        )
      )}
    </div>
    <p className="text-xs leading-snug text-[#8a8a80]">{body}</p>
  </button>
);

const Bullet = ({ children }: { children: ReactNode }) => (
  <li className="flex items-start gap-2.5">
    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#034f46]/10 text-[#034f46]">
      <CheckIcon className="size-3" />
    </span>
    <span>{children}</span>
  </li>
);

/**
 * First-run setup, styled to match the marketing site (EB Garamond display
 * headings, forest/silver palette, soft entrance animations). Required before
 * using the app: the user sets up their profile (AI-assisted) and picks a
 * persona. Either step can be skipped, applying sensible interview defaults.
 */
export const Onboarding = () => {
  const { setSystemPrompt, customizable, togglePrivacyMode } = useApp();
  const [step, setStep] = useState<Step>("welcome");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [profileSet, setProfileSet] = useState(
    () => !!getUserProfile().trim()
  );
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [tourIndex, setTourIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);

  const applyPersona = async (presetId: string) => {
    const preset =
      SAMPLE_SYSTEM_PROMPTS.find((p) => p.id === presetId) ??
      SAMPLE_SYSTEM_PROMPTS.find((p) => p.id === DEFAULT_PERSONA_ID);
    if (!preset) return;
    // Reuse an existing persona with the same name instead of creating a
    // duplicate every time onboarding runs — otherwise personas pile up.
    const existing = (await getAllSystemPrompts()).find(
      (p) => p.name.trim().toLowerCase() === preset.title.trim().toLowerCase()
    );
    const chosen =
      existing ??
      (await createSystemPrompt({
        name: preset.title,
        prompt: preset.prompt,
      }));
    setSystemPrompt(chosen.prompt);
    safeLocalStorage.setItem(STORAGE_KEYS.SYSTEM_PROMPT, chosen.prompt);
    safeLocalStorage.setItem(
      STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID,
      String(chosen.id)
    );
  };

  const finish = async () => {
    setFinishing(true);
    try {
      // Profile: fall back to the default if the user skipped / left it empty.
      if (!getUserProfile().trim()) {
        setUserProfile(DEFAULT_USER_PROFILE);
      }
      // Persona: chosen preset, or the meeting/interview default. Skipped on the
      // web build (no personas there) — the copilot uses generic guidance.
      if (!WEB) {
        await applyPersona(selectedPersona ?? DEFAULT_PERSONA_ID);
      }
      setOnboardingComplete(true);
      void persistOnboarding(true);
    } catch (err) {
      console.error("Onboarding finish failed:", err);
      // Still complete so the user isn't stuck; defaults are best-effort.
      setOnboardingComplete(true);
      void persistOnboarding(true);
    } finally {
      setFinishing(false);
    }
  };

  // The live setting is the single source of truth — `togglePrivacyMode` applies
  // it to the window and stores it, so the choice sticks however onboarding ends.
  const privacyOn = customizable.privacyMode.isEnabled;

  const activeIdx = STEPS.indexOf(step);
  const maxW =
    step === "welcome"
      ? "max-w-4xl"
      : step === "privacy"
        ? "max-w-3xl"
        : step === "tour"
          ? "max-w-xl"
          : "max-w-lg";

  return (
    <div className="flex min-h-screen w-screen justify-center overflow-y-auto bg-[#f3f4f6] p-6 text-[#1a1a1a] sm:p-10">
      <div
        className="absolute left-0 right-0 top-0 z-50 h-10 select-none"
        data-tauri-drag-region={true}
      />
      <div className={cn("my-auto w-full space-y-7", maxW)}>
        {/* Progress */}
        <div className="flex items-center justify-center gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={cn(
                "h-1 w-10 rounded-full transition-colors",
                i <= activeIdx ? "bg-[#034f46]" : "bg-[#1a1a1a]/10"
              )}
            />
          ))}
        </div>

        {/* ── Welcome ─────────────────────────────────────────────────────── */}
        {step === "welcome" && (
          <div className="cp-reveal grid items-center gap-8 md:grid-cols-2">
            <div className="space-y-5">
              <Eyebrow>Welcome · about a minute</Eyebrow>
              <h1 className="cp-display text-[clamp(30px,5vw,46px)] font-normal leading-[1.02] tracking-[-0.5px]">
                Your AI interview
                <br />
                notetaker &amp; coach
              </h1>
              <ul className="space-y-2.5 text-base leading-snug text-[#222222]">
                <Bullet>
                  <strong>Hears the question</strong>: live notes and talking
                  points appear as you go.
                </Bullet>
                <Bullet>
                  <strong>Grounded in you</strong>: pulls from your résumé,
                  files, and profile.
                </Bullet>
                <Bullet>
                  <strong>Practice &amp; game day</strong>: mock interviews with
                  feedback, then live coaching for real.
                </Bullet>
              </ul>
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <PrimaryBtn onClick={() => setStep("profile")}>
                  Let's set you up
                  <ArrowRightIcon className="size-4" />
                </PrimaryBtn>
                <TextBtn onClick={finish} disabled={finishing}>
                  {finishing ? "Setting up…" : "Skip, use defaults"}
                </TextBtn>
              </div>
            </div>
            <div className="flex justify-center">
              <OverlayMock />
            </div>
          </div>
        )}

        {/* ── Profile ─────────────────────────────────────────────────────── */}
        {step === "profile" && (
          <div className="cp-reveal space-y-6 rounded-[28px] border-2 border-[#1a1a1a]/10 bg-white p-6 shadow-sm sm:p-8">
            <div className="space-y-2 text-center">
              <Eyebrow>Step 1 · about you</Eyebrow>
              <h1 className="cp-display text-[1.75rem] font-normal leading-tight">
                Tell it about you
              </h1>
              <p className="mx-auto max-w-md text-sm text-[#8a8a80]">
                Used as background in <strong>every</strong> answer: your role,
                what you're working on, and how you like responses.
              </p>
            </div>

            <div
              className={cn(
                "flex flex-col items-center gap-3 rounded-2xl border-2 bg-[#f3f4f6] p-6 text-center transition-colors",
                profileSet ? "border-[#1a1a1a]/10" : "border-[#034f46]/40"
              )}
            >
              {profileSet ? (
                <p className="flex items-center gap-1.5 text-sm font-medium text-[#034f46]">
                  <CheckIcon className="size-4" />
                  Profile ready
                </p>
              ) : (
                <>
                  <span className="rounded-full bg-[#034f46]/10 px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-[#034f46]">
                    Recommended first
                  </span>
                  <p className="text-sm text-[#8a8a80]">
                    A few guided questions; AI turns your answers into a clean
                    profile so responses sound like <strong>you</strong>.
                  </p>
                </>
              )}
              {profileSet ? (
                <OutlineBtn onClick={() => setBuilderOpen(true)}>
                  <SparklesIcon className="size-4" />
                  Edit my profile
                </OutlineBtn>
              ) : (
                <PrimaryBtn className="cp-attention" onClick={() => setBuilderOpen(true)}>
                  <SparklesIcon className="size-4" />
                  Build my profile with AI
                </PrimaryBtn>
              )}
            </div>

            <div className="flex items-center justify-between">
              <TextBtn
                className="inline-flex items-center gap-1.5"
                onClick={() => setStep("welcome")}
              >
                <ArrowLeftIcon className="size-3.5" />
                Back
              </TextBtn>
              <div className="flex items-center gap-3">
                <TextBtn onClick={() => setStep(AFTER_PROFILE)}>Skip</TextBtn>
                {profileSet ? (
                  <PrimaryBtn onClick={() => setStep(AFTER_PROFILE)}>
                    Continue
                    <ArrowRightIcon className="size-4" />
                  </PrimaryBtn>
                ) : (
                  // De-emphasized until the profile is built — still clickable,
                  // but blurred/faded so building comes first.
                  <OutlineBtn
                    className="opacity-50 blur-[1px] transition-all hover:opacity-100 hover:blur-0"
                    title="Build your profile first for richer, personalized answers"
                    onClick={() => setStep(AFTER_PROFILE)}
                  >
                    Continue
                    <ArrowRightIcon className="size-4" />
                  </OutlineBtn>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Persona ─────────────────────────────────────────────────────── */}
        {step === "persona" && (
          <div className="cp-reveal space-y-6 rounded-[28px] border-2 border-[#1a1a1a]/10 bg-white p-6 shadow-sm sm:p-8">
            <div className="space-y-2 text-center">
              <Eyebrow>Step 2 · how it helps</Eyebrow>
              <h1 className="cp-display text-[1.75rem] font-normal leading-tight">
                Pick how it should help
              </h1>
              <p className="mx-auto max-w-md text-sm text-[#8a8a80]">
                Choose a persona. You can change or add more later under
                Personas.
              </p>
            </div>

            <div className="grid max-h-[44vh] grid-cols-1 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2">
              {SAMPLE_SYSTEM_PROMPTS.map((preset) => {
                const Icon = preset.icon;
                const active = selectedPersona === preset.id;
                const isDefault = preset.id === DEFAULT_PERSONA_ID;
                return (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedPersona(preset.id)}
                    className={cn(
                      "flex cursor-pointer flex-col gap-1.5 rounded-2xl border-2 p-3.5 text-left transition-colors",
                      active
                        ? "border-[#034f46] bg-[#034f46]/[0.06]"
                        : "border-[#1a1a1a]/10 bg-white hover:border-[#034f46]/40"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 text-[#034f46]" />
                      <span className="text-sm font-semibold">
                        {preset.title}
                      </span>
                      {active && (
                        <CheckIcon className="ml-auto size-4 text-[#034f46]" />
                      )}
                      {!active && isDefault && (
                        <span className="ml-auto rounded-full bg-[#f0d7ff] px-2 py-0.5 text-3xs font-medium text-[#1a1a1a]">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#8a8a80]">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between">
              <TextBtn
                className="inline-flex items-center gap-1.5"
                onClick={() => setStep("profile")}
                disabled={finishing}
              >
                <ArrowLeftIcon className="size-3.5" />
                Back
              </TextBtn>
              <PrimaryBtn onClick={() => setStep("privacy")}>
                Continue
                <ArrowRightIcon className="size-4" />
              </PrimaryBtn>
            </div>
          </div>
        )}

        {/* ── Privacy ─────────────────────────────────────────────────────── */}
        {step === "privacy" && (
          <div className="cp-reveal space-y-4 rounded-[28px] border-2 border-[#1a1a1a]/10 bg-white p-5 shadow-sm sm:p-6">
            <div className="space-y-1 text-center">
              <Eyebrow>Step 3 · privacy</Eyebrow>
              <h1 className="cp-display text-[1.625rem] font-normal leading-tight">
                Who else sees the window?
              </h1>
              <p className="mx-auto max-w-md text-sm text-[#8a8a80]">
                On a call, the floating window sits on your screen. Decide
                whether it's part of what you share.
              </p>
            </div>

            {/* Diagram beside the choices, not above them: stacked, this step
                ran taller than a short window and pushed Continue out of sight. */}
            <div className="grid items-center gap-4 sm:grid-cols-2">
              {/* Re-keyed so the diagram replays its entrance when the choice
                  changes — the point is to see the window appear or vanish. */}
              <div
                key={privacyOn ? "hidden" : "visible"}
                className="cp-reveal flex justify-center"
              >
                <PrivacyMock hidden={privacyOn} />
              </div>

              <div className="space-y-2.5">
                <PrivacyChoice
                  icon={EyeIcon}
                  title="Visible"
                  badge="Default"
                  active={!privacyOn}
                  onClick={() => void togglePrivacyMode(false)}
                  body="Behaves like any normal app window; it shows up in screen shares, recordings, and your dock/taskbar."
                />
                <PrivacyChoice
                  icon={EyeOffIcon}
                  title="Hidden from shares"
                  active={privacyOn}
                  onClick={() => void togglePrivacyMode(true)}
                  body="Kept out of screen shares and recordings, and its dock/taskbar icon hides while the window is tucked away."
                />

                {/* Collapsed by default: the cards already say what each option
                    does, so the detail is one click away instead of costing the
                    height Continue needs. */}
                <details className="group/why rounded-xl bg-[#f3f4f6] px-3.5 py-2 text-xs">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-[#034f46]">
                    <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-open/why:rotate-90" />
                    What this means during a call
                  </summary>
                  <div className="mt-2 space-y-2 leading-relaxed text-[#222222]">
                    <p>
                      Either way the app never joins as a bot and never appears
                      in the participant list; nobody is told it's running. What
                      changes is your own screen: with <strong>Hidden</strong>{" "}
                      on, the window is left out of screen shares and recordings,
                      so if you share your screen the interviewer sees your
                      slides or editor and not your notes.
                    </p>
                    <p className="text-[#8a8a80]">
                      It's still fully visible to you, and it doesn't hide the
                      window from someone sitting next to you. Exclusion is
                      per-window, so nothing else on your screen is affected.
                      You can flip it mid-call from the eye button in the
                      floating window's toolbar.
                    </p>
                  </div>
                </details>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-y-2">
              <TextBtn
                className="inline-flex items-center gap-1.5"
                onClick={() => setStep(BEFORE_PRIVACY)}
              >
                <ArrowLeftIcon className="size-3.5" />
                Back
              </TextBtn>
              {/* On the nav row rather than its own line, so the reassurance
                  costs no height Continue has to fight for. */}
              <span className="order-last flex w-full items-center justify-center gap-1.5 text-2xs text-[#8a8a80] sm:order-none sm:w-auto">
                <SettingsIcon className="size-3 shrink-0" />
                Change it any time; the{" "}
                <EyeOffIcon className="size-3 shrink-0" /> button in the floating
                window, or <strong>Settings → Privacy Mode</strong>
              </span>
              <PrimaryBtn onClick={() => setStep("tour")}>
                Continue
                <ArrowRightIcon className="size-4" />
              </PrimaryBtn>
            </div>
          </div>
        )}

        {/* ── Tour (diagram showcase) ─────────────────────────────────────── */}
        {step === "tour" &&
          (() => {
            const slide = SHOWCASE[tourIndex];
            const last = tourIndex === SHOWCASE.length - 1;
            return (
              <div className="cp-reveal space-y-6 rounded-[28px] border-2 border-[#1a1a1a]/10 bg-white p-6 shadow-sm sm:p-8">
                <div className="text-center">
                  <Eyebrow>A peek inside</Eyebrow>
                </div>

                {/* Landing-style animated diagram */}
                <div key={tourIndex} className="cp-reveal flex justify-center">
                  {slide.node}
                </div>

                <div className="space-y-1.5 text-center">
                  <h2 className="cp-display text-[1.625rem] font-normal leading-tight">
                    {slide.title}
                  </h2>
                  <p className="mx-auto max-w-sm text-sm text-[#8a8a80]">
                    {slide.caption}
                  </p>
                </div>

                {/* Slide indicator */}
                <div className="flex items-center justify-center gap-1.5">
                  {SHOWCASE.map((_, i) => (
                    <button
                      key={i}
                      aria-label={`Slide ${i + 1}`}
                      onClick={() => setTourIndex(i)}
                      className={cn(
                        "size-1.5 cursor-pointer rounded-full transition-colors",
                        i === tourIndex ? "bg-[#034f46]" : "bg-[#1a1a1a]/15"
                      )}
                    />
                  ))}
                </div>

                <div className="flex items-center justify-between">
                  <TextBtn
                    className="inline-flex items-center gap-1.5"
                    disabled={finishing}
                    onClick={() =>
                      tourIndex === 0
                        ? setStep("privacy")
                        : setTourIndex((i) => i - 1)
                    }
                  >
                    <ArrowLeftIcon className="size-3.5" />
                    Back
                  </TextBtn>
                  {last ? (
                    <PrimaryBtn onClick={finish} disabled={finishing}>
                      {finishing ? (
                        <LoaderIcon className="size-4 animate-spin" />
                      ) : (
                        <CheckIcon className="size-4" />
                      )}
                      Get started
                    </PrimaryBtn>
                  ) : (
                    <PrimaryBtn onClick={() => setTourIndex((i) => i + 1)}>
                      Next
                      <ArrowRightIcon className="size-4" />
                    </PrimaryBtn>
                  )}
                </div>
              </div>
            );
          })()}
      </div>

      <ProfileBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        onSaved={(compiled) => {
          setUserProfile(compiled);
          setProfileSet(!!compiled.trim());
        }}
      />
    </div>
  );
};
