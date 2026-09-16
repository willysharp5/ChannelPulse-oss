import { Button, Badge } from "@/components";
import { DESKTOP_DOWNLOADS as DOWNLOADS } from "@/config";
import { HeadphonesIcon, SparklesIcon, MonitorDownIcon } from "lucide-react";

const AppleGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M16.365 1.43c0 1.14-.42 2.2-1.12 3.02-.85.99-2.24 1.76-3.38 1.67-.14-1.11.44-2.28 1.1-3.03.79-.9 2.19-1.58 3.4-1.66zM20.9 17.5c-.57 1.32-.85 1.9-1.58 3.06-1.02 1.63-2.46 3.66-4.24 3.68-1.58.02-1.99-1.03-4.14-1.02-2.15.01-2.6 1.04-4.18 1.02-1.78-.02-3.14-1.85-4.16-3.48C-.02 17.6-.4 12.31 1.5 9.51c1.03-1.53 2.66-2.5 4.2-2.5 1.6 0 2.6 1.03 3.92 1.03 1.28 0 2.06-1.03 3.91-1.03 1.36 0 2.8.74 3.83 2.02-3.36 1.84-2.82 6.64.54 8.47z" />
  </svg>
);

const WindowsGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M3 5.4 10.2 4.4v7H3zM11.3 4.25 21 3v8.4h-9.7zM3 12.6h7.2v7L3 18.6zM11.3 12.6H21V21l-9.7-1.3z" />
  </svg>
);

// A small, looping mock of the floating overlay: waveform + speaker-attributed
// transcript lines that reveal in sequence, then a "Suggested reply" bubble —
// the same shape as the real live-coaching window, so the animation shows how
// it works without needing the desktop app.
const HowItWorksAnimation = () => (
  <div className="lcp-mock w-full max-w-[340px] rounded-3xl bg-[#141414] p-3.5 text-[#f3f4f6] shadow-lg">
    <style>{LCP_CSS}</style>
    <div className="mb-2.5 flex items-center justify-between gap-3 rounded-full bg-white/[.06] px-3 py-2">
      <div className="flex items-center gap-2.5">
        <HeadphonesIcon className="size-4 text-[#c4b5fd]" />
        <div className="lcp-wave flex items-end gap-[3px]">
          <span /> <span /> <span /> <span /> <span /> <span /> <span />
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#034f46] px-2.5 py-1 text-[11px] font-semibold">
        <span className="lcp-dot size-1.5 rounded-full bg-[#86efac]" /> Listening
      </span>
    </div>

    <div className="space-y-2">
      <div className="lcp-line lcp-line-1 flex items-start gap-2">
        <span className="mt-0.5 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#c4b5fd]">
          Them
        </span>
        <p className="flex-1 rounded-2xl bg-white/[.06] px-2.5 py-2 text-[12px] leading-snug">
          How would you scale this to a million users?
        </p>
      </div>
      <div className="lcp-line lcp-line-2 flex items-start gap-2">
        <span className="mt-0.5 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#86efac]">
          You
        </span>
        <p className="flex-1 rounded-2xl bg-white/[.06] px-2.5 py-2 text-[12px] leading-snug">
          Great question. Let me walk through the architecture…
        </p>
      </div>
      <div className="lcp-line lcp-line-3 rounded-[18px] bg-[#034f46] p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#c4b5fd]">
          <SparklesIcon className="size-3.5" />
          Suggested reply
        </div>
        <ul className="space-y-1 text-[12px] leading-snug">
          <li className="flex gap-1.5">
            <span className="text-[#fca5a5]">✓</span> Shard the DB by tenant; cache
            hot reads.
          </li>
          <li className="flex gap-1.5">
            <span className="text-[#fca5a5]">✓</span> Queue writes async so spikes
            don't block.
          </li>
        </ul>
      </div>
    </div>
  </div>
);

