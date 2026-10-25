/**
 * HTML `pattern` attributes. Browsers compile them with the `v` (unicodeSets) flag, where an unescaped `-` inside a
 * character class is a syntax error and silently switches validation off, so hyphens are escaped.
 */
export const SUBJECT_PATTERN = "[a-z0-9_\\-]+:[a-z0-9_.\\-]+";
export const AGENT_NAME_PATTERN = "[a-zA-Z0-9 ._\\-]+";
export const SPACE_KEY_PATTERN = "[a-z0-9]{8}";

/** What a browser does with a pattern attribute: anchor it and compile it with the v flag. */
export const compilePattern = (p: string) => new RegExp(`^(?:${p})$`, "v");
