export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Tagged template that escapes every interpolated value. Use `raw()` to opt out. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    out += value instanceof RawHtml ? value.value : escapeHtml(value);
    out += strings[i + 1];
  }
  return out;
}

class RawHtml {
  constructor(readonly value: string) {}
}

export function raw(value: string): RawHtml {
  return new RawHtml(value);
}

export function joinHtml(parts: string[]): RawHtml {
  return new RawHtml(parts.join(""));
}
