export interface NextAction {
  readonly label: string;
  readonly prompt: string;
  readonly reason?: string;
}

const MAX_NEXT_ACTIONS = 3;
const OPENING_FENCE = /(?:^|\n)[ \t]*```next[ \t]*\n/gu;
const CLOSING_FENCE = /\n[ \t]*```[ \t]*(?:\n|$)/u;

function readAction(value: unknown): NextAction | null {
  if (typeof value !== "object" || value === null) return null;
  const { label, prompt, reason } = value as Record<string, unknown>;
  if (typeof label !== "string" || typeof prompt !== "string") return null;
  if (label.trim() === "" || prompt.trim() === "") return null;
  return typeof reason === "string" && reason.trim() !== ""
    ? { label: label.trim(), prompt: prompt.trim(), reason: reason.trim() }
    : { label: label.trim(), prompt: prompt.trim() };
}

/** Splits the suggested next actions an agent writes as a trailing ```next block off its message. */
export function splitNextActions(text: string): {
  readonly markdown: string;
  readonly actions: ReadonlyArray<NextAction>;
} {
  const opening = [...text.matchAll(OPENING_FENCE)].at(-1);
  if (opening === undefined) return { markdown: text, actions: [] };
  const body = `\n${text.slice(opening.index + opening[0].length)}`;
  const markdown = text.slice(0, opening.index).trimEnd();
  const closing = CLOSING_FENCE.exec(body);
  // The closing fence is missing while the block streams; hide it until it is complete.
  if (closing === null) return { markdown, actions: [] };
  if (body.slice(closing.index + closing[0].length).trim() !== "") {
    return { markdown: text, actions: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(0, closing.index));
  } catch {
    return { markdown: text, actions: [] };
  }
  if (!Array.isArray(parsed)) return { markdown: text, actions: [] };
  const actions = parsed.flatMap((value) => readAction(value) ?? []).slice(0, MAX_NEXT_ACTIONS);
  return { markdown, actions };
}
