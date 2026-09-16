import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@/components/ui/toaster";
import { useApp } from "./app.context";

export interface BugReportCapture {
  id: string;
  /** Route path when captured (e.g. `/chats`). */
  route: string;
  base64: string;
  createdAt: number;
}

const MAX_CAPTURES = 8;

interface BugReportContextType {
  /** True while the user is collecting screenshots across the app. */
  active: boolean;
  captures: BugReportCapture[];
  capturing: boolean;
  /** Hide floating UI so it isn't in the shot. */
  hideChromeForCapture: boolean;
  description: string;
  contact: string;
  setDescription: (v: string) => void;
  setContact: (v: string) => void;
  startSession: () => void;
  endSession: () => void;
  captureScreen: (route: string) => Promise<void>;
  /**
   * Web: add screenshots the user picks from disk (no native capture). Reads
   * each image file to base64 and appends it, honoring the same MAX_CAPTURES.
   */
  addImageFiles: (files: FileList | File[], route: string) => Promise<void>;
  removeCapture: (id: string) => void;
  clearCaptures: () => void;
}

/** Read an image File as a bare base64 string (no data: prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      // strip the "data:image/png;base64," prefix -> bare base64
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

const BugReportContext = createContext<BugReportContextType | null>(null);

export function BugReportProvider({ children }: { children: ReactNode }) {
  const { customizable } = useApp();
  const [active, setActive] = useState(false);
  const [captures, setCaptures] = useState<BugReportCapture[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [hideChromeForCapture, setHideChromeForCapture] = useState(false);
  const [description, setDescription] = useState("");
  const [contact, setContact] = useState("");

  const startSession = useCallback(() => {
    setActive(true);
  }, []);

  const endSession = useCallback(() => {
    setActive(false);
    setCaptures([]);
    setDescription("");
    setContact("");
    void invoke("set_window_content_protected", {
      protected: customizable.privacyMode.isEnabled,
    }).catch(() => {});
  }, [customizable.privacyMode.isEnabled]);

  const clearCaptures = useCallback(() => {
    setCaptures([]);
  }, []);

  const removeCapture = useCallback((id: string) => {
    setCaptures((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const captureScreen = useCallback(async (route: string) => {
    setCapturing(true);
    setHideChromeForCapture(true);
    try {
      // Two frames so the floating bar unmounts before the OS snapshot.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      await new Promise((r) => setTimeout(r, 80));

      const b64 = await invoke<string>("capture_bug_report_screenshot", {
        restoreProtected: customizable.privacyMode.isEnabled,
      });
      const next: BugReportCapture = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        route: route || "/",
        base64: b64,
        createdAt: Date.now(),
      };
      setCaptures((prev) => {
        const merged = [...prev, next];
        if (merged.length <= MAX_CAPTURES) return merged;
        toast("Capture limit reached", {
          description: `Keeping the latest ${MAX_CAPTURES} screenshots.`,
          variant: "info",
        });
        return merged.slice(-MAX_CAPTURES);
      });
      setActive(true);
      toast("Screen captured", {
        description:
          "Added to your bug report. Capture more or finish on Report a bug.",
        variant: "success",
      });
    } catch (err) {
      toast("Capture failed", {
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setHideChromeForCapture(false);
      setCapturing(false);
    }
  }, [customizable.privacyMode.isEnabled]);

  const addImageFiles = useCallback(
    async (files: FileList | File[], route: string) => {
      const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (list.length === 0) {
        toast("Not an image", {
          description: "Pick a PNG or JPG screenshot to attach.",
          variant: "info",
        });
        return;
      }
      try {
        const added: BugReportCapture[] = [];
        for (const file of list) {
          const base64 = await fileToBase64(file);
          added.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            route: route || "/",
            base64,
            createdAt: Date.now(),
          });
        }
        setCaptures((prev) => {
          const merged = [...prev, ...added];
          if (merged.length <= MAX_CAPTURES) return merged;
          toast("Capture limit reached", {
            description: `Keeping the latest ${MAX_CAPTURES} screenshots.`,
            variant: "info",
          });
          return merged.slice(-MAX_CAPTURES);
        });
        setActive(true);
      } catch (err) {
        toast("Couldn't add screenshot", {
          description: err instanceof Error ? err.message : String(err),
          variant: "error",
        });
      }
    },
    []
  );

  return (
    <BugReportContext.Provider
      value={{
        active,
        captures,
        capturing,
        hideChromeForCapture,
        description,
        contact,
        setDescription,
        setContact,
        startSession,
        endSession,
        captureScreen,
        addImageFiles,
        removeCapture,
        clearCaptures,
      }}
    >
      {children}
    </BugReportContext.Provider>
  );
}

export function useBugReport(): BugReportContextType {
  const ctx = useContext(BugReportContext);
  if (!ctx) {
    throw new Error("useBugReport must be used within a BugReportProvider");
  }
  return ctx;
}
