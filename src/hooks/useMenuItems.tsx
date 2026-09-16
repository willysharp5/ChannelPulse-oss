import {
  Settings,
  ClipboardCheckIcon,
  WandSparkles,
  AudioLinesIcon,
  SquareSlashIcon,
  MonitorIcon,
  HomeIcon,
  PowerIcon,
  BugIcon,
  MessageSquareTextIcon,
  FileTextIcon,
  UserIcon,
  GraduationCapIcon,
  CircleHelpIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { getUserProfile } from "@/lib/memory";
import { safeLocalStorage } from "@/lib/storage";
import { STORAGE_KEYS } from "@/config";
import { countMemoriesFiltered } from "@/lib/database/memory.action";
import { isWeb } from "@/lib/platform";

/** Marketing site help center (opened from the sidebar icon). */
export const HELP_CENTER_URL = "https://channelpulse.us/help";

/**
 * Sidebar destinations that only make sense in the desktop app: native audio
 * capture, screen capture, global-shortcut registration and the Responses
 * output surface. Hidden on the web build, where those routes don't exist (see
 * src/routes/web.tsx). App Settings is NOT in here — the web build serves it
 * with the native-window toggles hidden, because account deletion lives there
 * and has to be reachable from a browser.
 */
const DESKTOP_ONLY_HREFS = new Set([
  "/audio",
  "/screenshot",
  "/shortcuts",
  "/responses",
  // Personas (the system-prompt manager) is omitted from the web build to keep
  // it simple — the copilot falls back to generic guidance without one, and the
  // route is dropped in src/routes/web.tsx.
  "/personas",
]);

/** Discord invite used by the Report a bug flow. */
export const DISCORD_INVITE_URL = "https://discord.gg/HkSDTQgb5";

export interface MenuItem {
  icon: React.ElementType;
  label: string;
  href: string;
  count?: number;
  /** Subtle emphasis for core product surfaces */
  featured?: boolean;
  /** Red dot: this setup section still needs the user's attention. */
  alert?: boolean;
  /** Hover reveal explaining why the red dot is showing. */
  alertReason?: string;
}

/**
 * Which "get set up" sections are still incomplete — drives the red dots on the
 * Profile / Personas / Files sidebar items so the user knows what's needed for
 * the app to work well. Re-checked on navigation, window focus, and storage
 * changes, so the dot clears/returns even if they later delete a section.
 */
function useSetupStatus() {
  const location = useLocation();
  const [tick, setTick] = useState(0);
  const [filesDone, setFilesDone] = useState(true);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("focus", bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener("focus", bump);
      window.removeEventListener("storage", bump);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    countMemoriesFiltered({ allScopes: true, kinds: ["file"] })
      .then((n) => {
        if (!cancelled) setFilesDone(n > 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [location.pathname, tick]);

  // Read synchronously each render (re-runs on navigation/focus/storage above).
  const profileDone = getUserProfile().trim().length > 0;
  const personaDone = !!safeLocalStorage.getItem(
    STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID
  );
  return { profileDone, personaDone, filesDone };
}

export interface FooterItem {
  icon: React.ElementType;
  label: string;
  /** In-app path (e.g. `/report-bug`) or external https URL. */
  href?: string;
  action?: () => void | Promise<void>;
}

export interface MenuGroup {
  /** Section heading shown above the group's card. */
  title: string;
  items: MenuItem[];
}

export const useMenuItems = () => {
  const { profileDone, personaDone, filesDone } = useSetupStatus();
  // Related destinations are clustered into titled sections so the sidebar
  // reads as a set of small groups rather than one long list.
  // Super-admin tools (settings, Firecrawl monitors) live on the web console
  // at channelpulse.us/admin — not in the desktop app.
  const menuGroups: MenuGroup[] = [
    {
      title: "Home",
      items: [
        { icon: HomeIcon, label: "Dashboard", href: "/dashboard" },
        {
          icon: GraduationCapIcon,
          label: "Interview Practice",
          href: "/interview-practice",
        },
        // "Recaps", not "Chats": opening one shows a review of the
        // conversation (scores for interviews, key points for meetings), with
        // the raw thread behind a Transcript toggle. Route stays /chats.
        { icon: ClipboardCheckIcon, label: "Recaps", href: "/chats" },
      ],
    },
    {
      title: "Context",
      items: [
        {
          icon: UserIcon,
          label: "Profile",
          href: "/profile",
          alert: !profileDone,
          alertReason:
            "No profile yet. Add your background so the copilot's answers sound like you.",
        },
        {
          icon: WandSparkles,
          label: "Personas",
          href: "/personas",
          alert: !personaDone,
          alertReason:
            "No persona selected. Pick one so the copilot matches your role and tone.",
        },
        {
          icon: FileTextIcon,
          label: "Files",
          href: "/memory",
          alert: !filesDone,
          alertReason:
            "No files yet. Upload your résumé/notes so answers are grounded in your materials.",
        },
      ],
    },
    {
      title: "Capture & output",
      items: [
        { icon: AudioLinesIcon, label: "Audio", href: "/audio" },
        { icon: MonitorIcon, label: "Screenshot", href: "/screenshot" },
        { icon: MessageSquareTextIcon, label: "Responses", href: "/responses" },
        {
          icon: SquareSlashIcon,
          label: "Cursor & Shortcuts",
          href: "/shortcuts",
        },
      ],
    },
    {
      title: "System",
      items: [
        { icon: Settings, label: "App Settings", href: "/settings" },
      ],
    },
  ];

  const footerItems: FooterItem[] = [
    {
      icon: BugIcon,
      label: "Report a bug",
      href: "/report-bug",
    },
    {
      icon: PowerIcon,
      label: "Quit ChannelPulse",
      action: async () => {
        await invoke("exit_app");
      },
    },
  ];

  // On the web build, drop desktop-only destinations (and empty groups) plus
  // the native "Quit" action, so the sidebar only shows what the browser can do.
  const web = isWeb();

  /** Icon-row links (same pattern as the old GitHub button). */
  const footerLinks: {
    title: string;
    icon: React.ElementType;
    link: string;
  }[] = [
    {
      title: "Help",
      icon: CircleHelpIcon,
      link: HELP_CENTER_URL,
    },
  ];
  const visibleGroups = web
    ? menuGroups
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => !DESKTOP_ONLY_HREFS.has(i.href)),
        }))
        .filter((g) => g.items.length > 0)
    : menuGroups;
  const visibleFooterItems = web
    ? footerItems.filter((i) => i.label !== "Quit ChannelPulse")
    : footerItems;

  return {
    menuGroups: visibleGroups,
    footerItems: visibleFooterItems,
    footerLinks,
  };
};
