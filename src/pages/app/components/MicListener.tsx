import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fetchSTT } from "@/lib/functions";
import { useApp } from "@/contexts";
import { DEFAULT_SYSTEM_PROMPT } from "@/config";
import {
  floatArrayToWav,
  micAudioConstraints,
  resolveBrowserAudioInputId,
} from "@/lib/utils";
import { isMacOS } from "@/lib";
import { type useSystemAudioType, isRealTranscription } from "@/hooks";
import { isSpeakerBleed } from "@/lib/stt/speaker-bleed";

/**
 * Invisible microphone listener that captures what "You" say and feeds it into
 * the same conversation as the system audio ("Them"). Renders nothing.
 *
 * Two implementations, chosen by platform:
 *
 * - macOS → `NativeMicListener`: the mic is captured natively in Rust
 *   (CoreAudio input device, see src-tauri/src/speaker). This exists because
 *   the WebView `getUserMedia` path made WebKit synchronously (re)activate the
 *   macOS audio session on the JS thread, and when another app (Zoom) held that
 *   session the whole overlay froze on move/stop/pause. Native capture never
 *   touches the WebView audio session, so it can't block the UI thread.
 *
 * - Windows/Linux → `WebMicListener`: the original raw `getUserMedia` +
 *   amplitude-VAD path. Those WebViews don't have the WKWebView freeze, so
 *   there's no reason to add a native capture backend there.
 */
export const MicListener = ({
  systemAudio,
}: {
  systemAudio: useSystemAudioType;
}) => {
  if (isMacOS()) {
    return <NativeMicListener systemAudio={systemAudio} />;
  }
  return <WebMicListener systemAudio={systemAudio} />;
};

/**
 * Serialises native mic ownership across mounts of `NativeMicListener`.
 *
 * React StrictMode double-invokes every effect, so two `setup()` calls are in
 * flight at once on the very first mount — and each one begins by stopping the
 * mic. Without a token the second mount's `stop_mic_capture` could land after
 * the first's `start_mic_capture`, leaving the toggle on with nothing capturing;
 * and the loser's cleanup would tear down the winner's live stream. Each mount
 * takes the next number and only touches the mic while it still holds the
 * highest one.
 */
let micOwner = 0;

/**
 * macOS: drive native Rust mic capture and consume its `mic-*` events.
 * Mirrors the system-audio `speech-detected` handler in useSystemAudio, but
 * attributes every fragment to "You".
 */
