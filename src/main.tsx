// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';
import './styles/studio.css';
import './styles/workbench-2026.css';
import './styles/efficiency.css';
import './styles/pro-workbench.css';
import './styles/pro-develop.css';
import './styles/unified-theme.css';
import './styles/window-chrome.css';
import { AppearanceController } from './ui/shared/AppearanceController';
import { DesktopErrorBoundary } from './ui/shared/DesktopErrorBoundary';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DesktopErrorBoundary>
      <AppearanceController />
      <App />
    </DesktopErrorBoundary>
  </React.StrictMode>
);
