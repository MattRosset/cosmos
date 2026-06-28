import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary, ErrorCard, DevErrorOverlay } from './ErrorBoundary';
import { installGlobalErrorHandlers } from './glue/report-error';
import '@cosmos/ui/ui.css'; // design tokens + panel styles — loaded first so styles.css can layer on top
import './styles.css';

installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary context="app-root" fallback={(error) => <ErrorCard error={error} />}>
      <App />
    </ErrorBoundary>
    {import.meta.env.DEV ? <DevErrorOverlay /> : null}
  </StrictMode>,
);
