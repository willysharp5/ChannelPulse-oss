import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Scroll the current page's main scroll area (the Radix ScrollArea viewport used
 * by PageLayout) back to the top. Falls back to the window if not found.
 */
export function scrollPageToTop(behavior: ScrollBehavior = "smooth"): void {
  try {
    const vp = document.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLElement | null;
    if (vp) {
      vp.scrollTo({ top: 0, behavior });
      return;
    }
    window.scrollTo({ top: 0, behavior });
  } catch {
    // no-op
  }
}

/**
 * The audio device IDs from the Rust/Core Audio layer are NOT valid browser
 * getUserMedia deviceIds. This maps a selected device by its NAME to the
 * browser's deviceId (matching enumerateDevices labels). Returns undefined if
 * no match, so callers can fall back to the default microphone.
 */
export async function resolveBrowserAudioInputId(
  deviceName?: string
): Promise<string | undefined> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return undefined;
    let devices = await navigator.mediaDevices.enumerateDevices();
    // Labels are hidden until mic permission is granted.
    const hasLabels = devices.some((d) => d.kind === "audioinput" && d.label);
    if (!hasLabels) {
      const tmp = await navigator.mediaDevices.getUserMedia({
        audio: micAudioConstraints(),
      });
      tmp.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    const inputs = devices.filter(
      (d) => d.kind === "audioinput" && d.deviceId
    );
    if (!deviceName) return undefined;
    const name = deviceName.toLowerCase().trim();
    const match =
      inputs.find((d) => d.label.toLowerCase() === name) ||
      inputs.find((d) => d.label.toLowerCase().includes(name)) ||
      inputs.find((d) => name.includes(d.label.toLowerCase()));
    return match?.deviceId || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The audio constraints for EVERY microphone capture in the app. One place, so
 * a mic test and the capture it is supposed to be testing can't drift apart.
 *
 * We ask for RAW audio — all three processing flags off — and that is the fix
 * for "when transcription starts, the far side says I sound quiet and distant".
 *
 * Left unspecified, a webview defaults `autoGainControl`, `echoCancellation`
 * and `noiseSuppression` all to TRUE. The reasoning that matters: a per-stream
 * effect could not possibly change what Zoom or Meet's own capture hears, so a
 * symptom that crosses an app boundary has to be travelling through something
 * SHARED — and the shared thing is the input device. On macOS these flags are
 * not applied to our copy of the audio; they put the device itself into Apple's
 * voice-processing mode, which every other client of that device then inherits:
 *
 *  - AGC rides the input device's system gain slider, a persistent OS setting
 *    nothing puts back when capture stops → the mic stays soft, in every app.
 *  - AEC/NS switch the device into a voice-optimised capture mode → thin and
 *    far-away sounding, which is the "distant" half of the report.
 *
 * So the app was quietly reconfiguring the microphone out from under the call.
 * None of it was earning its keep either: Deepgram normalizes levels server
 * side, and Zoom/Meet already run their own AGC and echo cancellation, so ours
 * was a second copy of each fighting the first.
 *
 * THE COST, since it is a real trade-off and not a free win: with AEC off the
 * mic also hears the far side coming out of the speakers, and that audio is
 * already being captured by the system-audio tap — so their words can reach the
 * transcript twice, the second time labelled as yours. `MicListener` drops
 * those near-duplicates; see the guard there. On headphones it cannot arise.
 */
export function micAudioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId && deviceId !== "default"
      ? { deviceId: { exact: deviceId } }
      : {}),
    autoGainControl: false,
    echoCancellation: false,
    noiseSuppression: false,
  };
}

/**
 * Same as resolveBrowserAudioInputId but for output (speaker) devices, used to
 * route a test sound to the selected output via setSinkId when supported.
 */
export async function resolveBrowserAudioOutputId(
  deviceName?: string
): Promise<string | undefined> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return undefined;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter(
      (d) => d.kind === "audiooutput" && d.deviceId && d.label
    );
    if (!deviceName || outputs.length === 0) return undefined;
    const name = deviceName.toLowerCase().trim();
    const match =
      outputs.find((d) => d.label.toLowerCase() === name) ||
      outputs.find((d) => d.label.toLowerCase().includes(name)) ||
      outputs.find((d) => name.includes(d.label.toLowerCase()));
    return match?.deviceId || undefined;
  } catch {
    return undefined;
  }
}

export const floatArrayToWav = (
  audioData: Float32Array,
  sampleRate: number = 16000,
  format: "wav" | "mp3" | "ogg" = "wav"
): Blob => {
  const buffer = new ArrayBuffer(44 + audioData.length * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  const dataSize =
    format === "wav" ? 36 + audioData.length * 2 : 44 + audioData.length * 2;
  view.setUint32(4, dataSize, true);
  writeString(8, format === "wav" ? "WAVE" : "FORM");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, audioData.length * 2, true);

  // Convert float samples to 16-bit PCM
  let offset = 44;
  for (let i = 0; i < audioData.length; i++) {
    const sample = Math.max(-1, Math.min(1, audioData[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: `audio/${format}` });
};
