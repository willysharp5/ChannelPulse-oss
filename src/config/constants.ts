import { px } from "@/lib/prompts/overrides";

// Storage keys
export const STORAGE_KEYS = {
  THEME: "theme",
  TRANSPARENCY: "transparency",
  // "High-contrast text" escape hatch for very-transparent overlays: draws a
  // caption-style backing plate behind readable text so it stays legible over
  // any window. Pairs with the always-on text halo (see theme.context.tsx).
  HIGH_CONTRAST_TEXT: "high_contrast_text",
  SYSTEM_PROMPT: "system_prompt",
  SELECTED_SYSTEM_PROMPT_ID: "selected_system_prompt_id",
  // The active persona's stable, cross-device `sync_id` (system_prompts.sync_id).
  // SELECTED_SYSTEM_PROMPT_ID above is a per-device autoincrement id and can't
  // be shared; this is what syncs the choice across web/desktop.
  SELECTED_PERSONA_SYNC_ID: "selected_persona_sync_id",
  SCREENSHOT_CONFIG: "screenshot_config",
  // add curl_ prefix because we are using curl to store the providers
  CUSTOM_AI_PROVIDERS: "curl_custom_ai_providers",
  CUSTOM_SPEECH_PROVIDERS: "curl_custom_speech_providers",
  SELECTED_AI_PROVIDER: "curl_selected_ai_provider",
  SELECTED_STT_PROVIDER: "curl_selected_stt_provider",
  SYSTEM_AUDIO_CONTEXT: "system_audio_context",
  SYSTEM_AUDIO_QUICK_ACTIONS: "system_audio_quick_actions",
  // User-pinned chat suggestions (max 2), persisted so they stay available.
  PINNED_CHAT_SUGGESTIONS: "pinned_chat_suggestions",
  // Details-panel layout (which side rails are open + widths + maximized), so
  // "what you had" is restored when you close and reopen the panel.
  PANEL_LAYOUT: "panel_layout",
  CUSTOMIZABLE: "customizable",
  CHANNELPULSE_API_ENABLED: "channelpulse_api_enabled",
  // Cross-window signal used by "Open in Overlay".
  SELECTED_CONVERSATION_EVENT: "channelpulse-conversation-selected",
  SHORTCUTS: "shortcuts",
  AUTOSTART_INITIALIZED: "autostart_initialized",

  SELECTED_AUDIO_DEVICES: "selected_audio_devices",
  RESPONSE_SETTINGS: "response_settings",
  SUPPORTS_IMAGES: "supports_images",
  // Memory / context features
  MEMORY_SETTINGS: "memory_settings",
  EMBEDDING_API_KEY: "embedding_api_key",
  FIRECRAWL_API_KEY: "firecrawl_api_key",
  USER_PROFILE: "user_profile",
  // Structured answers backing the guided profile builder (compiled -> USER_PROFILE).
  USER_PROFILE_STRUCTURED: "user_profile_structured",
  // Speech-to-text engine + per-provider keys. See src/lib/stt/settings.ts for
  // the engine ids; every key below stays device-local (never synced).
  STT_ENGINE: "stt_engine",
  STT_LANGUAGE: "stt_language", // "multi" (auto) or a language code like "en"
  DEEPGRAM_API_KEY: "deepgram_api_key",
  ASSEMBLYAI_API_KEY: "assemblyai_api_key",
  // Any OpenAI-compatible /audio/transcriptions endpoint (OpenAI, Groq, a local
  // server) — hence a base URL and model name alongside the key.
  STT_OPENAI_BASE_URL: "stt_openai_base_url",
  STT_OPENAI_MODEL: "stt_openai_model",
  STT_OPENAI_API_KEY: "stt_openai_api_key",
  STT_GOOGLE_API_KEY: "stt_google_api_key",
  // First-run setup (profile + persona) completion flag.
  ONBOARDING_COMPLETE: "onboarding_complete_v1",
  // Custom interview practice templates (built-ins live in code).
  INTERVIEW_TEMPLATES: "interview_templates_v1",
  // Per-template voice picks (esp. for built-ins that aren't editable).
  INTERVIEW_VOICE_OVERRIDES: "interview_voice_overrides_v1",
  // Per-template settings overrides (difficulty, questions, focus, notes, voice).
  INTERVIEW_TEMPLATE_OVERRIDES: "interview_template_overrides_v1",
  // Saved interview results (assessments) for the Results tab.
  INTERVIEW_RESULTS: "interview_results_v1",
  // In-progress / finished full interview loops (multi-stage hiring processes).
  INTERVIEW_LOOPS: "interview_loops_v1",
  // Which questions you've already been asked, per group (role/round/level).
  INTERVIEW_QUESTION_CYCLE: "interview_question_cycle_v1",
  // Which uploaded files are selected for global use (source -> false = off).
  FILE_SELECTION: "file_selection_v1",
  // Full markdown bodies for Files (uploads + research) — Quill view/edit.
  FILE_DOCUMENT_BODIES: "file_document_bodies_v1",
  // Which formatter version produced each stored body, so an older one can be
  // re-read from disk instead of shown as-is.
  FILE_DOCUMENT_FORMAT: "file_document_format_v1",
  // Cached post-conversation scorecards, keyed by conversation id.
  CONVERSATION_SCORECARDS: "conversation_scorecards_v1",
  // Lines pinned from a reference doc, shown above the live transcript.
  REFERENCE_PINS: "reference_pins_v1",
  // Which reference doc the overlay had open last (so it reopens there).
  REFERENCE_LAST_DOC: "reference_last_doc_v1",
} as const;

