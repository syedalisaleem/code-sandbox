import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { LanguageId } from '../runtime/types';

interface Props {
  language: LanguageId;
  code: string;
  onChange: (code: string) => void;
  onRun: () => void;
}

/** Separate Monaco models per language, so switching tabs preserves code. */
const PATHS: Record<LanguageId, string> = {
  python: 'main.py',
  javascript: 'main.js',
};

export function CodeEditor({ language, code, onChange, onRun }: Props) {
  const onRunRef = useRef(onRun);
  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRunRef.current();
    });
    editor.focus();
  };

  return (
    <Editor
      height="100%"
      path={PATHS[language]}
      value={code}
      onChange={(value) => onChange(value ?? '')}
      onMount={handleMount}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: "'JetBrains Mono','Fira Code',Menlo,Consolas,monospace",
        padding: { top: 16 },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        renderLineHighlight: 'all',
        smoothScrolling: true,
      }}
    />
  );
}
