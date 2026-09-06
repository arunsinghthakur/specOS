/** Extracts the first top-level JSON object from an agent's text response. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Agent did not return JSON: ${text.slice(0, 200)}`);
  }
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    // Models occasionally emit a bare `undefined` for an optional field despite instructions
    // not to — drop that key/value pair entirely (equivalent to omitting the field) rather
    // than failing the whole response over one stray token.
    return JSON.parse(candidate.replace(/,\s*"[^"]+"\s*:\s*undefined/g, ""));
  }
}