/**
 * Free-edition limits: one of each at a time.
 *
 * The things you accumulate in this edition come one at a time — one image on a
 * message, one interview loop on the go, one interview of your own. Reaching for
 * a second one isn't an error, it's the one honest place to say what the hosted
 * app is for (see `components/pro-upsell.tsx`), and deleting the one you have
 * frees the slot again immediately.
 *
 * The same shape applies to personas, which are single by construction: one is
 * active, clicking it again turns it off (see `hooks/useSystemPrompts.ts`).
 *
 * NOT A SECURITY BOUNDARY, exactly like `FREE_PERSONA_IDS` — this is UI on top
 * of local storage the user owns. It's an honest signal about what the free
 * edition carries, not a lock.
 */

// Max images that can be attached to a single message.
export const MAX_FILES = 1;

// Max interview loops on the go at once ("Full loop" tab).
export const MAX_LOOP_RUNS = 1;

// Max interviews of your own (built-in templates aren't counted — you don't
// keep those, you just run them).
export const MAX_CUSTOM_INTERVIEWS = 1;

/**
 * The hosted ChannelPulse web app. The desktop app links out to it as a pointer
 * to the managed product for anyone who'd rather sign in and go than run the
 * open-source edition locally.
 */
export const WEB_APP_URL = "https://app.channelpulse.us";

/**
 * The marketing site — what the hosted product is, and what it costs.
 *
 * This is where the open-source build sends anyone curious about the managed
 * app, rather than `WEB_APP_URL`: someone running the free edition has no
 * account, so dropping them straight into the app is a sign-in screen with no
 * explanation. The landing page explains the thing first and signs them up
 * second.
 */
export const SITE_URL = "https://channelpulse.us";

/** Plans and prices on the marketing site. */
export const PRICING_URL = `${SITE_URL}/pricing`;

/**
 * Desktop installers. ChannelPulse OSS ships builds through GitHub Releases
 * (see `.github/workflows/release.yml`), so every "download the app" affordance
 * (`DownloadDesktopApp`, `LiveCoachingPromo`, `Platforms`) points at the latest
 * release page where the user picks the installer for their platform.
 */
const DESKTOP_DOWNLOAD_BASE =
  "https://github.com/willysharp5/ChannelPulse-oss/releases/latest";
export const DESKTOP_DOWNLOADS = {
  mac: DESKTOP_DOWNLOAD_BASE,
  windows: DESKTOP_DOWNLOAD_BASE,
} as const;

