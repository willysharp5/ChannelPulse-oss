/**
 * Where interview practice mentions the hosted app.
 *
 * Practice itself is NOT gated and never will be — it is the reason this app
 * exists, it runs entirely against the user's own model, and gating it would
 * also contradict channelpulse.us/pricing, which lists mock interviews as
 * something the open-source edition does. So the free edition says its piece in
 * two places and then gets out of the way:
 *
 *   - `PracticeUpsellBanner` — one dismissible line above the tabs. Dismissed is
 *     dismissed, for good (a banner that comes back is an ad).
 *   - `BankUnavailableNotice` — replaces the "By company" / "By role" tabs when
 *     no backend is configured. Not an upsell dressed as an error: those tabs
 *     read the question bank out of a Postgres database over the network, so with
 *     no backend there is genuinely nothing to browse, and the stock empty state
 *     ("No companies match — try a different search") sends people hunting for a
 *     search term that cannot exist.
 */
import { useState } from "react";
import { Button, Card, ProFeatureList } from "@/components";
import { useProUpsell } from "@/components/pro-upsell";
import { PRICING_URL } from "@/config";
import { openExternal } from "@/lib/platform";
import { safeLocalStorage } from "@/lib/storage";
import {
  ArrowRightIcon,
  Building2Icon,
  SparklesIcon,
  XIcon,
} from "lucide-react";

const BANNER_DISMISSED_KEY = "cp:practice-upsell-dismissed-v1";

export const PracticeUpsellBanner = () => {
  const { promptUpgrade } = useProUpsell();
  const [hidden, setHidden] = useState(
    () => safeLocalStorage.getItem(BANNER_DISMISSED_KEY) === "1"
  );

  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    safeLocalStorage.setItem(BANNER_DISMISSED_KEY, "1");
  };

  return (
    <Card className="relative mb-4 gap-2 border-primary/30 bg-primary/5 p-4 pr-10">
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <SparklesIcon className="size-4 shrink-0 text-primary" />
        You're practising on the free edition
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Every round here runs on your own model, on this machine. The hosted app
        adds managed AI with nothing to configure, real-time streaming
        transcription, the full guided tutorials library and thousands of real
        questions across hundreds of companies.
      </p>
      <div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => promptUpgrade("Managed practice")}
        >
          What's included
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
    </Card>
  );
};

export const BankUnavailableNotice = ({ what }: { what: "companies" | "roles" }) => (
  <Card className="gap-3 p-6 text-center">
    <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
      <Building2Icon className="size-5" />
    </div>
    <div className="space-y-1">
      <p className="text-sm font-semibold">
        The question bank is part of the hosted app
      </p>
      <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
        {what === "companies"
          ? "Questions by company are read from a hosted database, not bundled into this app, so there's nothing here to browse in a local build."
          : "Questions by role are read from a hosted database, not bundled into this app, so there's nothing here to browse in a local build."}{" "}
        Practice, Full loop and Results all work as normal — they run on your own
        model. Running your own backend? Point this build at it with the values in{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-3xs">.env.example</code>.
      </p>
    </div>
    <ProFeatureList className="mx-auto max-w-sm space-y-1.5 pt-1 text-left" />
    <div className="pt-1">
      <Button size="sm" className="gap-1.5" onClick={() => openExternal(PRICING_URL)}>
        See plans
        <ArrowRightIcon className="size-3.5" />
      </Button>
    </div>
  </Card>
);
