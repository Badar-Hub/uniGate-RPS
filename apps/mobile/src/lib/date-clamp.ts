/**
 * `minimumDate` only constrains the DATE dialog on Android — the time dialog accepts any hour —
 * so the combined value is clamped here: anything earlier than the minimum becomes the minimum,
 * rounded up to the next 5 minutes. The field can therefore never emit a value the API refuses.
 */
export function clampToMinimum(d: Date, minimumDate: Date | undefined): Date {
  if (!minimumDate || d.getTime() >= minimumDate.getTime()) return d;
  const m = new Date(minimumDate);
  m.setSeconds(0, 0);
  const rem = m.getMinutes() % 5;
  if (rem !== 0) m.setMinutes(m.getMinutes() + (5 - rem));
  return m;
}
