// Hover cards ignore the pointer, so long lists are windowed rather than scrolled.
const HOVER_LIST_ROWS = 8;

/** Rows to show so the focused row (or the top, when there is none) stays in view. */
export function hoverListWindow(length: number, focus: number, rows = HOVER_LIST_ROWS) {
  const start = Math.max(0, Math.min(focus - 2, length - rows));
  return { start, end: Math.min(length, start + rows) };
}

/** The running step, else the first one not done, matching the shell's `current`. */
export function todoFocusIndex(steps: ReadonlyArray<{ readonly status: string }>) {
  const running = steps.findIndex((step) => step.status === "running");
  return running >= 0 ? running : steps.findIndex((step) => step.status !== "completed");
}
