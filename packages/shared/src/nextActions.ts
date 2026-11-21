export interface NextAction {
  readonly label: string;
  readonly prompt: string;
  readonly reason?: string;
}

const MAX_NEXT_ACTIONS = 3;
const MAX_LABEL_LENGTH = 40;
const MAX_REASON_LENGTH = 120;
const MAX_PROMPT_LENGTH = 2000;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

function readFence(line: string) {
  const match = FENCE.exec(line);
  if (match === null) return null;
  const [, marker = "", info = ""] = match;
  return { marker, info };
}

function clip(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, max - 1).join("")}…`;
}

function readAction(value: unknown): NextAction | null {
  if (typeof value !== "object" || value === null) return null;
  const { label, prompt, reason } = value as Record<string, unknown>;
  if (typeof label !== "string" || typeof prompt !== "string") return null;
  if (label.trim() === "" || prompt.trim() === "") return null;
  if (prompt.trim().length > MAX_PROMPT_LENGTH) return null;
  const action = { label: clip(label.trim(), MAX_LABEL_LENGTH), prompt: prompt.trim() };
  return typeof reason === "string" && reason.trim() !== ""
    ? { ...action, reason: clip(reason.trim(), MAX_REASON_LENGTH) }
    : action;
}

/** Line range of a top-level ```next fence that ends the text; `end` is null while it streams. */
function trailingNextBlock(lines: ReadonlyArray<string>) {
  let open: { readonly marker: string; readonly isNext: boolean; readonly line: number } | null =
    null;
  let lastClosed: { readonly start: number; readonly end: number } | null = null;
  for (const [index, line] of lines.entries()) {
    const fence = readFence(line);
    if (open === null) {
      if (fence === null) continue;
      if (fence.marker.startsWith("`") && fence.info.includes("`")) continue;
      open = {
        marker: fence.marker,
        isNext: fence.marker === "```" && fence.info.trim() === "next",
        line: index,
      };
      continue;
    }
    if (
      fence !== null &&
      fence.marker[0] === open.marker[0] &&
      fence.marker.length >= open.marker.length &&
      fence.info.trim() === ""
    ) {
      lastClosed = open.isNext ? { start: open.line, end: index } : null;
      open = null;
    }
  }
  if (open !== null) return open.isNext ? { start: open.line, end: null } : null;
  if (lastClosed === null) return null;
  return lines.slice(lastClosed.end + 1).every((line) => line.trim() === "") ? lastClosed : null;
}

/** Splits the suggested next actions an agent writes as a trailing ```next block off its message. */
export function splitNextActions(text: string): {
  readonly markdown: string;
  readonly actions: ReadonlyArray<NextAction>;
} {
  const lines = text.split("\n");
  const block = trailingNextBlock(lines);
  if (block === null) return { markdown: text, actions: [] };
  const markdown = lines.slice(0, block.start).join("\n").trimEnd();
  // Hide the block while it streams; its actions appear once it closes.
  if (block.end === null) return { markdown, actions: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines.slice(block.start + 1, block.end).join("\n"));
  } catch {
    return { markdown: text, actions: [] };
  }
  if (!Array.isArray(parsed)) return { markdown: text, actions: [] };
  const actions: Array<NextAction> = [];
  for (const value of parsed) {
    const action = readAction(value);
    if (action === null || actions.some((existing) => existing.prompt === action.prompt)) continue;
    actions.push(action);
    if (actions.length === MAX_NEXT_ACTIONS) break;
  }
  return { markdown, actions };
}
