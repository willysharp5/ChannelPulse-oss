import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button, toast } from "@/components";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageLayout } from "@/layouts";
import {
  deleteInterviewResult,
  listInterviewResults,
  listInterviewTemplates,
  type InterviewTemplate,
  type SavedInterviewResult,
} from "@/lib/interview";
import { cancelSpeech } from "@/lib/tts";
import { onSyncedKeys } from "@/lib/sync/kv";
import { STORAGE_KEYS } from "@/config";
import { cn } from "@/lib/utils";
import { LogOut, CircleHelpIcon } from "lucide-react";
import {
  AssessmentReport,
  BankUnavailableNotice,
  CompanyBank,
  PracticeIntro,
  openPracticeIntro,
  PracticeSession,
  PracticeUpsellBanner,
  ResultsScreen,
  RoleBank,
  SetupScreen,
} from "./components";
import { LoopScreen } from "./components/loop";
import { useAuth } from "@/contexts";

type PracticeTab = "practice" | "loop" | "companies" | "roles" | "results";

const InterviewPractice = () => {
  const [activeTemplate, setActiveTemplate] =
    useState<InterviewTemplate | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [tab, setTab] = useState<PracticeTab>("practice");
  const [viewingResult, setViewingResult] =
    useState<SavedInterviewResult | null>(null);
  // True while a loop round is in the room — the tab bar is hidden so the
  // candidate can't wander off mid-interview by mistake (the clock is running).
  const [loopInRoom, setLoopInRoom] = useState(false);
  // Bumped when a sync pull brings newer interview data (results/loops/
  // templates/progress) from another device, so the list screens remount and
  // re-read localStorage. Skipped while a loop round is live (clock running).
  const [syncTick, setSyncTick] = useState(0);
  const location = useLocation();
  // The company / role tabs read the question bank over the network. With no
  // backend configured there is nothing behind them (see BankUnavailableNotice).
  const { configured: bankAvailable } = useAuth();

  // ChannelPulse OSS is free: graded rounds run against the user's own local /
  // BYOK provider, so there's nothing to gate. Kept as a function returning true
  // because child screens call it through `onGuard` before starting a round.
  const allowInterview = () => true;
  const startPractice = (tpl: InterviewTemplate) => {
    if (allowInterview()) setActiveTemplate(tpl);
  };

  useEffect(() => {
    return onSyncedKeys(
      [
        STORAGE_KEYS.INTERVIEW_RESULTS,
        STORAGE_KEYS.INTERVIEW_LOOPS,
        STORAGE_KEYS.INTERVIEW_TEMPLATES,
        STORAGE_KEYS.INTERVIEW_TEMPLATE_OVERRIDES,
        STORAGE_KEYS.INTERVIEW_QUESTION_CYCLE,
      ],
      () => {
        if (!loopInRoom) setSyncTick((t) => t + 1);
      }
    );
  }, [loopInRoom]);

  // Deep-link: the Dashboard (or elsewhere) can open a specific saved result
  // directly by navigating here with `state.resultId`. Open its report if found,
  // else land on the Results tab.
  useEffect(() => {
    const resultId = (location.state as { resultId?: string } | null)?.resultId;
    if (!resultId) return;
    const found = listInterviewResults().find((r) => r.id === resultId);
    if (found) setViewingResult(found);
    else setTab("results");
    // Clear the handoff state so tab switches / back-nav don't reopen it.
    window.history.replaceState({}, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exitSession = () => {
    // Stop any in-progress interviewer speech immediately on exit.
    cancelSpeech();
    setActiveTemplate(null);
  };

  // Rebuild a runnable template from a saved result so "Practice again" always
  // works — even when the original template was deleted or the session came
  // from the company/role bank (whose id isn't in listInterviewTemplates()).
  const buildTemplateFromResult = (
    r: SavedInterviewResult
  ): InterviewTemplate => {
    const customQuestions: string[] = [];
    const customQuestionCategories: string[] = [];
    for (const t of r.turns) {
      const q = (t.question || "").trim();
      if (!q) continue;
      customQuestions.push(q);
      customQuestionCategories.push(
        t.coding ? "coding" : t.design ? "system_design" : "behavioral"
      );
    }
    return {
      id: `result-${r.id}`,
      title: r.templateTitle || "Practice",
      category: "general",
      mode: "job_interview",
      roleLevel: r.templateTitle || "General role",
      focusAreas: [],
      difficulty: "medium",
      voice: "nova",
      notes: "",
      productContext: "",
      customQuestions,
      customQuestionCategories,
      bankQuestionIds: r.bankQuestionIds,
      answerMode: "spoken",
      builtIn: false,
    };
  };

  const practiceAgain = (r: SavedInterviewResult) => {
    const tpl =
      listInterviewTemplates().find((t) => t.id === r.templateId) ??
      buildTemplateFromResult(r);
    setViewingResult(null);
    setActiveTemplate(tpl);
    setSessionKey((k) => k + 1);
  };

  // ── Active practice session ──────────────────────────────────────────────
  if (activeTemplate) {
    return (
      <PageLayout
        title="Interview Practice"
        description="Practice realistic job interviews with an AI interviewer, then get scored feedback and model answers for every question."
        rightSlot={
          <Button
            size="sm"
            variant="destructive"
            onClick={exitSession}
            title="Exit practice session"
          >
            <LogOut className="h-4 w-4" />
            Exit
          </Button>
        }
      >
        <PracticeSession
          key={`${activeTemplate.id}-${sessionKey}`}
          template={activeTemplate}
          onExit={exitSession}
          onRestart={() => setSessionKey((k) => k + 1)}
        />
      </PageLayout>
    );
  }

  // ── Viewing a saved result ───────────────────────────────────────────────
  if (viewingResult) {
    return (
      <PageLayout
        title="Interview Practice"
        description="Your saved practice results. Review feedback and answers anytime."
      >
        <AssessmentReport
          assessment={viewingResult.assessment}
          templateTitle={viewingResult.templateTitle}
          coding={viewingResult.turns.some((t) => !!t.coding || !!t.design)}
          onDelete={() => {
            deleteInterviewResult(viewingResult.id);
            setViewingResult(null);
            setTab("results");
            toast("Result deleted");
          }}
          onBackToSetup={() => setViewingResult(null)}
          onPracticeAgain={() => practiceAgain(viewingResult)}
        />
      </PageLayout>
    );
  }

  // ── Landing: Practice / Results tabs ─────────────────────────────────────
  return (
    <PageLayout
      title="Interview Practice"
      description="Practice job interviews, then review saved results with feedback and answers."
    >
      <div
        className={cn(
          "sticky top-0 z-30 -mx-1 flex items-center justify-between gap-2 bg-background px-1 pb-2 pt-1",
          loopInRoom && "hidden"
        )}
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as PracticeTab)}>
          <TabsList>
            <TabsTrigger value="practice">Practice</TabsTrigger>
            <TabsTrigger value="loop">Full loop</TabsTrigger>
            <TabsTrigger value="companies">By company</TabsTrigger>
            <TabsTrigger value="roles">By role</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "practice" && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 text-muted-foreground"
            onClick={openPracticeIntro}
            title="Show how ChannelPulse works"
          >
            <CircleHelpIcon className="size-4" />
            How it works
          </Button>
        )}
      </div>

      {/* One dismissible line about the hosted app. Above the tab content so it
          isn't tied to a tab, and never in the way of starting a round. */}
      {!loopInRoom && <PracticeUpsellBanner />}

      {tab === "practice" ? (
        <>
          <PracticeIntro />
          <SetupScreen key={`setup-${syncTick}`} onStart={startPractice} />
        </>
      ) : tab === "loop" ? (
        <LoopScreen
          key={`loop-${syncTick}`}
          onSessionChange={setLoopInRoom}
          onGuard={allowInterview}
          onViewResult={(resultId) => {
            const found = listInterviewResults().find((r) => r.id === resultId);
            if (found) setViewingResult(found);
            else toast("That round's report is no longer saved");
          }}
        />
      ) : tab === "companies" ? (
        bankAvailable ? (
          <CompanyBank onStart={startPractice} />
        ) : (
          <BankUnavailableNotice what="companies" />
        )
      ) : tab === "roles" ? (
        bankAvailable ? (
          <RoleBank onStart={startPractice} />
        ) : (
          <BankUnavailableNotice what="roles" />
        )
      ) : (
        <ResultsScreen key={`results-${syncTick}`} onView={(r) => setViewingResult(r)} />
      )}
    </PageLayout>
  );
};

export default InterviewPractice;