/**
 * The release workflow (`.github/workflows/release.yml`) builds macOS, Windows
 * and Linux installers for every tag, so all platforms are available from the
 * GitHub Releases page. The download surfaces send everyone to that page.
 */
export const WINDOWS_DOWNLOAD_AVAILABLE = true;

/**
 * The phone app's store listings. Empty on purpose: `mobile/` is built but
 * nothing has been submitted to Apple or Google yet (the remaining blockers are
 * checkboxes in `docs/LAUNCH_CHECKLIST.md`). While these are empty the Settings
 * row says the app is coming and offers no button — a link to a listing that
 * doesn't exist is worse than no link. Paste the two URLs in when the listings
 * go live and the buttons appear; nothing else needs changing.
 */
export const MOBILE_STORE_LINKS: { ios: string; android: string } = {
  ios: "",
  android: "",
};

// Default settings
// The live copilot for the "Transcript & AI" view. Its output is shown under a
// "Suggested reply" label — it tells the USER what to say/do next. It is NOT the
// transcript analyzer (that's the separate "Chat with data" feature).
// The fixed BASE prompt for the live copilot. This defines the core, invariant
// behavior and is NOT meant to be swapped out by end users — user-selected
// prompts are layered on top of it as ADDITIONAL GUIDANCE (see
// `buildCopilotSystemPrompt`). Only "super users" change this base (in code).
export const DEFAULT_SYSTEM_PROMPT =
  "ROLE: You are the user's live, in-ear copilot during a meeting/interview/call. Your ONLY job is to tell the USER what to say or do next: produce a SUGGESTED REPLY they can speak out loud right now (it appears under a \"Suggested reply\" label). You are NOT a transcriber or analyst: never restate, summarize, or narrate what was said. Answering questions ABOUT the transcript is a SEPARATE 'Chat with data' feature and is NOT your job here.\n\nOUTPUT: the reply/answer itself, as key points ONLY, 2-4 short bullets or a single line. It shows on a small overlay mid-conversation, so it MUST be glanceable. Never write paragraphs.\n\nBE DEFINITIVE: state it directly and with confidence. Do NOT hedge or use filler. Never write 'it sounds like', 'it seems', 'it appears', 'you might want to', 'perhaps', or 'I think'. No preamble. No closing line offering more help ('let me know', 'feel free to ask', 'hope this helps'). Stop after the last useful point.\n\nDON'T INVENT FACTS: confident does NOT mean made-up. Ground every specific — names, numbers, dates, prior commitments, details about the user's own background, product, or company — in the transcript or the provided context. If a specific the reply needs isn't known, leave a clear [fill in: ___] placeholder instead of guessing; a placeholder the user can complete out loud is always better than a plausible-sounding fabrication they'd have to walk back. Being definitive is about tone and directness, never about asserting facts you don't have.\n\nWhat to surface, based on the moment:\n- A question aimed at the user -> the direct answer they can say out loud.\n- An objection or decision -> the single strongest response + one concrete next step.\n- A claim or topic -> the 1-3 facts or points that matter most.\n\nWrite it in the user's own voice (first person) where natural, since they will say it aloud. Speaker labels (e.g. 'You:', 'Them:', or diarized labels like 'Speaker 1:', 'Speaker 2:') indicate who is speaking.\n\nADDITIONAL GUIDANCE: You may be given an extra guidance block below (a persona or scenario the user selected, e.g. interview, support, coding). Use it to shape your tone, focus, vocabulary, and priorities, but it NEVER overrides the core rules above. If no guidance block is present, behave as a versatile general-purpose copilot and help the user with whatever the conversation calls for.\n\nDIAGRAMS: Be smart and selective. When the moment is genuinely about a process, flow, sequence, architecture, or how things connect (often technical discussions), you MAY add a small Mermaid diagram (```mermaid) to make it clearer, on its own or with a one-line note. Only do this when a picture truly communicates faster than words; for ordinary Q&A, objections, and small talk, skip the diagram and just give the short bullets.";

