import { useEffect, useRef } from 'react';
import type { OutputEvent, RunResult } from '../runtime/types';

interface Props {
  events: OutputEvent[];
  lastResult: RunResult | null;
  running: boolean;
  onClear: () => void;
}

const STREAM_LABEL: Record<OutputEvent['stream'], string> = {
  stdout: 'out',
  stderr: 'err',
  system: 'sys',
};

export function ConsolePanel({ events, lastResult, running, onClear }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  return (
    <div className="console">
      <div className="console-body" ref={bodyRef}>
        {events.length === 0 && !running && (
          <div className="console-empty">
            Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> or hit Run to execute.
          </div>
        )}
        {events.map((e, i) => (
          <div key={i} className={`console-line stream-${e.stream}`}>
            <span className="console-tag">{STREAM_LABEL[e.stream]}</span>
            <pre>{e.text}</pre>
          </div>
        ))}
        {running && <div className="console-running">● running…</div>}
      </div>
      <div className="console-footer">
        <span className="console-summary">
          {lastResult
            ? lastResult.status === 'ok'
              ? `✓ finished in ${Math.round(lastResult.durationMs)}ms`
              : `✗ ${lastResult.status}${lastResult.error ? ` — ${lastResult.error}` : ''}`
            : running
              ? 'executing…'
              : 'idle'}
        </span>
        <button className="btn btn-ghost" onClick={onClear} disabled={events.length === 0}>
          Clear
        </button>
      </div>
    </div>
  );
}
