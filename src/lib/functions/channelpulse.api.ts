// The hosted/paid "ChannelPulse API" has been removed. The app now always uses
// the user's own configured AI/STT provider (OpenAI), so this always returns
// false. Kept as a function so existing call sites don't need to change.
export async function shouldUseChannelPulseAPI(): Promise<boolean> {
  return false;
}
