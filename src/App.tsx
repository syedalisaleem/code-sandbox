import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { CodeEditor } from './editor/CodeEditor';
import { DEFAULT_CODE, SAMPLES } from './editor/samples';
import { ConsolePanel } from './console/ConsolePanel';
import { Toolbar } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { createSupervisor, type RuntimeSupervisor } from './runtime/supervisor';
import { DEFAULT_TIMEOUT_MS, MAX_OUTPUT_CHARS } from './runtime/versions';
import type { LanguageId, OutputEvent, RunResult, RuntimeStatus } from './runtime/types';
import { formatCode } from './format/formatter';

type SideTab = 'console' | 'sandbox';

/** Drop oldest output once the buffer exceeds the cap. */
function truncate(events: OutputEvent[]): OutputEvent[] {
  let total = 0;
  for (const e of events) total += e.text.length;
  let i = 0;
  while (total > MAX_OUTPUT_CHARS && i < events.length) {
    total -= events[i].text.length;
    i += 1;
  }
  if (i === 0) return events;
  return [{ stream: 'system', text: '… earlier output truncated …\n' }, ...events.slice(i)];
}

export function App() {
  const [language, setLanguage] = useState<LanguageId>('python');
  const [codeMap, setCodeMap] = useState<Record<LanguageId, string>>({ ...DEFAULT_CODE });
  const [events, setEvents] = useState<OutputEvent[]>([]);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [statuses, setStatuses] = useState<Record<LanguageId, RuntimeStatus>>({
    python: 'idle',
    javascript: 'idle',
  });
  const [sideTab, setSideTab] = useState<SideTab>('console');
  const [split, setSplit] = useState(55);

  const supervisors = useRef(new Map<LanguageId, RuntimeSupervisor>());
  const dragState = useRef<{ startX: number; startSplit: number } | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const pushEvent = useCallback((e: OutputEvent) => {
    setEvents((prev) => truncate([...prev, e]));
  }, []);

  const getSupervisor = useCallback(
    (lang: LanguageId): RuntimeSupervisor => {
      const existing = supervisors.current.get(lang);
      if (existing) return existing;
      const sup = createSupervisor(lang, {
        onOutput: (e) => pushEvent(e),
        onStatus: (s) => setStatuses((prev) => ({ ...prev, [lang]: s })),
      });
      supervisors.current.set(lang, sup);
      return sup;
    },
    [pushEvent],
  );

  useEffect(() => {
    const map = supervisors.current;
    return () => {
      map.forEach((s) => s.dispose());
      map.clear();
    };
  }, []);

  const run = useCallback(async () => {
    const sup = getSupervisor(language);
    setSideTab('console');
    setEvents([]);
    setLastResult(null);
    pushEvent({
      stream: 'system',
      text: `$ run ${language} · timeout ${DEFAULT_TIMEOUT_MS / 1000}s\n`,
    });
    const result = await sup.run(codeMap[language]);
    setLastResult(result);
    if (result.status === 'ok') {
      pushEvent({ stream: 'system', text: `\n✓ done in ${Math.round(result.durationMs)}ms\n` });
    }
  }, [getSupervisor, language, codeMap, pushEvent]);

  const stop = useCallback(() => {
    supervisors.current.get(language)?.stop();
  }, [language]);

  const format = useCallback(async () => {
    if (language !== 'javascript') return;
    try {
      const formatted = await formatCode(codeMap.javascript);
      setCodeMap((m) => ({ ...m, javascript: formatted }));
      pushEvent({ stream: 'system', text: '✨ formatted with prettier\n' });
    } catch {
      pushEvent({ stream: 'system', text: 'formatting failed — is the code valid JS?\n' });
    }
  }, [language, codeMap, pushEvent]);

  const applySample = useCallback(
    (index: number) => {
      const sample = SAMPLES[language][index];
      if (sample) setCodeMap((m) => ({ ...m, [language]: sample.code }));
    },
    [language],
  );

  /* Draggable divider between editor and side panel */
  const onDividerDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    dragState.current = { startX: e.clientX, startSplit: split };
    e.preventDefault();
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragState.current;
      const el = mainRef.current;
      if (!d || !el) return;
      const width = el.getBoundingClientRect().width;
      const pct = ((d.startSplit / 100) * width + (e.clientX - d.startX)) / width;
      setSplit(Math.min(80, Math.max(20, pct * 100)));
    };
    const onUp = () => {
      dragState.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const status = statuses[language];
  const running = status === 'running';

  return (
    <div className="app">
      <Toolbar
        language={language}
        onLanguageChange={setLanguage}
        samples={SAMPLES[language]}
        onSample={applySample}
        onRun={run}
        onStop={stop}
        onFormat={format}
        running={running}
        canFormat={language === 'javascript'}
      />
      <div className="main" ref={mainRef}>
        <div className="editor-pane" style={{ flexBasis: `${split}%` }}>
          <CodeEditor
            language={language}
            code={codeMap[language]}
            onChange={(c) => setCodeMap((m) => ({ ...m, [language]: c }))}
            onRun={run}
          />
        </div>
        <div className="divider" onMouseDown={onDividerDown} role="separator" aria-label="Resize panels" />
        <div className="side-pane">
          <div className="side-tabs">
            <button className={sideTab === 'console' ? 'active' : ''} onClick={() => setSideTab('console')}>
              Console
            </button>
            <button className={sideTab === 'sandbox' ? 'active' : ''} onClick={() => setSideTab('sandbox')}>
              Sandbox
            </button>
          </div>
          {sideTab === 'console' ? (
            <ConsolePanel
              events={events}
              lastResult={lastResult}
              running={running}
              onClear={() => setEvents([])}
            />
          ) : (
            <div className="sandbox-tab">
              <h3>How your code is contained</h3>
              <ul>
                <li>
                  <strong>Web Worker isolation</strong> — every run executes in a dedicated worker
                  with no DOM access.
                </li>
                <li>
                  <strong>WASM runtimes</strong> — Python runs on Pyodide (CPython → WebAssembly);
                  JavaScript runs on QuickJS (→ WebAssembly), <em>not</em> your browser's engine.
                </li>
                <li>
                  <strong>Zero network capability</strong> — workers are never given fetch, XHR, or
                  sockets; the only host I/O is a bridged <code>console</code>.
                </li>
                <li>
                  <strong>Timeout kill switch</strong> — infinite loops are stopped with{' '}
                  <code>worker.terminate()</code>; a fresh runtime respawns on the next run.
                </li>
                <li>
                  <strong>Memory cap</strong> — QuickJS is limited to 64&nbsp;MB with an interrupt
                  handler as a second-layer guard.
                </li>
              </ul>
              <p className="sandbox-note">
                Full threat model and the phase‑2 Docker backend design live in{' '}
                <code>docs/SECURITY.md</code>.
              </p>
            </div>
          )}
        </div>
      </div>
      <StatusBar language={language} status={status} lastResult={lastResult} />
    </div>
  );
}
