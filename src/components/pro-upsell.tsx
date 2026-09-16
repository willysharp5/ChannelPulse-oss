import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { SparklesIcon, CheckCircle2Icon, ArrowRightIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui";
import { PRICING_URL } from "@/config";
import { openExternal } from "@/lib/platform";

/**
 * "That part is in the hosted app" — one shared dialog for every locked surface.
 *
 * ChannelPulse OSS is the free edition and everything it can do, it does: local
 * model, local transcription, local storage, no account. A handful of things it
 * genuinely cannot do are what the hosted app is for, and this is how the app
 * says so — once, on demand, when someone reaches for one of them.
 *
 * IT DOES NOT SELL ANYTHING. There is no checkout in this build (no backend, no
 * Stripe keys — `getSupabase()` returns null), so the only honest call to action
 * is the pricing page in the user's browser. Anything that looks like an in-app
 * "Subscribe" button here would dead-end.
 *
 * Two pieces:
 *   - ProUpsellProvider  a single shared dialog + promptUpgrade(feature?).
 *   - ProFeatureList     the inline list, reused by the dialog and by banners.
 */

/**
 * What the hosted app adds on top of this one.
 *
 * VERBATIM from the "What Pro adds on top" column on channelpulse.us/pricing,
 * which is also the OSS-vs-hosted table in README.md and the slide captions in
 * `components/onboarding/ProPitch.tsx`. Keep all four in step — if a line
 * changes on the pricing page it changes here, and nothing goes in this list
 * that isn't on that page.
 */
export const PRO_FEATURES = [
  "Managed AI — no keys or models to configure",
  "Real-time streaming transcription + speaker diarization",
  "Cloud sync & backup across devices",
  "Full guided tutorials library & thousands of company questions",
  "Natural cloud voices & priority support",
];

/** The "what the hosted app adds" checklist. */
export function ProFeatureList({ className }: { className?: string }) {
  return (
    <ul className={className}>
      {PRO_FEATURES.map((f) => (
        <li key={f} className="flex items-start gap-2 text-sm">
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

/** The one call to action this build can honour: the plans page, in a browser. */
export function ProCta({ label = "See plans" }: { label?: string }) {
  return (
    <div>
      <Button className="gap-1.5" onClick={() => openExternal(PRICING_URL)}>
        {label}
        <ArrowRightIcon className="size-4" />
      </Button>
      <p className="mt-2.5 text-2xs text-muted-foreground">
        Opens channelpulse.us in your browser. This app stays free.
      </p>
    </div>
  );
}

const ProUpsellContext = createContext<{
  promptUpgrade: (feature?: string) => void;
} | null>(null);

/**
 * Wraps the dashboard so any page can call `promptUpgrade()` and get the same
 * dialog, instead of each locked surface rolling its own.
 */
export function ProUpsellProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState<string | null>(null);

  const promptUpgrade = useCallback((f?: string) => {
    setFeature(f ?? null);
    setOpen(true);
  }, []);

  const value = useMemo(() => ({ promptUpgrade }), [promptUpgrade]);

  return (
    <ProUpsellContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <div className="bg-gradient-to-br from-primary to-emerald-800 px-6 py-5 text-white">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-lg bg-white/15">
                <SparklesIcon className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-white">
                  ChannelPulse Pro
                </DialogTitle>
                <p className="text-xs text-white/80">
                  $10/mo · or $8/mo billed yearly
                </p>
              </div>
            </div>
          </div>
          <div className="px-6 py-5">
            <DialogDescription className="text-sm text-foreground">
              {feature
                ? `${feature} is part of the hosted app. `
                : "That’s part of the hosted app. "}
              It also gets you:
            </DialogDescription>
            <ProFeatureList className="mt-3 space-y-2" />
            <div className="mt-5">
              <ProCta />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ProUpsellContext.Provider>
  );
}

/** Access `promptUpgrade(feature?)` from any page under the provider. */
export function useProUpsell() {
  const ctx = useContext(ProUpsellContext);
  if (!ctx) {
    throw new Error("useProUpsell must be used within a ProUpsellProvider");
  }
  return ctx;
}
