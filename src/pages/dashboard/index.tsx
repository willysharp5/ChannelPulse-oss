import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Badge,
  ShowcaseTour,
  PRO_PITCH,
  PRO_PITCH_SEEN_KEY,
} from "@/components";
import { PRICING_URL } from "@/config";
import { safeLocalStorage } from "@/lib/storage";
import { isWeb, openExternal } from "@/lib";
import LiveCoachingPromo from "./components/LiveCoachingPromo";
import { PageLayout } from "@/layouts";
import { useHistory } from "@/hooks";
import { useNavigate } from "react-router-dom";
import moment from "moment";
import {
  HeadphonesIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  ClockIcon,
  CalendarDaysIcon,
  PlusIcon,
  ArrowRightIcon,
  GraduationCapIcon,
  TrophyIcon,
  TargetIcon,
  Building2Icon,
  ListChecksIcon,
  CircleHelpIcon,
} from "lucide-react";
import {
  countCompaniesForQuestions,
  listInterviewResults,
  listInterviewTemplates,
} from "@/lib/interview";

/** Session-length only (created→updated). Cap at ~12h so multi-day threads don't look like talk time. */
const SESSION_MAX_MS = 12 * 60 * 60 * 1000;

const fmtSessionLength = (ms: number): string | null => {
  if (ms < 60_000 || ms > SESSION_MAX_MS) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const history = useHistory();
  const conversations = history.conversations;
  // Live coaching (system-audio capture) is desktop-only. On the web app we
  // swap the "Start listening" CTA for a promo that explains the feature and
  // points to the Mac/Windows download (see LiveCoachingPromo).
  const web = isWeb();

  const [listeningStarted, setListeningStarted] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [pitchOpen, setPitchOpen] = useState(false);

  // First launch opens the pitch for the hosted app, not a tour of this one.
  // Nobody needs to be walked around a dashboard they can see; what they can't
  // see from in here is that there's a managed version of it (PRO_PITCH).
  useEffect(() => {
    if (safeLocalStorage.getItem(PRO_PITCH_SEEN_KEY) !== "1") {
      setPitchOpen(true);
    }
  }, []);

  // Seen once is seen for good, however they leave it — finished, dismissed,
  // Escape or the backdrop. An upsell that reappears is an ad.
  const closePitch = () => {
    setPitchOpen(false);
    safeLocalStorage.setItem(PRO_PITCH_SEEN_KEY, "1");
  };

  // "See plans" hands the pricing page to the browser: checkout can't happen in
  // here, because this build ships without a backend to sell anything.
  const openPricing = () => openExternal(PRICING_URL);

  const stats = useMemo(() => {
    const totalConversations = conversations.length;
    const totalMessages = conversations.reduce(
      (n, c) => n + (c.messageCount || 0),
      0
    );
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thisWeek = conversations.filter((c) => c.updatedAt >= weekAgo).length;
    // Wall-clock "hours talking" is misleading (threads span weeks/years).
    // Days with activity + avg messages are easier to read and honest.
    const activeDays = new Set<string>();
    for (const c of conversations) {
      if (c.updatedAt) {
        activeDays.add(moment(c.updatedAt).format("YYYY-MM-DD"));
      }
    }
    const avgMessages =
      totalConversations > 0
        ? Math.round((totalMessages / totalConversations) * 10) / 10
        : 0;
    return {
      totalConversations,
      totalMessages,
      thisWeek,
      activeDays: activeDays.size,
      avgMessages,
    };
  }, [conversations]);

  const recent = useMemo(
    () =>
      [...conversations]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 2),
    [conversations]
  );

  // The user's own practice progress (local results).
  const practice = useMemo(() => {
    const results = listInterviewResults();
    const scores = results
      .map((r) => r.assessment?.overallScore)
      .filter((n): n is number => typeof n === "number" && n > 0);
    const avgScore = scores.length
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0;
    const questionsPracticed = results.reduce(
      (n, r) => n + (r.turns?.length || 0),
      0
    );
    // Bank question ids the user has actually engaged with — from practiced
    // results AND custom interviews they built from the bank.
    const bankIds = [
      ...results.flatMap((r) => r.bankQuestionIds ?? []),
      ...listInterviewTemplates()
        .filter((t) => !t.builtIn)
        .flatMap((t) => t.bankQuestionIds ?? []),
    ];
    return {
      sessions: results.length,
      avgScore,
      questionsPracticed,
      bankIds,
      recent: results.slice(0, 3),
    };
  }, []);

  // Distinct companies the user has interviews for / has practiced (not the
  // whole bank). Resolved from their engaged bank question ids.
  const [userCompanies, setUserCompanies] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    countCompaniesForQuestions(practice.bankIds)
      .then((n) => {
        if (!cancelled) setUserCompanies(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [practice.bankIds]);

  const startListening = () => {
    // Signal the floating overlay (separate window) to begin capture.
    localStorage.setItem(
      "channelpulse-start-listening",
      JSON.stringify({ t: Date.now() })
    );
    setListeningStarted(true);
    setTimeout(() => setListeningStarted(false), 2500);
  };

  const openInOverlay = (id: string) => {
    localStorage.setItem(
      "channelpulse-conversation-selected",
      JSON.stringify({ id, timestamp: Date.now() })
    );
  };

  const firstUserMessage = (c: (typeof conversations)[number]) =>
    c.firstUserMessage ?? "";

  return (
    <PageLayout
      title="Dashboard"
      description="Your ChannelPulse activity at a glance."
    >
      <div className="space-y-6 pb-4">
        {/* Web app: live coaching is desktop-only — promote the download. */}
        {web && <LiveCoachingPromo />}

        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2">
          {!web && (
            <Button
              data-tour="start-listening"
              onClick={startListening}
              className="gap-2"
            >
              <HeadphonesIcon className="size-4" />
              {listeningStarted ? "Listening started" : "Start listening"}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => navigate("/chats")}
            className="gap-2"
          >
            <MessageSquareIcon className="size-4" />
            All recaps
          </Button>
          <Button
            data-tour="interview-practice"
            variant="outline"
            onClick={() => navigate("/interview-practice")}
            className="gap-2"
          >
            <GraduationCapIcon className="size-4" />
            Interview practice
          </Button>
          {!web && (
            <Button
              data-tour="personas"
              variant="outline"
              onClick={() => navigate("/personas")}
              className="gap-2"
            >
              <PlusIcon className="size-4" />
              Personas
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => setTourOpen(true)}
            className="gap-2 text-muted-foreground"
            title="A quick tour of how ChannelPulse works"
          >
            <CircleHelpIcon className="size-4" />
            How it works
          </Button>
          {!web && listeningStarted && (
            <span className="text-xs text-primary">
              Started in the floating overlay.
            </span>
          )}
        </div>

        {/* Interview practice group */}
        <section className="space-y-4 rounded-xl border border-border/60 bg-muted/30 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <GraduationCapIcon className="size-4 text-primary" />
              Interview practice
            </h2>
            <button
              onClick={() => navigate("/interview-practice")}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Open practice <ArrowRightIcon className="size-3" />
            </button>
          </div>

          {/* Your progress */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              icon={TargetIcon}
              label="Sessions"
              value={practice.sessions}
              hint={
                practice.sessions === 0
                  ? "start your first mock"
                  : "practice sessions completed"
              }
            />
            <StatCard
              icon={TrophyIcon}
              label="Avg score"
              value={practice.avgScore > 0 ? `${practice.avgScore} / 5` : "–"}
              hint={
                practice.avgScore > 0
                  ? "across scored sessions"
                  : "no scored sessions yet"
              }
            />
            <StatCard
              icon={ListChecksIcon}
              label="Questions practiced"
              value={practice.questionsPracticed}
              hint="answers you've worked through"
            />
            <StatCard
              icon={Building2Icon}
              label="Companies"
              value={userCompanies === null ? "…" : userCompanies}
              hint={
                userCompanies
                  ? "you've practiced / prepped"
                  : "start a company interview"
              }
            />
          </div>

          {/* Recent practice results */}
          {practice.recent.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {practice.recent.map((r) => {
                const score = r.assessment?.overallScore ?? 0;
                return (
                  <Card
                    key={r.id}
                    className="cursor-pointer p-3 transition-colors hover:border-primary/50"
                    onClick={() =>
                      navigate("/interview-practice", {
                        state: { resultId: r.id },
                      })
                    }
                  >
                    <p className="line-clamp-1 text-sm font-medium">
                      {r.templateTitle || "Interview"}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      {score > 0 ? (
                        <Badge className="gap-1 text-3xs">
                          <TrophyIcon className="size-3" />
                          {score} / 5
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="gap-1 text-3xs">
                        <ClockIcon className="size-3" />
                        {moment(r.createdAt).fromNow()}
                      </Badge>
                      <Badge variant="outline" className="text-3xs">
                        {r.turns?.length || 0}{" "}
                        {(r.turns?.length || 0) === 1 ? "question" : "questions"}
                      </Badge>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* Conversations group */}
        <section className="space-y-4 rounded-xl border border-border/60 bg-muted/30 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquareIcon className="size-4 text-primary" />
              Conversations
            </h2>
            {conversations.length > 2 && (
              <button
                onClick={() => navigate("/chats")}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                View all <ArrowRightIcon className="size-3" />
              </button>
            )}
          </div>

          {/* Conversation stats */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatCard
              icon={MessageSquareIcon}
              label="Conversations"
              value={stats.totalConversations}
              hint={`${stats.thisWeek} this week`}
            />
            <StatCard
              icon={MessagesSquareIcon}
              label="Messages"
              value={stats.totalMessages}
              hint={
                stats.avgMessages > 0
                  ? `~${stats.avgMessages} avg / conversation`
                  : "across all chats"
              }
            />
            <StatCard
              icon={CalendarDaysIcon}
              label="Days active"
              value={stats.activeDays}
              hint="days with conversation activity"
            />
          </div>

          <p className="text-xs font-medium text-muted-foreground">
            Recent conversations
          </p>

          {recent.length === 0 ? (
            <Card className="border-dashed p-6 text-center">
              <p className="text-sm text-muted-foreground">
                {web ? (
                  <>
                    No conversations yet. Your recaps and practice sessions will
                    show up here.
                  </>
                ) : (
                  <>
                    No conversations yet. Click{" "}
                    <span className="font-medium text-foreground">
                      Start listening
                    </span>{" "}
                    to begin.
                  </>
                )}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {recent.map((c) => {
                const snippet = firstUserMessage(c);
                const sessionLabel = fmtSessionLength(
                  Math.max(0, (c.updatedAt || 0) - (c.createdAt || 0))
                );
                return (
                  <Card
                    key={c.id}
                    className="group cursor-pointer p-4 transition-colors hover:border-primary/50"
                    onClick={() => navigate(`/chats/view/${c.id}`)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 text-sm font-medium">
                          {c.title || "Untitled conversation"}
                        </p>
                        {snippet && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {snippet}
                          </p>
                        )}
                      </div>
                      {!web && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            openInOverlay(c.id);
                          }}
                        >
                          <HeadphonesIcon className="size-3.5" />
                          Overlay
                        </Button>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="gap-1 text-3xs">
                        <ClockIcon className="size-3" />
                        {moment(c.updatedAt).fromNow()}
                      </Badge>
                      <Badge variant="outline" className="gap-1 text-3xs">
                        <MessageSquareIcon className="size-3" />
                        {c.messageCount || 0} messages
                      </Badge>
                      {sessionLabel ? (
                        <Badge variant="outline" className="text-3xs">
                          {sessionLabel} session
                        </Badge>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

      </div>
      {/* First launch, once: what the hosted app adds on top of this one. */}
      <ShowcaseTour
        open={pitchOpen}
        slides={PRO_PITCH}
        eyebrow="ChannelPulse Pro"
        doneLabel="See plans"
        dismissLabel="No thanks — I'll keep it local"
        onComplete={openPricing}
        onClose={closePitch}
      />
      {/* On demand, from "How it works" — never opens itself. */}
      <ShowcaseTour open={tourOpen} onClose={() => setTourOpen(false)} />
    </PageLayout>
  );
};

const StatCard = ({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  hint?: string;
}) => (
  <Card className="p-4">
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon className="size-4 text-primary" />
      <span className="text-xs">{label}</span>
    </div>
    <p className="mt-2 text-2xl font-semibold">{value}</p>
    {hint && <p className="text-2xs text-muted-foreground">{hint}</p>}
  </Card>
);

export default Dashboard;
