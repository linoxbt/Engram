/**
 * Display names end up in emails, logs, alerts and other people's member lists, so they are one plain line:
 * control, bidi-override and zero-width characters go, whitespace runs become one space, at most `max` characters.
 */
export const NAME_MAX = 80;

export function cleanDisplayName(raw: string, max = NAME_MAX): string {
  return raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}