const NativeMicListener = ({
  systemAudio,
}: {
  systemAudio: useSystemAudioType;
}) => {
  const app = useApp();
  // Keep latest values so the long-lived event callbacks aren't stale.
  const latest = useRef({ systemAudio, app });
  latest.current = { systemAudio, app };

  const inputId = app.selectedAudioDevices.input.id;
  const deviceId = inputId && inputId !== "default" ? inputId : undefined;

  useEffect(() => {
    let disposed = false;
    const myToken = ++micOwner;
    const unlisteners: Array<() => void> = [];
    // True only while this mount is the newest one. Checked after every await in
    // setup() so a superseded mount stops touching the device mid-sequence.
    const owns = () => myToken === micOwner && !disposed;

    const transcribe = async (audioBlob: Blob) => {
      try {
        const { systemAudio: sa, app: a } = latest.current;
        // Paused: drop the segment rather than transcribing it. Native capture
        // keeps running (so we never re-acquire the device), we just ignore it.
        if (sa.isPaused) return;
        if (!a.hasActiveLicense) {
          sa.setError("Your ChannelPulse trial has ended. Open the Dashboard to upgrade.");
          return;
        }

        const transcription = await fetchSTT({ audio: audioBlob });
        if (isRealTranscription(transcription)) {
          const previousMessages = sa.conversation.messages;
          if (isSpeakerBleed(transcription, previousMessages)) {
            console.debug(
              "[mic] dropped speaker bleed:",
              transcription.slice(0, 60)
            );
            return;
          }
          // Write it to the transcript FIRST, exactly as the system-audio path
          // does. processWithAI bails out early on a [SKIP] triage without
          // committing anything, on the documented assumption that "the heard
          // line is NOT lost, because the transcript was committed separately"
          // — an assumption only the system-audio path satisfied. The mic went
          // straight to processWithAI, so every utterance the copilot chose not
          // to answer disappeared, and it declines most of what YOU say: its
          // job is suggesting replies to what the other side says. Result: you
          // spoke, the waveform moved, the audio was captured and transcribed
          // correctly, and the transcript still read "Listening…".
          sa.commitHeardLine(transcription, "You");
          const prompt = a.systemPrompt || DEFAULT_SYSTEM_PROMPT;
          await sa.processWithAI(
            transcription,
            prompt,
            previousMessages,
            [],
            "You",
            undefined,
            // The line above is already in the thread; don't commit it twice.
            { skipUserCommit: true }
          );
        }
      } catch (err) {
        // Surface it. A mic that silently transcribes nothing is the single
        // hardest thing to diagnose in this app from the outside: the waveform
        // still moves (system audio drives it), so the only evidence that
        // anything went wrong was a console line in a webview nobody can open.
        console.error("Mic transcription failed:", err);
        latest.current.systemAudio.setError(
          err instanceof Error ? err.message : "Microphone transcription failed."
        );
      }
    };

    const setup = async () => {
      try {
        // Clear any lingering task from a previous mount before starting, so a
        // quick unmount/remount (or device change) doesn't hit "already
        // running". A no-op stop is cheap.
        await invoke("stop_mic_capture").catch(() => {});
        // A newer mount took over while that stop was in flight — it will do its
        // own start, and racing it here is how the device ends up stopped with
        // the toggle still on.
        if (!owns()) return;
        await invoke("start_mic_capture", { deviceId });
      } catch (err) {
        // Report what actually failed. This used to hard-code a "check your
        // microphone permissions" message, which was wrong most of the time:
        // the common failure was CoreAudio refusing a new IO proc, and telling
        // someone to fix a setting that was never broken sends them off to
        // toggle permissions for a bug in this app.
        console.error("Failed to start native mic capture:", err);
        const detail = typeof err === "string" ? err : (err as Error)?.message;
        latest.current.systemAudio.setError(
          detail
            ? `Couldn't start the microphone: ${detail}`
            : "Couldn't start the microphone. Check System Settings → Privacy & Security → Microphone."
        );
        return;
      }
      if (!owns()) {
        invoke("stop_mic_capture").catch(() => {});
        return;
      }

      const unSpeech = await listen<string>("mic-speech-detected", (event) => {
        const base64Audio = event.payload;
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: "audio/wav" });
        void transcribe(blob);
      });

      // Drive the floating-bar waveform via the same window "mic-level" event
      // the WebAudio path used, so AudioVisualizer needs no changes.
      const unLevel = await listen<number[]>("mic-audio-level", (event) => {
        const bands = latest.current.systemAudio.isPaused
          ? new Array(event.payload.length).fill(0)
          : event.payload;
        window.dispatchEvent(new CustomEvent("mic-level", { detail: bands }));
      });

      if (!owns()) {
        unSpeech();
        unLevel();
        invoke("stop_mic_capture").catch(() => {});
        return;
      }
      unlisteners.push(unSpeech, unLevel);
    };

    void setup();

    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
      // Only the current owner stops the device. StrictMode's first cleanup runs
      // while the second mount is already starting; stopping there would kill a
      // capture this mount no longer owns.
      if (myToken === micOwner) invoke("stop_mic_capture").catch(() => {});
      // The waveform eases back to zero on its own once mic-level events stop
      // (AudioVisualizer's idle decay), so no explicit reset is needed here.
    };
  }, [deviceId]);

  return null;
};

/**
 * Windows/Linux: raw getUserMedia + amplitude-VAD path (proven to work).
 * Records speech segments, encodes them to WAV, transcribes, and feeds the
 * conversation as "You". Renders nothing.
 */
