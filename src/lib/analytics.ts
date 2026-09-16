/**
 * Analytics — disabled in ChannelPulse OSS.
 *
 * The open-source app collects NOTHING and phones home to no one: there is no
 * PostHog, no Vercel Analytics, no telemetry of any kind. This module keeps the
 * original API surface (`ANALYTICS_EVENTS`, `captureEvent`, `trackAppStart`) so
 * existing call sites compile unchanged, but every function is a no-op. This is
 * a core promise of the OSS build — please keep it that way.
 */

/** Event names, kept for call-site compatibility. Nothing is ever sent. */
export const ANALYTICS_EVENTS = {
  APP_STARTED: "app_started",
  GET_LICENSE: "get_license",
} as const;

/** No-op: OSS sends no analytics events. */
export const captureEvent = async (
  _eventName: string,
  _properties?: Record<string, any>
): Promise<void> => {
  // Intentionally does nothing.
};

/** No-op: OSS does not track app starts. */
export const trackAppStart = async (
  _appVersion: string,
  _instanceId: string
): Promise<void> => {
  // Intentionally does nothing.
};
