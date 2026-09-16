import { useEffect, useState } from "react";
import { Button, Input, Label } from "@/components/ui";
import { OtpInput } from "./OtpInput";
import { useAuth } from "@/contexts";
import { LoaderIcon, ArrowLeftIcon, RefreshCwIcon } from "lucide-react";

// Number of digits in the sign-in code. Must match the Supabase project's
// Email OTP length (Authentication → Providers → Email → OTP length).
const OTP_LENGTH = 8;

/**
 * Email one-time-code sign-in. Step 1: enter email (sends a code). Step 2:
 * enter (or paste) the code, which auto-verifies once complete.
 */
export const SignIn = () => {
  const { sendCode, verifyCode } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  // Bumped to remount the OTP boxes (clearing them) after an error or resend.
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Countdown for the resend cooldown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submitEmail = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await sendCode(email);
      setStep("code");
      setInfo(`We sent a sign-in code to ${email}.`);
      setCooldown(30);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setCode("");
    setAttempt((a) => a + 1);
    try {
      await sendCode(email);
      setInfo(`New code sent to ${email}.`);
      setCooldown(30);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResending(false);
    }
  };

  const submitCode = async (value?: string) => {
    const c = (value ?? code).trim();
    if (c.length < OTP_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyCode(email, c);
      // On success the auth listener flips the app into the signed-in state.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Clear the boxes so the user can re-enter a fresh code.
      setCode("");
      setAttempt((a) => a + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-border/50 bg-card/40 p-8">
        <div className="space-y-1.5 text-center">
          <img
            src="/app-icon.png"
            alt="ChannelPulse"
            className="mx-auto mb-2 size-12 rounded-xl"
          />
          <h1 className="text-lg font-semibold">Sign in to ChannelPulse</h1>
          <p className="text-sm text-muted-foreground">
            {step === "email"
              ? "Enter your email and we'll send you a sign-in code. New accounts get 7 days of Pro free, no card required."
              : "Enter the code we emailed you."}
          </p>
        </div>

        {step === "email" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitEmail()}
                placeholder="you@company.com"
              />
            </div>
            <Button
              className="w-full gap-2"
              onClick={submitEmail}
              disabled={busy || !email.trim()}
            >
              {busy && <LoaderIcon className="size-4 animate-spin" />}
              Send code
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">Sign-in code</Label>
              <OtpInput
                key={attempt}
                length={OTP_LENGTH}
                autoFocus
                disabled={busy}
                onChange={setCode}
                onComplete={(c) => submitCode(c)}
              />
              <p className="text-center text-2xs text-muted-foreground">
                Paste the code to sign in automatically.
              </p>
            </div>
            <Button
              className="w-full gap-2"
              onClick={() => submitCode()}
              disabled={busy || code.trim().length < OTP_LENGTH}
            >
              {busy && <LoaderIcon className="size-4 animate-spin" />}
              Verify & sign in
            </Button>
            <div className="flex items-center justify-between">
              <button
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                  setInfo(null);
                }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeftIcon className="size-3" />
                Use a different email
              </button>
              <button
                onClick={resend}
                disabled={cooldown > 0 || resending}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              >
                {resending ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : (
                  <RefreshCwIcon className="size-3" />
                )}
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </div>
        )}

        {info && <p className="text-xs text-muted-foreground">{info}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
};