const WebMicListener = ({
  systemAudio,
}: {
  systemAudio: useSystemAudioType;
}) => {
  const { selectedAudioDevices } = useApp();
  const [browserMicId, setBrowserMicId] = useState<string | undefined>(
    undefined
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    resolveBrowserAudioInputId(selectedAudioDevices.input.name).then((id) => {
      if (active) {
        setBrowserMicId(id);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [selectedAudioDevices.input.name]);

  if (!ready) return null;

  return (
    <MicVAD key={browserMicId ?? "default"} browserMicId={browserMicId} systemAudio={systemAudio} />
  );
};

const MicVAD = ({
  browserMicId,
  systemAudio,
}: {
  browserMicId?: string;
  systemAudio: useSystemAudioType;
}) => {
  const app = useApp();
  // Keep latest values so the long-lived audio callback isn't stale.
  const latest = useRef({ systemAudio, app });
  latest.current = { systemAudio, app };

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let processor: ScriptProcessorNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let sink: GainNode | null = null;
    let levelAnalyser: AnalyserNode | null = null;
    let levelRaf = 0;

    const transcribe = async (samples: Float32Array, sr: number) => {
      try {
        const { systemAudio: sa, app: a } = latest.current;
        // Paused mid-flush: drop the segment rather than transcribing it.
        if (sa.isPaused) return;
        if (!a.hasActiveLicense) {
          sa.setError("Your ChannelPulse trial has ended. Open the Dashboard to upgrade.");
          return;
        }

        const wav = floatArrayToWav(samples, sr, "wav");
        const transcription = await fetchSTT({ audio: wav });
        if (isRealTranscription(transcription)) {
          const previousMessages = sa.conversation.messages;
          if (isSpeakerBleed(transcription, previousMessages)) {
            console.debug(
              "[mic] dropped speaker bleed:",
              transcription.slice(0, 60)
            );
            return;
          }
          // Same as the native path above: commit the heard line before the
          // copilot gets a say, or a [SKIP] loses it silently.
          sa.commitHeardLine(transcription, "You");
          const prompt = a.systemPrompt || DEFAULT_SYSTEM_PROMPT;
          await sa.processWithAI(
            transcription,
            prompt,
            previousMessages,
            [],
            "You",
            undefined,
            { skipUserCommit: true }
          );
        }
      } catch (err) {
        // Surface it. A mic that silently transcribes nothing is the single
        // hardest thing to diagnose in this app from the outside: the waveform
        // still moves (system audio drives it), so the only evidence that
        // anything went wrong was a console line in a webview nobody can open.
        console.error("Mic transcription failed:", err);
        latest.current.systemAudio.setError(
          err instanceof Error ? err.message : "Microphone transcription failed."
        );
      }
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: micAudioConstraints(browserMicId),
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ctx = new AudioContext();
        const sr = ctx.sampleRate;
        source = ctx.createMediaStreamSource(stream);
        processor = ctx.createScriptProcessor(4096, 1, 1);
        // Route through a muted gain node so onaudioprocess fires without
        // playing the mic back through the speakers.
        sink = ctx.createGain();
        sink.gain.value = 0;
        source.connect(processor);
        processor.connect(sink);
        sink.connect(ctx.destination);

        // Drive the floating-bar waveform from the mic via a window event.
        levelAnalyser = ctx.createAnalyser();
        levelAnalyser.fftSize = 256;
        levelAnalyser.smoothingTimeConstant = 0.7;
        source.connect(levelAnalyser);
        const freq = new Uint8Array(levelAnalyser.frequencyBinCount);
        const BANDS = 24;
        const emitLevels = () => {
          if (stopped || !levelAnalyser) return;
          if (latest.current.systemAudio.isPaused) {
            window.dispatchEvent(
              new CustomEvent("mic-level", { detail: new Array(BANDS).fill(0) })
            );
            levelRaf = requestAnimationFrame(emitLevels);
            return;
          }
          levelAnalyser.getByteFrequencyData(freq);
          const bands = new Array(BANDS).fill(0);
          const usable = Math.floor(freq.length * 0.7);
          const per = Math.max(1, Math.floor(usable / BANDS));
          for (let b = 0; b < BANDS; b++) {
            let s = 0;
            for (let j = 0; j < per; j++) s += freq[b * per + j] || 0;
            bands[b] = Math.min(1, (s / per / 255) * 1.6);
          }
          window.dispatchEvent(new CustomEvent("mic-level", { detail: bands }));
          levelRaf = requestAnimationFrame(emitLevels);
        };
        emitLevels();

        const THRESHOLD = 0.015; // RMS speech threshold
        const SILENCE_FRAMES = Math.max(6, Math.round((0.8 * sr) / 4096));
        const MIN_SPEECH_SAMPLES = Math.round(0.25 * sr);
        const MAX_SPEECH_SAMPLES = 30 * sr;

        let buffers: Float32Array[] = [];
        let speaking = false;
        let silence = 0;
        let speechSamples = 0;

        const flush = () => {
          if (speechSamples >= MIN_SPEECH_SAMPLES && buffers.length > 0) {
            const merged = new Float32Array(speechSamples);
            let off = 0;
            for (const b of buffers) {
              merged.set(b, off);
              off += b.length;
            }
            transcribe(merged, sr);
          }
          buffers = [];
          speaking = false;
          silence = 0;
          speechSamples = 0;
        };

        processor.onaudioprocess = (e) => {
          if (stopped) return;
          // While paused the stream stays open (so we never re-acquire the
          // system audio session), but we discard audio and reset any
          // in-progress segment instead of buffering or transcribing it.
          if (latest.current.systemAudio.isPaused) {
            if (speaking || buffers.length) {
              buffers = [];
              speaking = false;
              silence = 0;
              speechSamples = 0;
            }
            return;
          }
          const input = e.inputBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
          const rms = Math.sqrt(sum / input.length);

          if (rms > THRESHOLD) {
            speaking = true;
            silence = 0;
            buffers.push(new Float32Array(input));
            speechSamples += input.length;
            if (speechSamples >= MAX_SPEECH_SAMPLES) flush();
          } else if (speaking) {
            // keep a little trailing audio during the pause
            buffers.push(new Float32Array(input));
            speechSamples += input.length;
            silence++;
            if (silence >= SILENCE_FRAMES) flush();
          }
        };
      } catch (err) {
        console.error("Mic listener failed to start:", err);
        latest.current.systemAudio.setError(
          "Couldn't start the microphone. Check that this app is allowed to use it."
        );
      }
    };

    start();

    return () => {
      stopped = true;
      try {
        if (levelRaf) cancelAnimationFrame(levelRaf);
        levelAnalyser?.disconnect();
        if (processor) processor.onaudioprocess = null;
        processor?.disconnect();
        source?.disconnect();
        sink?.disconnect();
        stream?.getTracks().forEach((t) => t.stop());
        ctx?.close().catch(() => {});
      } catch {
        // ignore teardown errors
      }
    };
  }, [browserMicId]);

  return null;
};
