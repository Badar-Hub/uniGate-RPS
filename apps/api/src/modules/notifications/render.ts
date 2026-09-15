/**
 * Template interpolation: `{{name}}` → value. Values are inserted verbatim as text (SMS, in-app,
 * plain-text email) — there is no expression language, no nesting and no HTML, so a variable
 * can never inject markup or another placeholder. Unknown placeholders are left in place and
 * reported so a broken template is caught by the preview endpoint, not by 4,000 recipients.
 */
const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9]{0,47})\s*\}\}/g;

export function render(template: string, variables: Record<string, string>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = template.replace(PLACEHOLDER, (whole, name: string) => {
    const v = variables[name];
    if (v === undefined) {
      missing.add(name);
      return whole;
    }
    return v;
  });
  return { text, missing: [...missing] };
}

export function placeholdersIn(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER)) if (m[1]) out.add(m[1]);
  return [...out];
}
