/**
 * Profile — what the assistant knows about you.
 *
 * THERE IS NO PLAN ON THIS PAGE. ChannelPulse OSS is the free edition: it runs
 * against your own model and your own machine, there is nothing to subscribe to,
 * and this build ships without the backend that would sell it. A price tag here
 * would be an ad on a settings page for a product this app can't even check out.
 * The one place the hosted app is mentioned is the first-launch pitch on the
 * dashboard (see `components/onboarding/ProPitch.tsx`).
 *
 * So what's left is the part that actually does something: the "About you" text
 * every answer is grounded in. The account rows below it only appear when a
 * backend is configured AND signed in — which in a plain open-source build is
 * never, so most people see one card.
 */
import { useEffect, useState } from "react";
import { PageLayout } from "@/layouts";
import { Card, Button, Textarea, toast } from "@/components";
import { ProfileBuilder } from "@/pages/settings/components/ProfileBuilder";
import { useAuth } from "@/contexts";
import { getUserProfile, setUserProfile } from "@/lib/memory";
import { onSyncedKeys } from "@/lib/sync/kv";
import { STORAGE_KEYS } from "@/config";
import moment from "moment";
import {
  UserIcon,
  MailIcon,
  LogOutIcon,
  SparklesIcon,
  AlertCircleIcon,
} from "lucide-react";

const Profile = () => {
  const { user, configured, isSignedIn, signOut } = useAuth();
  const [profile, setProfile] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);

  useEffect(() => {
    setProfile(getUserProfile());
    // When a sync pull brings a newer profile from another device, refresh the
    // field. Only fires on genuine remote changes (local edits are already in
    // state), so it won't clobber what the user is typing.
    return onSyncedKeys([STORAGE_KEYS.USER_PROFILE], () => {
      setProfile(getUserProfile());
    });
  }, []);

  const persist = (value: string) => {
    setProfile(value);
    setUserProfile(value);
    setSavedAt(Date.now());
  };

  const email = user?.email ?? "";
  const memberSince = user?.created_at ? moment(user.created_at) : null;

  return (
    <PageLayout
      title="Profile"
      description="The personal context the assistant always knows about you."
    >
      <div className="space-y-5">
        {/* About you — textarea is capped so the page doesn't grow into a scroll trap */}
        <Card className="gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <UserIcon className="size-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">About you</p>
                <p className="text-xs text-muted-foreground">
                  Facts the assistant always knows: name, role, projects, and how you like answers.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => setBuilderOpen(true)}
            >
              <SparklesIcon className="size-3.5" />
              Build with AI
            </Button>
          </div>
          <Textarea
            value={profile}
            onChange={(e) => persist(e.target.value)}
            placeholder="e.g. I'm John, a software engineer. I worked at Stripe on payments infrastructure. I prefer concise, direct answers."
            rows={16}
            className="min-h-[18rem] max-h-[min(700px,78vh)] resize-y overflow-y-auto field-sizing-fixed text-sm"
          />
          {!profile.trim() ? (
            <p className="flex items-start gap-1.5 text-xs font-medium text-red-500">
              <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Add a few details about yourself. The assistant uses this as
                background in <strong>every</strong> answer; filling it in makes
                responses far more accurate and personalized to your experience.
              </span>
            </p>
          ) : savedAt ? (
            <p className="text-2xs text-muted-foreground">Saved.</p>
          ) : null}
          {/* Only true with no backend configured — once signed in this key
              syncs across devices (setUserProfile → setSyncedItem). */}
          {!configured && (
            <p className="text-2xs text-muted-foreground">
              Stored on this machine. Nothing here is uploaded.
            </p>
          )}
        </Card>

        {/* Signed in to a backend (a self-hosted or hosted deployment) — show
            whose account it is and a way out. Absent in a plain local build,
            where there is no account to show. */}
        {configured && isSignedIn && (
          <Card className="gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-base font-semibold text-primary">
                  {(email || "?").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                    <MailIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    {email || "Signed in"}
                  </p>
                  {memberSince && (
                    <p className="text-xs text-muted-foreground">
                      Member since {memberSince.format("MMM D, YYYY")}
                    </p>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5 text-destructive hover:text-destructive"
                onClick={() => signOut()}
              >
                <LogOutIcon className="size-3.5" />
                Sign out
              </Button>
            </div>
          </Card>
        )}

        {/* NO danger zone. There is no account to close in this edition — your
            data is already only on this machine, and the local copy is cleared
            from Settings ("Delete Chat History"). */}

        <ProfileBuilder
          open={builderOpen}
          onOpenChange={setBuilderOpen}
          onSaved={(compiled) => {
            persist(compiled);
            toast("Profile updated", {
              description: "Saved what the assistant knows about you.",
            });
          }}
        />
      </div>
    </PageLayout>
  );
};

export default Profile;
