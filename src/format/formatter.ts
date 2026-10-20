/**
 * In-browser code formatting via Prettier's standalone build.
 *
 * Currently scoped to JavaScript: Prettier runs entirely client-side with no
 * backend involved. Python formatting (Black) would need a second Pyodide
 * payload, so it is intentionally out of scope for v1 — see docs/ARCHITECTURE.md.
 */
export async function formatCode(code: string): Promise<string> {
  const [{ format }, babel] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
  ]);
  return format(code, { parser: 'babel', plugins: [babel] });
}