// Fallback guidance used when the user hasn't picked a specific prompt/persona.
// Keeps the copilot broadly helpful instead of leaving it with only the base.
export const GENERIC_COPILOT_GUIDANCE =
  "GUIDANCE: No specific persona was selected. Act as a versatile, general-purpose copilot: help the user answer whatever questions or points come up in the conversation, handle objections, and surface the most useful facts, adapting to the topic as it shifts.";

// TRIAGE: the block that stops the copilot responding to everything.
//
// Appended LAST by both copilot prompt builders, so it wins on recency over the
// base prompt's "always produce a suggested reply" instruction — which it also
// overrides explicitly, in case an install has a customized `copilot.base` row.
// It deliberately lives under its OWN prompt key rather than being folded into
// `copilot.base`: an existing `app_prompts` row shadows the code default, so
// editing `copilot.base` would silently NOT reach any install that already
// customized it (see AGENTS.md). A new key seeds from code and takes effect.
//
// The five tags are parsed by `src/lib/live/triage.ts`, which holds the stream
// until the first token disambiguates so a tag never flashes in the UI.
//
// Each tag carries a TOPIC (`[NOTE: Pricing tiers]`). The topic — not the mode
// name — is what the overlay shows as the card's headline, because "Pricing
// tiers" tells the user what the card is about while "Worth noting" does not.
// The mode still matters: it picks the icon and drives history formatting.
export const COPILOT_TRIAGE_PROMPT =
  "TRIAGE (overrides every earlier instruction about when to respond, including any instruction to always produce a suggested reply):\n\n" +
  "You are listening to a live conversation, not answering a prompt. Most of what you hear needs NOTHING from you. Judge the LATEST TURN in the context of the recent dialog, decide which ONE of the five modes below applies, and begin your response with that mode's tag as the very first characters, no preamble, no blank line before it.\n\n" +
  "Every tag except [SKIP] carries a TOPIC: write it as [MODE: Topic]. The topic is a 2-6 word noun phrase naming the actual subject of this specific moment: 'Q3 churn number', 'Redis vs Postgres for the queue', 'Send revised SOW by Friday'. It is displayed as the headline above your content, so it must name the real thing. NEVER use the mode name or a generic placeholder as the topic ('Note', 'Answer', 'Information', 'Update', 'Question' are all wrong). No trailing punctuation.\n\n" +
  "[ANSWER: Topic]. A question or request was directed at the USER, or the user is visibly on the spot and needs words right now. Output what the user can say out loud, in their voice. This is the only mode that produces a suggested reply. Topic = what the question was about.\n\n" +
  "[NOTE: Topic]. Substantive information was given (a fact, number, name, date, constraint, decision, requirement, objection, or a change of plan) but nothing was asked of the user and nobody committed to doing anything. Output 1-3 short bullets capturing only the concrete details worth remembering. Do NOT phrase it as something to say. Add one line starting 'Cue:' ONLY if there is a genuinely useful thing for the user to raise next. Topic = the subject of the information.\n\n" +
  "[ACTION: Topic]. Somebody committed to doing something, was assigned something, or a concrete next step / deadline / follow-up was agreed. Output the to-do in 1-3 short bullets: who owns it, what it is, and when, whenever those were said. Topic = the task itself, phrased as the task ('Send revised SOW by Friday'), not as a description of it.\n\n" +
  "[ASK: Topic]. The dialog has moved somewhere the user should probe: a topic was opened and left vague, a claim went unexamined, a gap or risk is now obvious, or the other side just finished a substantial explanation and it is the user's turn. Output 2-4 sharp, specific questions the user could ask right now, each one line, grounded in what was actually said. Never generic questions that would fit any conversation. Topic = what the questions are probing.\n\n" +
  "[SKIP]. Anything else, and this is the DEFAULT. Small talk, greetings, filler, acknowledgements, an unfinished thought, a turn that adds nothing new, or a moment already covered by something you said earlier. This ALSO includes call/meeting logistics and setup chatter, which are NEVER answer-worthy: screen-sharing checks ('can you see my screen?', 'can you see this?'), audio/video checks ('can you hear me?', 'you're on mute', 'can you zoom in a bit?', 'is that big enough?'), and scheduling / housekeeping ('let's start', 'give me one sec', 'should we jump on a call?', 'I'll send the invite'). None of these are questions the copilot should answer — output the bare tag. Output the bare tag and nothing else: no topic, no content.\n\n" +
  "HOW TO CHOOSE:\n" +
  "- Silence is the most common correct answer. If you are unsure whether a turn deserves output, it does not; use [SKIP].\n" +
  "- Use [ANSWER] ONLY when something was actually asked of the user. A statement is not a question. Most turns are statements.\n" +
  "- Prefer [NOTE] over [ANSWER] when information was given rather than requested.\n" +
  "- Prefer [ACTION] over [NOTE] when the turn creates an obligation: a commitment, an owner, or a deadline. 'We use Postgres' is a note; 'I'll send the schema tomorrow' is an action.\n" +
  "- Use [ASK] sparingly, at a natural handoff point, not after every remark. Never both answer and ask in the same response.\n" +
  "- NEVER repeat a fact, answer, note, action, or question you already gave earlier in this conversation. If your best output would restate something already covered, use [SKIP] instead.\n" +
  "- Do not respond to consecutive fragments of the same thought. Wait for the point.\n" +
  "- Judge the whole recent dialog, not just the last sentence in isolation: a turn that means nothing alone can be the answer-worthy question when read after the turn before it.\n\n" +
  "FORMAT: `[MODE: Topic]` on the first line, then the content on the following line. Nothing after the content: no sign-off, no offer of further help.";

