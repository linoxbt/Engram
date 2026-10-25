/**
 * One line of a .env file: KEY=value, KEY="value", KEY='value', with `# comments` after an unquoted value (a `#`
 * inside quotes, or not preceded by whitespace, is part of the value). Returns null for blanks and comment lines.
 */
export function parseEnvLine(line: string): [string, string] | null {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!m) return null;
  const raw = m[2].trim();
  const q = raw[0];
  if (q === '"' || q === "'") {
    const end = raw.indexOf(q, 1);
    if (end > 0) return [m[1], raw.slice(1, end)];
    return [m[1], raw.slice(1)];
  }
  return [m[1], raw.startsWith("#") ? "" : raw.replace(/\s+#.*$/, "").trim()];
}
