import type { ShowcaseSlide } from "./ShowcaseTour";
import {
  OverlayMock,
  TranscriptMock,
  QuestionBankMock,
  FilesMock,
} from "./AppMocks";

/**
 * localStorage flag: set once the user has seen (or dismissed) the first-launch
 * pitch for the hosted app, so it only ever opens itself once.
 */
export const PRO_PITCH_SEEN_KEY = "cp:pro-pitch-seen-v1";

/**
 * What the hosted app adds on top of this one — shown once, on first launch,
 * in place of the mechanics tour.
 *
 * This build is the free edition: everything runs on your machine with your own
 * model and your own whisper weights. The pitch exists because that trade-off
 * isn't obvious from inside the app — someone who'd rather not manage any of it
 * has no way of knowing there's a managed version until something tells them.
 *
 * Every claim here is the same wording as the "What Pro adds on top" list on
 * channelpulse.us/pricing and the OSS-vs-hosted table in README.md. Keep the
 * three in step: if a line changes on the pricing page, change it here too.
 */
export const PRO_PITCH: ShowcaseSlide[] = [
  {
    node: <OverlayMock />,
    title: "Nothing to set up",
    caption:
      "Managed AI and natural cloud voices — no API keys, no models to download.",
  },
  {
    node: <TranscriptMock />,
    title: "Streaming transcription",
    caption:
      "Real-time cloud speech-to-text with speaker diarization, instead of the on-device model you run here.",
  },
  {
    node: <QuestionBankMock />,
    title: "The full prep library",
    caption:
      "Guided tutorials plus thousands of real questions across hundreds of companies.",
  },
  {
    node: <FilesMock />,
    title: "Synced and backed up",
    caption:
      "Your notes, files and personas on every device — desktop, browser and phone — and updates arrive in-app.",
  },
];