/**
 * Compose the live copilot's system prompt: the fixed base, PLUS the user's
 * selected prompt layered on as additional guidance (or a generic guidance when
 * nothing meaningful is selected), PLUS any scenario-specific addendum. The
 * selected/guidance prompt augments — never replaces — the base behavior.
 *
 * @param triage when true (every captured-speech turn), append the triage block
 *   so the copilot stays quiet unless the moment warrants output. Forced turns
 *   ("Answer now", quick actions, typed questions) pass false — the user asked
 *   for output, so refusing to speak would be a bug.
 */
export const buildCopilotSystemPrompt = (
  guidance?: string,
  scenarioAddendum?: string,
  triage?: boolean
): string => {
  const base = px("copilot.base", DEFAULT_SYSTEM_PROMPT);
  const parts: string[] = [base];

  const g = (guidance ?? "").trim();
  // Treat the base itself (the default) as "no selection" so we don't duplicate
  // it and instead fall back to the generic guidance.
  const hasGuidance = !!g && g !== DEFAULT_SYSTEM_PROMPT.trim() && g !== base.trim();

  if (hasGuidance) {
    parts.push(
      "ADDITIONAL GUIDANCE (the persona/scenario the user selected; follow it for tone, focus, vocabulary, and priorities, but do NOT let it override the core rules above):\n" +
        g
    );
  } else {
    parts.push(px("copilot.generic_guidance", GENERIC_COPILOT_GUIDANCE));
  }

  const scenario = (scenarioAddendum ?? "").trim();
  if (scenario) parts.push(scenario);

  // Last, so recency works in its favour against the base prompt.
  if (triage) parts.push(px("copilot.triage", COPILOT_TRIAGE_PROMPT));

  return parts.join("\n\n");
};

