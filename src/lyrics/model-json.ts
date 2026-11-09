/**
 * Reads the JSON a model was asked to return. Models often wrap it in a code
 * fence or add a sentence before or after it, and put real line breaks inside
 * long string values; all of those still carry a usable answer.
 */
export function parseModelJson(text: string): unknown {
  const body = text
    .replace(/^\s*```(?:json)?\s*/u, "")
    .replace(/\s*```\s*$/u, "");
  try {
    return JSON.parse(body);
  } catch {
    // Fall through to the lenient reading below.
  }
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return JSON.parse(body);
  const slice = body.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return JSON.parse(escapeControlCharsInStrings(slice));
  }
}

function escapeControlCharsInStrings(json: string) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      escaped = false;
      out += ch;
    } else if (ch === "\\") {
      escaped = true;
      out += ch;
    } else if (ch === '"') {
      inString = false;
      out += ch;
    } else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch < " ")
      out += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
    else out += ch;
  }
  return out;
}
