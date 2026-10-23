import {
  hapticFeedbackImpactOccurred,
  hapticFeedbackNotificationOccurred,
  isHapticFeedbackSupported,
  miniAppReady,
  requestContact,
} from '@telegram-apps/sdk';

/** Tell Telegram the app is ready to be shown. Safe no-op outside Telegram. */
export function signalReady(): void {
  try {
    if (miniAppReady.isAvailable()) miniAppReady();
  } catch {
    // not in Telegram
  }
}

export function hapticSuccess(): void {
  try {
    if (isHapticFeedbackSupported())
      hapticFeedbackNotificationOccurred('success');
  } catch {
    // haptics are best-effort
  }
}

export function hapticError(): void {
  try {
    if (isHapticFeedbackSupported())
      hapticFeedbackNotificationOccurred('error');
  } catch {
    // best-effort
  }
}

export function hapticTap(): void {
  try {
    if (isHapticFeedbackSupported()) hapticFeedbackImpactOccurred('light');
  } catch {
    // best-effort
  }
}

/** Is Telegram's native contact-share available in this client? */
export function canRequestContact(): boolean {
  try {
    return requestContact.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Ask Telegram for the user's own phone number (native consent sheet,
 * Addendum v1.1). Resolves with the number, or null when the user declined
 * or the feature is unavailable — the UI then falls back to manual entry.
 */
export async function requestPhoneFromTelegram(): Promise<string | null> {
  try {
    if (!requestContact.isAvailable()) return null;
    const result = await requestContact();
    return result.contact.phone_number ?? null;
  } catch {
    return null;
  }
}
