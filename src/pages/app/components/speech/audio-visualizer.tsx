import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

// Visual tuning (safe to tweak without touching Rust).
const VIZ = {
  BANDS: 24,
  GAIN: 1.15, // extra headroom on top of the backend's normalization
  STREAM_GAIN: 1.4, // gain for the Web Audio (mic) path
  MIN_BAR: 2, // minimum bar height in px so idle bars are still visible
  BAR_GAP: 3, // px gap between bars
  ATTACK: 0.55, // how fast bars rise toward new peaks (0..1)
  DECAY: 0.14, // how fast bars fall back down (0..1)
  IDLE_MS: 220, // if no audio-level events arrive, ease bars back to 0
  FFT_SIZE: 512,
  COLOR: "58, 103, 208", // brand accent blue (matches app primary)
} as const;

interface AudioVisualizerProps {
  isRecording: boolean;
  // When provided (e.g. the mic recorder), levels come from this stream.
  // Otherwise levels come from the backend "audio-level" events (system audio).
  stream?: MediaStream | null;
  // Smaller, tighter bars (used in the audio-settings mic test).
  compact?: boolean;
}

export function AudioVisualizer({
  isRecording,
  stream,
  compact = false,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>(0);
  const targetsRef = useRef<number[]>([]);
  const displayedRef = useRef<number[]>([]);
  const lastEventRef = useRef<number>(0);
  // Levels emitted by the frontend mic listener (window "mic-level" event).
  const micTargetsRef = useRef<number[]>([]);
  const micLastRef = useRef<number>(0);

  // Keep the canvas backing store sized to the container (DPR-aware).
  useEffect(() => {
    const resize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = Math.max(1, (rect.width - 2) * dpr);
      canvas.height = Math.max(1, (rect.height - 2) * dpr);
      canvas.style.width = `${rect.width - 2}px`;
      canvas.style.height = `${rect.height - 2}px`;
    };
    window.addEventListener("resize", resize);
    resize();
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (!isRecording) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let freqData: Uint8Array | null = null;
    let onMicLevel: ((e: Event) => void) | undefined;

    if (stream) {
      // Real MediaStream (e.g. microphone) -> Web Audio frequency analysis.
      try {
        audioCtx = new AudioContext();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = VIZ.FFT_SIZE;
        analyser.smoothingTimeConstant = 0.8;
        freqData = new Uint8Array(analyser.frequencyBinCount);
        audioCtx.createMediaStreamSource(stream).connect(analyser);
      } catch {
        audioCtx = null;
        analyser = null;
      }
    } else {
      // System audio -> live levels emitted from the Rust capture loop.
      listen<number[]>("audio-level", (event) => {
        const bands = event.payload;
        if (Array.isArray(bands) && bands.length > 0) {
          targetsRef.current = bands;
          lastEventRef.current = performance.now();
        }
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

      // Microphone levels (emitted by MicListener in this same window).
      onMicLevel = (e: Event) => {
        const bands = (e as CustomEvent).detail;
        if (Array.isArray(bands) && bands.length > 0) {
          micTargetsRef.current = bands;
          micLastRef.current = performance.now();
        }
      };
      window.addEventListener("mic-level", onMicLevel);
    }

    // Reduce analyser frequency bins down to VIZ.BANDS bars.
    const computeStreamBands = (): number[] => {
      if (!analyser || !freqData) return new Array(VIZ.BANDS).fill(0);
      analyser.getByteFrequencyData(freqData as Uint8Array<ArrayBuffer>);
      // Speech energy sits in the lower bins; use ~70% of the spectrum.
      const usable = Math.floor(freqData.length * 0.7);
      const per = Math.max(1, Math.floor(usable / VIZ.BANDS));
      const out = new Array(VIZ.BANDS).fill(0);
      for (let b = 0; b < VIZ.BANDS; b++) {
        let sum = 0;
        for (let j = 0; j < per; j++) sum += freqData[b * per + j] || 0;
        out[b] = Math.min(1, (sum / per / 255) * VIZ.STREAM_GAIN);
      }
      return out;
    };

    const draw = () => {
      if (cancelled) return;
      animationFrameRef.current = requestAnimationFrame(draw);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const centerY = h / 2;

      // Determine target levels for this frame.
      let targets: number[];
      let gain: number = VIZ.GAIN;
      if (analyser) {
        targets = computeStreamBands();
        gain = 1; // stream gain already applied
      } else {
        const now = performance.now();
        const sys =
          now - lastEventRef.current > VIZ.IDLE_MS ? [] : targetsRef.current;
        const mic =
          now - micLastRef.current > VIZ.IDLE_MS ? [] : micTargetsRef.current;
        const count = Math.max(sys.length, mic.length, VIZ.BANDS);
        // Merge system + mic so the waves react to whichever is active.
        targets = new Array(count);
        for (let i = 0; i < count; i++) {
          targets[i] = Math.max(sys[i] || 0, mic[i] || 0);
        }
      }

      const count = targets.length || VIZ.BANDS;
      if (displayedRef.current.length !== count) {
        displayedRef.current = new Array(count).fill(0);
      }
      const displayed = displayedRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const minBar = compact ? 1 : VIZ.MIN_BAR;
      const maxBarH = compact ? h * 0.85 : h;
      // Compact (mic test): skinny fixed-width bars, centered as a group, with a
      // baseline line running out each side.
      let barWidth: number;
      let gap: number;
      let barsStartX: number;
      if (compact) {
        barWidth = 2; // skinny
        gap = 2.5;
        const total = count * (barWidth + gap) - gap;
        barsStartX = Math.max(0, (w - total) / 2);

        ctx.strokeStyle = `rgba(${VIZ.COLOR}, 0.22)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY + 0.5);
        ctx.lineTo(w, centerY + 0.5);
        ctx.stroke();
      } else {
        gap = VIZ.BAR_GAP;
        barWidth = Math.max(2, w / count - gap);
        barsStartX = 0;
      }

      let x = barsStartX;

      for (let i = 0; i < count; i++) {
        const target = Math.min(1, (targets[i] || 0) * gain);
        // Rise quickly, fall gently for a natural, springy motion.
        const rate = target > displayed[i] ? VIZ.ATTACK : VIZ.DECAY;
        displayed[i] += (target - displayed[i]) * rate;

        const value = displayed[i];
        const barHeight = Math.max(minBar, value * maxBarH);
        const y = centerY - barHeight / 2;
        const alpha = 0.45 + value * 0.55;

        ctx.fillStyle = `rgba(${VIZ.COLOR}, ${alpha})`;
        const r = Math.min(barWidth / 2, barHeight / 2);
        if (typeof ctx.roundRect === "function") {
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, r);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, barWidth, barHeight);
        }
        x += barWidth + gap;
      }
    };

    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      if (onMicLevel) window.removeEventListener("mic-level", onMicLevel);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
      targetsRef.current = [];
      displayedRef.current = [];
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [isRecording, stream, compact]);

  return (
    <div
      ref={containerRef}
      className={compact ? "h-9 w-full" : "!h-[2rem] !w-full pl-4 pt-2"}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
