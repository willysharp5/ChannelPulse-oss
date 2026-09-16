import { useCallback, useRef, useState } from "react";

type UseCopyToClipboardProps = {
  text: string;
  copyMessage?: string;
};

export function useCopyToClipboard({ text }: UseCopyToClipboardProps) {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const markCopied = useCallback(() => {
    setIsCopied(true);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    timeoutRef.current = setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  }, []);

  // Legacy fallback for the borderless / non-focusing overlay window where the
  // async Clipboard API is often blocked (NotAllowedError).
  const legacyCopy = useCallback((value: string): boolean => {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }, []);

  const handleCopy = useCallback(async () => {
    if (!text) return;
    // Try the modern Clipboard API first.
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        markCopied();
        return;
      }
    } catch {
      // fall through to the legacy path
    }
    if (legacyCopy(text)) {
      markCopied();
    } else {
      console.error("Failed to copy to clipboard.");
    }
  }, [text, markCopied, legacyCopy]);

  return { isCopied, handleCopy };
}
