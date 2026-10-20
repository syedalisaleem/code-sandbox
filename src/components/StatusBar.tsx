import type { LanguageId, RunResult, RuntimeStatus } from '../runtime/types';
import { DEFAULT_TIMEOUT_MS, PYODIDE_VERSION, QUICKJS_VERSION } from '../runtime/versions';

interface Props {
  language: LanguageId;
  status: RuntimeStatus;
  lastResult: RunResult | null;
}

const RUNTIME_LABEL: Record<LanguageId, string> = {
  python: `pyodide ${PYODIDE_VERSION} · CPython → WASM`,
  javascript: `quickjs ${QUICKJS_VERSION} · JS → WASM`,
};

export function StatusBar({ language, status, lastResult }: Props) {
  return (
    <footer className="statusbar">
      <span className={`status-dot status-${status}`} />
      <span>
        {RUNTIME_LABEL[language]} · {status}
      </span>
      <span className="statusbar-right">
        {lastResult
          ? `last run: ${lastResult.status} · ${Math.round(lastResult.durationMs)}ms`
          : `timeout limit: ${DEFAULT_TIMEOUT_MS / 1000}s`}
      </span>
    </footer>
  );
}
