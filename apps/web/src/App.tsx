import {
  DEBUG_MARKERS, DEBUG_JITTER, DEBUG_CTXSWITCH, DEBUG_M3, DEBUG_FLYTHROUGH3,
  DEBUG_FLYTHROUGH4, FLYTHROUGH4_BASELINE, DEBUG_SOAK3, DEBUG_SOAK4,
  DEBUG_M4A, DEBUG_ERRORGATE, ERRORGATE_INJECT,
} from './app/flags';
import { JitterApp } from './app/JitterApp';
import { CtxSwitchApp } from './app/CtxSwitchApp';
import { ErrorGateApp } from './app/ErrorGateApp';
import { M4aApp } from './app/M4aApp';
import { Flythrough4ProbeApp } from './app/Flythrough4ProbeApp';
import { Soak4ProbeApp } from './app/Soak4ProbeApp';
import { M3App } from './app/M3App';
import { StreamingProbeApp } from './app/StreamingProbeApp';
import { DebugApp } from './app/DebugApp';
import { StarApp } from './app/StarApp';
import './glue/frame-profiler';

export function App() {
  if (DEBUG_JITTER) return <JitterApp />;
  if (DEBUG_CTXSWITCH) return <CtxSwitchApp />;
  if (DEBUG_ERRORGATE) return <ErrorGateApp inject={ERRORGATE_INJECT} />;
  if (DEBUG_M4A) return <M4aApp />;
  if (DEBUG_FLYTHROUGH4) return <Flythrough4ProbeApp baseline={FLYTHROUGH4_BASELINE} />;
  if (DEBUG_SOAK4) return <Soak4ProbeApp />;
  if (DEBUG_M3) return <M3App />;
  if (DEBUG_FLYTHROUGH3 || DEBUG_SOAK3) return <StreamingProbeApp kind={DEBUG_SOAK3 ? 'soak3' : 'flythrough3'} />;
  return DEBUG_MARKERS ? <DebugApp /> : <StarApp />;
}
