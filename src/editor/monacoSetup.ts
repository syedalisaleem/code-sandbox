/**
 * Wire the npm-bundled Monaco Editor into @monaco-editor/react.
 *
 * Monaco's language services run in their own web workers; Vite emits them
 * via `?worker` imports. This must be imported once before any <Editor />
 * mounts (see src/main.tsx).
 */
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
// NOTE: monaco-editor >= 0.5x ships an `exports` map, so worker entry points
// must use these exports-aware specifiers (not `monaco-editor/esm/vs/...`).
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

const env = self as unknown as {
  MonacoEnvironment?: { getWorker: (_: unknown, label: string) => Worker };
};

env.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

export default monaco;
