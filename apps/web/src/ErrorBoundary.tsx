import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { reportError, subscribeErrors, type ReportedError } from './glue/report-error';

interface ErrorBoundaryProps {
  /** Label for the sink (e.g. 'app-root', 'scene'). */
  readonly context: string;
  /** Rendered in place of the children once an error is caught. */
  readonly fallback: (error: Error, reset: () => void) => ReactNode;
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * Generic React error boundary (error-handling-audit.md §3.2 — there were ZERO before this,
 * so any throw in the tree was a blank white screen). Catches render/lifecycle throws in its
 * subtree, funnels them to the central sink, and shows a recoverable fallback. NOTE: errors
 * thrown inside `useFrame`/rAF callbacks are NOT caught by React boundaries — those are the
 * streaming `error`-phase / frame-loop-guard territory deferred to the rest of the track.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, this.props.context);
    if (info.componentStack) console.error('[cosmos] component stack:', info.componentStack);
  }

  private reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    if (this.state.error !== null) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}

/** Full-screen recoverable card — replaces the white screen for a top-level crash. */
export function ErrorCard({ error }: { readonly error: Error }): ReactNode {
  return (
    <div className="error-overlay" role="alert">
      <div className="error-box">
        <p className="error-title">Something went wrong</p>
        <p className="error-detail">{error.message || 'Unexpected error'}</p>
        {import.meta.env.DEV && error.stack ? <pre className="error-stack">{error.stack}</pre> : null}
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    </div>
  );
}

/** Card shown when the browser has no WebGL2 (the renderer can't start). */
export function WebGLUnsupportedCard(): ReactNode {
  return (
    <div className="error-overlay" role="alert">
      <div className="error-box">
        <p className="error-title">WebGL2 is required</p>
        <p className="error-detail">
          This browser or device doesn’t support WebGL2, which cosmos needs to render. Try a
          recent Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is enabled.
        </p>
      </div>
    </div>
  );
}

/**
 * Dev-only floating list of recent reported errors (so a swallowed/handled error is still
 * impossible to miss while developing). Mounted only under `import.meta.env.DEV`.
 */
export function DevErrorOverlay(): ReactNode {
  const [errors, setErrors] = useState<readonly ReportedError[]>([]);
  const [dismissedUpTo, setDismissedUpTo] = useState(0);
  useEffect(() => subscribeErrors(setErrors), []);

  const shown = errors.filter((e) => e.id > dismissedUpTo);
  if (shown.length === 0) return null;
  const lastId = errors[errors.length - 1]?.id ?? 0;

  return (
    <div className="dev-error-overlay">
      <div className="dev-error-head">
        <span>⚠ {shown.length} error{shown.length > 1 ? 's' : ''}</span>
        <button onClick={() => setDismissedUpTo(lastId)}>dismiss</button>
      </div>
      {shown.slice(-4).map((e) => (
        <div key={e.id} className="dev-error-row">
          <span className="dev-error-ctx">{e.context}</span> {e.message}
        </div>
      ))}
    </div>
  );
}
