import { useEffect, useRef } from 'react';
import {
  mountMainButton,
  offMainButtonClick,
  onMainButtonClick,
  setMainButtonParams,
  unmountMainButton,
} from '@telegram-apps/sdk';

export interface MainButtonOptions {
  text: string;
  enabled: boolean;
  /** Show Telegram's loading spinner on the button and block clicks. */
  loading?: boolean;
  onClick: () => void;
}

/**
 * Drive Telegram's MainButton from a component (used by the Add Expense
 * flow). Pass `null` to hide it. Outside Telegram (browser/mock) the hook
 * is a no-op — callers must render an in-app fallback button, detectable
 * via `isMainButtonAvailable()`.
 */
export function useMainButton(options: MainButtonOptions | null): void {
  const clickRef = useRef<() => void>(() => {});
  clickRef.current = options?.onClick ?? (() => {});

  // Mount once for the lifetime of the owning component.
  useEffect(() => {
    let mounted = false;
    try {
      if (mountMainButton.isAvailable()) {
        mountMainButton();
        mounted = true;
      }
    } catch {
      mounted = false;
    }
    if (!mounted) return;
    const handler = () => clickRef.current();
    let off: (() => void) | undefined;
    try {
      if (onMainButtonClick.isAvailable()) {
        off = onMainButtonClick(handler);
      }
    } catch {
      // ignore
    }
    return () => {
      try {
        off?.();
        offMainButtonClick(handler);
      } catch {
        // ignore
      }
      try {
        unmountMainButton();
      } catch {
        // ignore
      }
    };
  }, []);

  // Reflect the latest options.
  useEffect(() => {
    try {
      if (!setMainButtonParams.isAvailable()) return;
      if (!options) {
        setMainButtonParams({ isVisible: false });
        return;
      }
      setMainButtonParams({
        isVisible: true,
        text: options.text,
        isEnabled: options.enabled && !options.loading,
        isLoaderVisible: !!options.loading,
      });
    } catch {
      // MainButton unavailable — the in-app fallback button is used.
    }
  }, [options?.text, options?.enabled, options?.loading, options === null]);
}

export function isMainButtonAvailable(): boolean {
  try {
    return mountMainButton.isAvailable();
  } catch {
    return false;
  }
}