const LiveCoachingPromo = () => {
  // Windows has no build yet (WINDOWS_DOWNLOAD_AVAILABLE), so Mac is the only
  // real download; the Windows button becomes a disabled "coming soon" chip.

  const MacButton = ({ variant }: { variant: "default" | "outline" }) => (
    <Button asChild variant={variant} className="gap-2">
      <a href={DOWNLOADS.mac} target="_blank" rel="noopener noreferrer">
        <AppleGlyph />
        Download for Mac
      </a>
    </Button>
  );
  const WinComingSoon = () => (
    <Button
      variant="outline"
      disabled
      className="gap-2"
      title="Windows download coming soon"
    >
      <WindowsGlyph />
      Windows: coming soon
    </Button>
  );

  return (
    <section
      data-tour="start-listening"
      className="overflow-hidden rounded-2xl border-2 border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 sm:p-6"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <Badge className="gap-1.5">
            <MonitorDownIcon className="size-3.5" />
            Desktop app feature
          </Badge>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <HeadphonesIcon className="size-5 text-primary" />
            Live notes &amp; coaching
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            During a real interview or call, ChannelPulse listens from a
            floating window, transcribes <strong>who said what</strong> in real
            time, and hands you a short, speakable talking point exactly when
            you need it, all without switching windows.
          </p>
          <p className="max-w-prose text-sm text-muted-foreground">
            Live coaching runs on your device, so it's{" "}
            <strong className="text-foreground">only in the Mac app</strong>{" "}
            (Windows coming soon). Everything else (interview practice, recaps
            &amp; scorecards, and your files) works right here in your browser
            and{" "}
            <strong className="text-foreground">stays in sync</strong> with the
            desktop app.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <MacButton variant="default" />
            <WinComingSoon />
          </div>
          <p className="text-2xs text-muted-foreground">
            Free for 7 days · No card required · macOS · Windows coming soon
          </p>
        </div>

        <div className="flex shrink-0 justify-center lg:justify-end">
          <HowItWorksAnimation />
        </div>
      </div>
    </section>
  );
};

// Scoped animation CSS (prefixed `lcp-`). Kept in the component so the promo is
// self-contained and global.css's theme stays untouched.
const LCP_CSS = `
.lcp-wave span {
  display: inline-block;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: #c4b5fd;
  transform-origin: bottom;
  animation: lcpWave 1.1s ease-in-out infinite;
}
.lcp-wave span:nth-child(1) { animation-delay: 0s; }
.lcp-wave span:nth-child(2) { animation-delay: .12s; }
.lcp-wave span:nth-child(3) { animation-delay: .24s; }
.lcp-wave span:nth-child(4) { animation-delay: .36s; }
.lcp-wave span:nth-child(5) { animation-delay: .48s; }
.lcp-wave span:nth-child(6) { animation-delay: .60s; }
.lcp-wave span:nth-child(7) { animation-delay: .72s; }
@keyframes lcpWave {
  0%, 100% { transform: scaleY(.35); opacity: .55; }
  50% { transform: scaleY(1); opacity: 1; }
}
.lcp-dot { animation: lcpPulse 1.4s ease-in-out infinite; }
@keyframes lcpPulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(134,239,172,.6); }
  50% { opacity: .6; box-shadow: 0 0 0 4px rgba(134,239,172,0); }
}
.lcp-line { animation: lcpReveal 8s ease-in-out infinite; }
.lcp-line-1 { animation-delay: 0s; }
.lcp-line-2 { animation-delay: 1.4s; }
.lcp-line-3 { animation-delay: 3s; }
@keyframes lcpReveal {
  0%, 4% { opacity: 0; transform: translateY(7px); }
  12%, 88% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(7px); }
}
@media (prefers-reduced-motion: reduce) {
  .lcp-wave span, .lcp-dot, .lcp-line { animation: none; }
  .lcp-line { opacity: 1; transform: none; }
}
`;

export default LiveCoachingPromo;
