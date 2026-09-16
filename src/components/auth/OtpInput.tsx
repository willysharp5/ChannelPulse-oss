import { useEffect, useRef, useState } from "react";

interface OtpInputProps {
  length: number;
  onChange?: (code: string) => void;
  /** Fires once every cell is filled (typed or pasted). */
  onComplete?: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * Segmented one-time-code input: one box per digit, arrow/backspace navigation,
 * and paste support that spreads the pasted code across all boxes and triggers
 * `onComplete` (so a paste can auto-submit).
 */
export const OtpInput = ({
  length,
  onChange,
  onComplete,
  disabled,
  autoFocus,
}: OtpInputProps) => {
  const [chars, setChars] = useState<string[]>(() => Array(length).fill(""));
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const emit = (next: string[]) => {
    setChars(next);
    const joined = next.join("");
    onChange?.(joined);
    if (joined.length === length && next.every((c) => c !== "")) {
      onComplete?.(joined);
    }
  };

  const handleChange = (i: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    if (!digit) return;
    const next = [...chars];
    next[i] = digit;
    emit(next);
    if (i < length - 1) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (
    i: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...chars];
      if (next[i]) {
        next[i] = "";
        emit(next);
      } else if (i > 0) {
        next[i - 1] = "";
        emit(next);
        refs.current[i - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < length - 1) {
      refs.current[i + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, length);
    if (!pasted) return;
    const next = Array(length).fill("");
    for (let k = 0; k < pasted.length; k++) next[k] = pasted[k];
    emit(next);
    const focusIdx = Math.min(pasted.length, length - 1);
    refs.current[focusIdx]?.focus();
  };

  return (
    <div className="flex justify-center gap-1.5" onPaste={handlePaste}>
      {chars.map((c, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={c}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="size-10 rounded-md border border-border/60 bg-muted/20 text-center text-lg font-semibold outline-none transition-colors focus:border-primary disabled:opacity-50"
        />
      ))}
    </div>
  );
};
