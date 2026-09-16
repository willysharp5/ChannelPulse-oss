import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

/**
 * Vendor API secrets must NEVER reach the client. Vite inlines every
 * VITE_-prefixed variable into the built bundle, so a secret under a VITE_ name
 * would ship inside the app and be readable by anyone who unpacks it. This guard
 * fails the build if any such variable is set — catching a regression before it
 * can leak.
 *
 * In ChannelPulse OSS there is no server to hold keys: every AI / STT / TTS /
 * embedding / web-search credential is entered by the user AT RUNTIME (in
 * Settings) and stored only on their device. So NO provider key belongs in the
 * environment at all. Beyond the explicit list, this also rejects any VITE_ var
 * whose name looks like a credential (…API_KEY / …SECRET / …TOKEN / …PASSWORD).
 */
const FORBIDDEN_CLIENT_ENV = [
  "VITE_OPENAI_API_KEY",
  "VITE_OPENROUTER_API_KEY",
  "VITE_FIRECRAWL_API_KEY",
  "VITE_DEEPGRAM_API_KEY",
  "VITE_ASSEMBLYAI_API_KEY",
  "VITE_ANTHROPIC_API_KEY",
  "VITE_MOONSHOT_API_KEY",
];

const SECRET_SHAPED_VITE = /^VITE_.*(API_KEY|SECRET|TOKEN|PASSWORD)$/i;

function assertNoClientSecrets(
  env: Record<string, string>,
  command: string
): void {
  const leaked = Object.keys(env).filter(
    (k) =>
      (env[k] ?? "").trim() !== "" &&
      (FORBIDDEN_CLIENT_ENV.includes(k) || SECRET_SHAPED_VITE.test(k))
  );
  if (!leaked.length) return;
  const msg =
    `\n[security] ${leaked.length} secret-shaped variable(s) are set under ` +
    `VITE_ names and would be inlined into the client bundle:\n  ${leaked.join(
      "\n  "
    )}\n` +
    `ChannelPulse is BYOK: remove these from .env* — users enter their keys at ` +
    `runtime in Settings, and keys never belong in the build environment.\n`;
  // Block production builds outright; only warn in dev (never distributed).
  if (command === "build") throw new Error(msg);
  console.warn(msg);
}

/**
 * Supabase auth is OPTIONAL in ChannelPulse OSS. The app is fully usable with no
 * account and no network, and nothing is gated behind sign-in; it exists only
 * for people pointing the app at their own backend, where it turns on sync and
 * the question bank. A build with these vars absent is therefore valid and
 * common — so this only emits a note, never throws.
 *
 * The one genuine misconfiguration is setting exactly one of the pair, which
 * leaves `isAuthConfigured()` false in a confusing way; we call that out.
 */
const AUTH_CLIENT_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

function noteAuthConfig(env: Record<string, string>): void {
  const present = AUTH_CLIENT_ENV.filter((k) => (env[k] ?? "").trim() !== "");
  if (present.length === 0) {
    console.info(
      "\n[config] Building fully local: no Supabase auth configured, so " +
        "sign-in, sync and the question bank are off. Everything else works.\n"
    );
  } else if (present.length === 1) {
    console.warn(
      "\n[config] Only one of VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY is " +
        "set. Auth needs both — sign-in stays disabled until both are " +
        "provided.\n"
    );
  }
}

// https://vite.dev/config/
export default defineConfig(async ({ mode, command }) => {
  const env = loadEnv(mode, process.cwd());
  assertNoClientSecrets(env, command);
  noteAuthConfig(env);
  return {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // tauri-plugin-macos-permissions-api is only ever reached via a runtime-
    // conditional dynamic import() (never a static import), so Vite's initial
    // dependency scan misses it and serves a 504 the first time it's actually
    // imported — which the Tauri webview doesn't auto-recover from the way a
    // regular browser tab does. Force it into the initial pre-bundle instead.
    include: [
      "monaco-editor",
      "@monaco-editor/react",
      "tauri-plugin-macos-permissions-api",
    ],
  },
  worker: {
    format: "es",
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  };
});
