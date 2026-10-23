import React from 'react';
import ReactDOM from 'react-dom/client';
import { init, mountThemeParams } from '@telegram-apps/sdk';
import '@telegram-apps/telegram-ui/dist/styles.css';
import './index.css';
import App from './App';

// Initialize the Telegram Mini App SDK when running inside Telegram.
// Outside Telegram (plain browser during development) it throws — ignore;
// the app then shows its dev-mode notice (or the labelled ?mock=1 demo).
try {
  init();
  if (mountThemeParams.isAvailable()) {
    void mountThemeParams();
  }
} catch {
  // Not running inside Telegram.
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