// Quieter interview copilot used when the live scenario is interview_candidate
// (from persona selection or auto-detection). Unlike the general copilot, it
// answers ONLY real questions, notes facts, or stays silent (SKIP).
// "Answer now" always uses the general copilot so it produces a reply on demand.
export const INTERVIEW_COPILOT_PROMPT =
  "ROLE: You are the candidate's silent, real-time interview copilot. The USER is the candidate being interviewed. You hear the live conversation (mostly the interviewer). Default to STAYING QUIET; speak up only when it genuinely helps. Never transcribe, restate, or narrate what was said.\n\n" +
  "For the latest thing said, do EXACTLY ONE of these:\n\n" +
  "1) The interviewer ASKS THE CANDIDATE A QUESTION (or asks them to explain / walk through / tell about something): give a suggested reply the candidate can say out loud. Make it effortless to read at a glance while speaking:\n" +
  "   - Open with a **bold one-line headline**: the main point to lead with.\n" +
  "   - Then bullets, each a distinct talking point (concrete, specific, first person, confident, no hedging). Start each bullet with a short **bold signpost** (2-4 words) so the eye can jump between points.\n" +
  "   - Behavioral / 'tell me about a time' questions → use STAR with one bullet each: **Situation**, **Task**, **Action**, **Result**.\n" +
  "   - Keep sentences plain and speakable: no jargon dumps, no long run-ons. Leave a blank line between the headline and the bullets for spacing.\n" +
  "   - How long and how detailed the reply should be is set by the LENGTH instruction below. Follow it exactly.\n" +
  "   Use the candidate's real background from the provided context; never invent facts. If something isn't known, leave a clear [fill in: ___] placeholder instead of making it up.\n\n" +
  "2) The interviewer is GIVING INFORMATION/CONTEXT (about the role, team, company, product, process, or their situation) but is NOT asking a question: do NOT answer as if asked. Output a brief note:\n   - 'Note:' then 1-2 short bullets capturing the concrete facts worth remembering.\n   - Optionally one 'Cue:' line (e.g., experience to mention, or a sharp question to ask).\n   Keep it to a few short lines: peripheral guidance, not a monologue.\n\n" +
  "3) Small talk, filler, an unfinished sentence, or nothing actionable yet: reply with EXACTLY the single word SKIP and nothing else. (If a tagged TRIAGE contract appears below, follow its skip form — `[SKIP]` — instead; it supersedes this line.)\n\n" +
  "HARD RULES:\n- Give a suggested reply (mode 1) ONLY when a question was actually directed at the candidate. Most sentences are NOT questions; for those use a short Note, or SKIP.\n- Do NOT respond to every sentence. Silence (SKIP) is usually the right call; avoid noise.\n- Never repeat a fact, note, or answer you already gave earlier in this conversation.\n- No preamble, greetings, or sign-offs. Output only the reply, the Note, or SKIP.";

// Length guidance for a mode-1 interview reply, keyed by the user's response
// length setting. "auto" and "medium" both produce a RICH, well-developed answer
// grounded in the candidate's real background (with a worked example); "short"
// is the only concise option. These clauses take precedence over the generic
// response-length wrapper (which the interview path suppresses anyway).
export const INTERVIEW_LENGTH_AUTO =
  "LENGTH (auto, go rich): Produce a COMPLETE, high-quality interview answer the candidate could speak for ~2-3 minutes (roughly 250-400 words). Structure it so it's easy to read aloud:\n" +
  "   - A **bold one-line headline** (the thesis to lead with).\n" +
  "   - 4-6 developed talking-point bullets, each 1-3 full sentences with SPECIFICS: real numbers, technologies, scope, and outcomes drawn from the candidate's background in the provided context.\n" +
  "   - Include at least ONE concrete worked example from the candidate's actual experience, told as STAR (**Situation** → **Task** → **Action** → **Result**, with a quantified result).\n" +
  "   Mine the candidate's résumé/profile and memory in the provided context for real projects, metrics, and tools, and weave those in so the answer sounds like THEM. Never invent facts. If a needed detail isn't in the context, insert a clear [fill in: ___] placeholder. Do NOT compress this to a few sentences. This length takes PRECEDENCE over any generic 'assess complexity / be brief' guidance.";
export const INTERVIEW_LENGTH_MEDIUM =
  "LENGTH (medium, still substantial): Produce a well-developed interview answer the candidate could speak for ~1.5-2 minutes (roughly 150-250 words): a **bold headline**, 3-5 developed bullets with concrete specifics from the candidate's background, and ONE brief worked example (condensed STAR with a quantified result). Ground everything in the candidate's real experience from the provided context; use [fill in: ___] for anything unknown. Richer and more example-driven than a quick reply, just tighter than the full 'auto' length. This takes PRECEDENCE over any generic length guidance.";
