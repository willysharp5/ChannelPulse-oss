import { STORAGE_KEYS } from "@/config";
import { setSyncedItem } from "@/lib/sync/kv";
import {
  DEFAULT_RESPONSE_LENGTH,
  DEFAULT_LANGUAGE,
  DEFAULT_AUTO_SCROLL,
  DEFAULT_SHOW_TRANSCRIPT,
} from "../response-settings.constants";

export interface ResponseSettings {
  responseLength: string;
  language: string;
  autoScroll: boolean;
  showTranscript: boolean;
}

export const DEFAULT_RESPONSE_SETTINGS: ResponseSettings = {
  responseLength: DEFAULT_RESPONSE_LENGTH,
  language: DEFAULT_LANGUAGE,
  autoScroll: DEFAULT_AUTO_SCROLL,
  showTranscript: DEFAULT_SHOW_TRANSCRIPT,
};

/**
 * Get response settings from localStorage
 */
export const getResponseSettings = (): ResponseSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.RESPONSE_SETTINGS);
    if (!stored) {
      return DEFAULT_RESPONSE_SETTINGS;
    }

    const parsedSettings = JSON.parse(stored);

    return {
      responseLength:
        parsedSettings.responseLength ||
        DEFAULT_RESPONSE_SETTINGS.responseLength,
      language: parsedSettings.language || DEFAULT_RESPONSE_SETTINGS.language,
      autoScroll:
        parsedSettings.autoScroll !== undefined
          ? parsedSettings.autoScroll
          : DEFAULT_RESPONSE_SETTINGS.autoScroll,
      showTranscript:
        parsedSettings.showTranscript !== undefined
          ? parsedSettings.showTranscript
          : DEFAULT_RESPONSE_SETTINGS.showTranscript,
    };
  } catch (error) {
    console.error("Failed to get response settings:", error);
    return DEFAULT_RESPONSE_SETTINGS;
  }
};

/**
 * Save response settings to localStorage
 */
export const setResponseSettings = (settings: ResponseSettings): void => {
  try {
    // Synced across devices (see src/lib/sync/kv.ts).
    setSyncedItem(STORAGE_KEYS.RESPONSE_SETTINGS, JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to save response settings:", error);
  }
};

/**
 * Update response length
 */
export const updateResponseLength = (
  responseLength: string
): ResponseSettings => {
  const currentSettings = getResponseSettings();
  const newSettings = { ...currentSettings, responseLength };
  setResponseSettings(newSettings);
  return newSettings;
};

/**
 * Update language
 */
export const updateLanguage = (language: string): ResponseSettings => {
  const currentSettings = getResponseSettings();
  const newSettings = { ...currentSettings, language };
  setResponseSettings(newSettings);
  return newSettings;
};

/**
 * Update auto-scroll
 */
export const updateAutoScroll = (autoScroll: boolean): ResponseSettings => {
  const currentSettings = getResponseSettings();
  const newSettings = { ...currentSettings, autoScroll };
  setResponseSettings(newSettings);
  return newSettings;
};

/**
 * Update whether the transcript's "Heard" speech lines are shown.
 */
export const updateShowTranscript = (
  showTranscript: boolean
): ResponseSettings => {
  const currentSettings = getResponseSettings();
  const newSettings = { ...currentSettings, showTranscript };
  setResponseSettings(newSettings);
  return newSettings;
};
