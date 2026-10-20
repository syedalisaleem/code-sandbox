import type { LanguageId } from '../runtime/types';

export interface Sample {
  label: string;
  code: string;
}

export const SAMPLES: Record<LanguageId, Sample[]> = {
  python: [
    {
      label: 'Hello, sandbox',
      code: `def greet(name: str) -> str:
    return f"Hello, {name}!"

for target in ["Python", "WebAssembly", "sandbox"]:
    print(greet(target))
`,
    },
    {
      label: 'Fibonacci',
      code: `def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a

print([fib(i) for i in range(12)])
`,
    },
    {
      label: 'Traceback demo',
      code: `# Runtime errors are captured and shown in the console.
print("about to divide by zero...")
print(1 / 0)
print("this line never runs")
`,
    },
    {
      label: 'Infinite loop (kill switch)',
      code: `# The supervisor terminates the worker after the timeout
# and respawns a fresh runtime on the next run.
while True:
    pass
`,
    },
  ],
  javascript: [
    {
      label: 'Hello, sandbox',
      code: `const greet = (name) => \`Hello, \${name}!\`;

for (const target of ["JavaScript", "QuickJS", "sandbox"]) {
  console.log(greet(target));
}
`,
    },
    {
      label: 'Async / promises',
      code: `// No timers exist in this sandbox by design —
// but the promise job queue is drained after eval.
async function fetchNumber() {
  return 42;
}

async function main() {
  const value = await fetchNumber();
  console.log("async result:", value);
}

main();
`,
    },
    {
      label: 'Throw demo',
      code: `function explode() {
  throw new Error("boom");
}

console.log("about to throw...");
explode();
console.log("this line never runs");
`,
    },
    {
      label: 'Infinite loop (kill switch)',
      code: `// QuickJS has an interrupt handler AND a memory cap,
// but the supervisor's worker.terminate() is the hard guard.
while (true) {}
`,
    },
  ],
};

export const DEFAULT_CODE: Record<LanguageId, string> = {
  python: SAMPLES.python[0].code,
  javascript: SAMPLES.javascript[0].code,
};
