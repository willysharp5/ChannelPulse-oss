import { createContext, useContext, useEffect, useState } from "react";
import { STORAGE_KEYS } from "@/config/";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  transparency: number;
  onSetTransparency: (transparency: number) => void;
  isSystemThemeDark: boolean;
  highContrastText: boolean;
  onSetHighContrastText: (on: boolean) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  transparency: 10,
  onSetTransparency: () => null,
  isSystemThemeDark: false,
  highContrastText: false,
  onSetHighContrastText: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = STORAGE_KEYS.THEME,
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );
  const [transparency, setTransparency] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.TRANSPARENCY);
    return stored ? parseInt(stored, 10) : 10;
  });
  const [highContrastText, setHighContrastText] = useState<boolean>(
    () => localStorage.getItem(STORAGE_KEYS.HIGH_CONTRAST_TEXT) === "1"
  );

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const isSystemThemeDark = mediaQuery.matches;

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.TRANSPARENCY && e.newValue) {
        setTransparency(parseInt(e.newValue, 10));
      }
      if (e.key === storageKey && e.newValue) {
        setTheme(e.newValue as Theme);
      }
      if (e.key === STORAGE_KEYS.HIGH_CONTRAST_TEXT) {
        setHighContrastText(e.newValue === "1");
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [storageKey]);

  useEffect(() => {
    const root = window.document.documentElement;

    const applyTheme = (currentTheme: Theme) => {
      root.classList.remove("light", "dark");

      if (currentTheme === "system") {
        const systemTheme = mediaQuery.matches ? "dark" : "light";
        root.classList.add(systemTheme);
      } else {
        root.classList.add(currentTheme);
      }
    };

    const updateTheme = () => {
      if (theme === "system") {
        applyTheme("system");
      }
    };

    applyTheme(theme);

    if (theme === "system") {
      mediaQuery.addEventListener("change", updateTheme);
    }

    return () => {
      if (theme === "system") {
        mediaQuery.removeEventListener("change", updateTheme);
      }
    };
  }, [theme]);

  // Apply transparency globally. As the panel fill fades out we ALSO make the
  // text legible over whatever window shows through, using two theme-aware
  // levers that ramp up with transparency:
  //   1. Adaptive backdrop tone — a brightness/contrast filter that pushes the
  //      pixels *behind* the panel away from the text tone (darken behind white
  //      text, lighten behind dark text). The window stays visible (it's
  //      filtered, not covered), unlike an opaque fill.
  //   2. Text halo — a soft outline in the opposite tone (we reuse --background,
  //      which is always the inverse of --foreground), applied in global.css.
  useEffect(() => {
    const root = window.document.documentElement;
    const t = transparency / 100; // 0..1
    const opacity = 1 - t;

    // Apply opacity to CSS variables
    root.style.setProperty("--opacity", opacity.toString());

    // Blur eases off as transparency rises so the max setting is genuinely
    // see-through (14px at 0% → 0 at 100%), same as before.
    const blurPx = Math.round(14 * (1 - t));
    root.style.setProperty(
      "--backdrop-blur",
      blurPx > 0 ? `blur(${blurPx}px)` : "none"
    );

    // Is the app effectively in dark mode right now? Determines which way the
    // adaptive tone pushes the background luminance.
    const isDark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    // Adaptive backdrop tone. Kept mild on purpose so you can still read the
    // window behind — the halo does the rest. Dark UI darkens what's behind
    // (so white text pops); light UI brightens it. A touch of extra contrast
    // sharpens the text edge against a busy background.
    const brightness = isDark ? 1 - 0.5 * t : 1 + 0.7 * t;
    const parts: string[] = [];
    if (blurPx > 0) parts.push(`blur(${blurPx}px)`);
    if (Math.abs(brightness - 1) > 0.001)
      parts.push(`brightness(${brightness.toFixed(3)})`);
    if (t > 0) parts.push(`contrast(${(1 + 0.15 * t).toFixed(3)})`);
    root.style.setProperty(
      "--panel-backdrop",
      parts.length ? parts.join(" ") : "none"
    );

    // Text-halo strength (alpha, 0..1) consumed by the text-shadow in
    // global.css. Ramps a little faster than transparency so mid settings are
    // already protected; clamps at 1.
    root.style.setProperty(
      "--text-halo-strength",
      Math.min(1, t * 1.2).toFixed(3)
    );
  }, [transparency, theme]);

  // Toggle the caption-plate "High-contrast text" mode on <html>.
  useEffect(() => {
    window.document.documentElement.setAttribute(
      "data-text-plate",
      highContrastText ? "on" : "off"
    );
  }, [highContrastText]);

  const onSetTransparency = (transparency: number) => {
    localStorage.setItem(STORAGE_KEYS.TRANSPARENCY, transparency.toString());
    setTransparency(transparency);
  };

  const value = {
    theme,
    setTheme: (newTheme: Theme) => {
      localStorage.setItem(storageKey, newTheme);
      setTheme(newTheme);
    },
    isSystemThemeDark,
    transparency,
    onSetTransparency,
    highContrastText,
    onSetHighContrastText: (on: boolean) => {
      localStorage.setItem(STORAGE_KEYS.HIGH_CONTRAST_TEXT, on ? "1" : "0");
      setHighContrastText(on);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