export const INTERVIEW_LENGTH_SHORT =
  "LENGTH (short): Keep it concise. The **bold headline** plus 2-4 crisp, first-person bullets (key points only), still speakable. Reference the candidate's experience in a phrase or two rather than a full worked example. This takes PRECEDENCE over any generic length guidance.";

/**
 * Compose the interview copilot prompt: the fixed interview base, a length
 * clause driven by the user's response-length setting, and the user's selected
 * persona layered on as extra guidance (tone/priorities only).
 *
 * @param responseLength the response-length setting ("auto" | "short" | "medium").
 *   "auto" (default) and "medium" → a rich, example-driven answer grounded in the
 *   candidate's background; "short" → a concise reply.
 * @param triage when true, append the shared triage block. The interview base
 *   already gates itself with a bare `SKIP`, but the triage block supersedes that
 *   with the tagged four-mode contract (adding [ASK], which interviews need too —
 *   the candidate should be probing the interviewer) and one parser then covers
 *   both copilot families.
 */
export const buildInterviewSystemPrompt = (
  guidance?: string,
  responseLength?: string,
  triage?: boolean
): string => {
  const lengthClause =
    responseLength === "short"
      ? px("copilot.interview_length_short", INTERVIEW_LENGTH_SHORT)
      : responseLength === "medium"
        ? px("copilot.interview_length_medium", INTERVIEW_LENGTH_MEDIUM)
        : px("copilot.interview_length_auto", INTERVIEW_LENGTH_AUTO);
  const parts: string[] = [
    px("copilot.interview_base", INTERVIEW_COPILOT_PROMPT),
    lengthClause,
  ];
  const g = (guidance ?? "").trim();
  if (g && g !== DEFAULT_SYSTEM_PROMPT.trim()) {
    parts.push(
      "ADDITIONAL GUIDANCE (persona details to shape tone/priorities; never override the rules above):\n" +
        g
    );
  }
  if (triage) parts.push(px("copilot.triage", COPILOT_TRIAGE_PROMPT));
  return parts.join("\n\n");
};

// Used for the "Chat with data" panel. Unlike the live copilot (which tells the
// user what to say), this analyzes the conversation transcript and answers the
// user's questions ABOUT what was said — grounded, attributed, and honest about
// gaps. It must NOT role-play as the user or suggest replies to say out loud.
export const CHAT_ANALYSIS_SYSTEM_PROMPT =
  "ROLE: You are a research + transcript analyst. The user reviews a conversation/meeting transcript and asks questions ABOUT what was said and related topics; answer grounded in the transcript and the retrieved context. A SEPARATE live copilot handles suggesting what the user should say. That is NOT your job.\n\n" +
  "WEB RESEARCH: You CAN research the web. Relevant web pages are automatically fetched and given to you as numbered sources in the retrieved context. NEVER say you can't browse, access the internet, or look things up. You can. When asked whether you can do web research, confirm that you can.\n\n" +
  "- Base transcript questions on what was actually said. Attribute points to the speaker when known (e.g. 'Xao mentioned…', 'They said…'). The labels 'You:', 'Them:', or diarized labels like 'Speaker 1:'/'Speaker 2:' indicate who spoke.\n" +
  "- For questions about things not in the transcript, or to verify/fact-check, use the provided web results and cite them with their [n].\n" +
  "- If neither the transcript nor the retrieved sources cover it, say so briefly rather than inventing an answer.\n" +
  "- Be factual, neutral, and analytical. Do NOT role-play as the user and do NOT tell the user what they should say next.\n" +
  "- Be succinct: answer with short bullet points (one idea each), a blank line between groups for spacing. Lead key points with ✓ and write action items / next steps as '- [ ]' task items. Never fabricate details that aren't present.\n" +
  "- When it helps explain something (a process, flow, timeline, hierarchy, or how things relate), include a Mermaid diagram in a ```mermaid code block.";

