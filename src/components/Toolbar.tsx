import type { LanguageId } from '../runtime/types';
import type { Sample } from '../editor/samples';

interface Props {
  language: LanguageId;
  onLanguageChange: (l: LanguageId) => void;
  samples: Sample[];
  onSample: (index: number) => void;
  onRun: () => void;
  onStop: () => void;
  onFormat: () => void;
  running: boolean;
  canFormat: boolean;
}

const LANGUAGES: { id: LanguageId; label: string }[] = [
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
];

export function Toolbar({
  language,
  onLanguageChange,
  samples,
  onSample,
  onRun,
  onStop,
  onFormat,
  running,
  canFormat,
}: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <span className="brand">
          <span className="brand-mark">⌁</span> code-sandbox
        </span>
        <nav className="lang-tabs">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              className={language === l.id ? 'active' : ''}
              onClick={() => onLanguageChange(l.id)}
            >
              {l.label}
            </button>
          ))}
        </nav>
        <select
          key={language}
          className="sample-select"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value !== '') onSample(Number(e.target.value));
            e.target.value = '';
          }}
          aria-label="Load example"
        >
          <option value="" disabled>
            Examples…
          </option>
          {samples.map((s, i) => (
            <option key={i} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="toolbar-right">
        <button
          className="btn"
          onClick={onFormat}
          disabled={!canFormat || running}
          title={canFormat ? 'Format with Prettier' : 'Formatting is only available for JavaScript in v1'}
        >
          ✨ Format
        </button>
        {running ? (
          <button className="btn btn-danger" onClick={onStop}>
            ■ Stop
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onRun}>
            ▶ Run
          </button>
        )}
      </div>
    </header>
  );
}