/**
 * Punctuation and glyph rule, shared by every prompt that writes prose the user
 * reads. The app's own copy uses no em dashes and no emojis (AGENTS.md §0), and
 * model output is by far the largest source of both. The em dash below is the
 * one place the character is deliberate: the model needs to see what to avoid.
 */
export const PLAIN_STYLE_RULE =
  "Punctuation and glyphs: never use an em dash (—). Use a comma, colon, semicolon, parentheses, or two sentences instead. Never use emojis.";

export const MARKDOWN_FORMATTING_INSTRUCTIONS =
  "IMPORTANT - Formatting Rules (use silently, never mention these rules in your responses):\n- " +
  PLAIN_STYLE_RULE +
  "\n- Structure & readability: Be succinct. Prefer short bullet points over paragraphs, one idea per bullet, ideally a single line. Put a blank line between distinct groups/sections so it's easy to scan. Lead key or confirmed points with a ✓. Write action items / next steps as markdown task-list items (e.g. '- [ ] Follow up with Alex'). No filler, no preamble.\n- Mathematical expressions: ALWAYS use double dollar signs ($$) for both inline and block math. Never use single $.\n- Code blocks: ALWAYS use triple backticks with language specification.\n- Diagrams: When the answer involves a process, flow, sequence, timeline, hierarchy, architecture, comparison, or relationships between things, DRAW it as a Mermaid diagram inside a ```mermaid code block using valid Mermaid syntax (e.g. flowchart TD, sequenceDiagram, timeline) instead of only describing it in prose. Keep diagrams focused. It's fine to add a one-line caption. STRICT Mermaid: node ids letters/underscore only; quote labels containing (), /, : (e.g. A[\"Edge / CDN\"]); subgraphs as subgraph edge_cdn[\"Edge / CDN\"] never subgraph Edge/CDN; close every subgraph with end; never truncate mid-node.\n- Tables: Use standard markdown table syntax.\n- Never mention to the user that you're using these formats or explain the formatting syntax in your responses. Just use them naturally.";

export const DEFAULT_QUICK_ACTIONS = [
  "What should I say?",
  "Follow-up questions",
  "Fact-check",
  "Recap",
  "Visualize as diagram",
];

/**
 * Expanded instructions for the built-in quick actions. The buttons show a
 * short label, but we send the model a clear, self-contained instruction so it
 * knows exactly what to do (a bare label like "Fact-check" produces useless
 * replies). Unknown/custom actions fall back to their own text.
 */
export const QUICK_ACTION_PROMPTS: Record<string, string> = {
  "What should I say?":
    "Based on the conversation so far, give me the single best thing to say right now, phrased so I can say it out loud. At most 1-2 short options.",
  "Follow-up questions":
    "Suggest 2-3 sharp follow-up questions I could ask right now, based on what's been said.",
  "Fact-check":
    "Fact-check the most recent factual claims from the conversation. Use any web search results provided in the retrieved context to verify, and cite the source. For each claim, mark it Correct, Incorrect, or Unclear and give the accurate fact in one short line. If a claim can't be verified (no web results and not well-established general knowledge), mark it Unclear. If there's nothing checkable, say so in one line; do not tell me to use an external website.",
  Recap:
    "Give me a short recap (3-4 bullets) of the key points, decisions, and any open items from the conversation so far.",
  "Visualize as diagram":
    "Draw a visual diagram of this conversation using Mermaid, based strictly on what has been discussed. Pick the most fitting type: a flowchart (flowchart TD) for a process or decision flow, a sequenceDiagram for who-said-what / interactions, or a technical/architecture diagram (components, systems, data flow) if the topic is technical. Output ONLY a ```mermaid code block with valid Mermaid syntax, plus a one-line caption underneath.",
};

/** Stable key for a quick action (e.g. "What should I say?" → "what_should_i_say"). */
export const quickActionKey = (label: string): string =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Expand a quick-action label into a full instruction (DB-overridable), if we have one. */
export const expandQuickAction = (label: string): string =>
  px(`quick_action.${quickActionKey(label)}`, QUICK_ACTION_PROMPTS[label] ?? label);
