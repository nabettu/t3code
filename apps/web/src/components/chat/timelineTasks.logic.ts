/**
 * The claude-timeline mod's task tree, read from its newest tool result (the whole tree as text),
 * since loaded turn items may not reach back to the first call. Measuring follows the mod's
 * `hooks/tree.ts`: siblings split their parent's share by weight; open work stays below 100%.
 */

const TIMELINE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "mcp__timeline__timeline_tasks",
  "mcp__timeline__timeline_read",
]);

export type TimelineTaskStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface TimelineTask {
  readonly id: string;
  readonly parent: string | null;
  readonly title: string;
  readonly status: TimelineTaskStatus;
  readonly weight: number;
  readonly done?: readonly [number, number];
  readonly note?: string;
}

export type TimelineShares = Record<TimelineTaskStatus, number>;

export interface TimelineRow {
  readonly task: TimelineTask;
  readonly depth: number;
  /** The status the row shows: its own without subtasks, else the one its subtasks make. */
  readonly status: TimelineTaskStatus;
  /** Completed share of this task, 0 to 1. */
  readonly completed: number;
  readonly leaf: boolean;
}

export interface TimelineSummary {
  readonly status: TimelineTaskStatus;
  readonly shares: TimelineShares;
  readonly leaves: { readonly completed: number; readonly total: number };
  /** The first task in progress without subtasks: the step being worked on. */
  readonly current: {
    readonly id: string;
    readonly title: string;
    readonly done?: readonly [number, number];
  } | null;
  readonly blocked: ReadonlyArray<TimelineTask>;
  readonly rows: ReadonlyArray<TimelineRow>;
}

const MARKS: Record<string, TimelineTaskStatus> = {
  " ": "pending",
  ">": "in_progress",
  x: "completed",
  "!": "blocked",
};

const STATUSES: readonly TimelineTaskStatus[] = ["pending", "in_progress", "completed", "blocked"];

// `- [x] id: title (w=3, 1/2 done) — note`, indented two spaces per level.
const LINE =
  /^( *)- \[([ >x!])\] (.+?): (.*) \(w=(\d+(?:\.\d+)?)(?:, (\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) done)?\)(?: — (.*))?$/;

export function parseTimelineTree(text: string): TimelineTask[] {
  const tasks: TimelineTask[] = [];
  const stack: { depth: number; id: string }[] = [];
  for (const line of text.split("\n")) {
    const match = LINE.exec(line);
    if (match === null) continue;
    const [, indent = "", mark = " ", id = "", title = "", weight, completed, total, note] = match;
    const depth = Math.floor(indent.length / 2);
    while (stack.length > 0 && (stack.at(-1)?.depth ?? 0) >= depth) stack.pop();
    const status = MARKS[mark] ?? "pending";
    tasks.push({
      id,
      parent: stack.at(-1)?.id ?? null,
      title,
      status,
      weight: Number(weight),
      ...(completed === undefined || total === undefined
        ? {}
        : { done: [Number(completed), Number(total)] as const }),
      ...(note === undefined ? {} : { note }),
    });
    stack.push({ depth, id });
  }
  return tasks;
}

// Below 1 so that 100% only ever means finished, as in the mod.
const CAP = 0.9999;
const LEFT = 0.0001;

interface Measure {
  readonly status: TimelineTaskStatus;
  readonly parts: TimelineShares;
}

function emptyShares(): TimelineShares {
  return { pending: 0, in_progress: 0, completed: 0, blocked: 0 };
}

function groupStatus(states: readonly TimelineTaskStatus[]): TimelineTaskStatus {
  if (states.every((state) => state === "completed")) return "completed";
  if (states.includes("in_progress")) return "in_progress";
  if (states.includes("blocked")) return "blocked";
  return states.includes("completed") ? "in_progress" : "pending";
}

function capped(parts: TimelineShares, status: TimelineTaskStatus): TimelineShares {
  if (status === "completed" || parts.completed <= CAP) return parts;
  const rest = parts.pending + parts.in_progress + parts.blocked;
  const out = { ...emptyShares(), completed: CAP };
  if (rest === 0) out[status] = LEFT;
  else
    for (const state of ["pending", "in_progress", "blocked"] as const)
      out[state] = (parts[state] / rest) * LEFT;
  return out;
}

function leafMeasure(task: TimelineTask): Measure {
  const parts = emptyShares();
  if (task.status === "completed") parts.completed = 1;
  else {
    parts.completed = task.done === undefined ? 0 : task.done[0] / task.done[1];
    parts[task.status] = 1 - parts.completed;
  }
  return { status: task.status, parts: capped(parts, task.status) };
}

function measureAll(tasks: readonly TimelineTask[]): Map<string | null, Measure> {
  const result = new Map<string | null, Measure>();
  const visit = (id: string | null): Measure | undefined => {
    const kids = tasks.filter((task) => task.parent === id);
    if (kids.length === 0) return undefined;
    const values = kids.map((kid) => {
      const value = visit(kid.id) ?? leafMeasure(kid);
      result.set(kid.id, value);
      return { kid, value };
    });
    const status = groupStatus(values.map(({ value }) => value.status));
    const total = kids.reduce((sum, kid) => sum + Math.max(kid.weight, 0), 0);
    const parts = emptyShares();
    if (total > 0) {
      for (const { kid, value } of values) {
        for (const state of STATUSES)
          parts[state] += (value.parts[state] * Math.max(kid.weight, 0)) / total;
      }
    }
    const measure = { status, parts: capped(parts, status) };
    result.set(id, measure);
    return measure;
  };
  visit(null);
  return result;
}

export function summarizeTimeline(tasks: readonly TimelineTask[]): TimelineSummary {
  const measures = measureAll(tasks);
  const parents = new Set(tasks.map((task) => task.parent));
  const rows: TimelineRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const task of tasks) {
      if (task.parent !== parent) continue;
      const measure = measures.get(task.id);
      rows.push({
        task,
        depth,
        status: measure?.status ?? task.status,
        completed: measure?.parts.completed ?? 0,
        leaf: !parents.has(task.id),
      });
      walk(task.id, depth + 1);
    }
  };
  walk(null, 0);
  const leaves = rows.filter((row) => row.leaf);
  const current = leaves.find((row) => row.status === "in_progress")?.task;
  const root = measures.get(null);
  return {
    status: root?.status ?? "pending",
    shares: root?.parts ?? emptyShares(),
    leaves: {
      completed: leaves.filter((row) => row.status === "completed").length,
      total: leaves.length,
    },
    current:
      current === undefined
        ? null
        : {
            id: current.id,
            title: current.title,
            ...(current.done === undefined ? {} : { done: current.done }),
          },
    blocked: leaves.filter((row) => row.status === "blocked").map((row) => row.task),
    rows,
  };
}

function textOfBlocks(blocks: readonly unknown[]): string | null {
  const texts = blocks.flatMap((block) =>
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "text" &&
    typeof (block as { text?: unknown }).text === "string"
      ? [(block as { text: string }).text]
      : [],
  );
  return texts.length === 0 ? null : texts.join("");
}

/** The text of an MCP tool result, in the shapes the Claude adapter stores. */
export function timelineToolOutputText(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return textOfBlocks(output);
  if (typeof output !== "object" || output === null) return null;
  const content = (output as { content?: unknown }).content;
  if (typeof content === "string") return content;
  return Array.isArray(content) ? textOfBlocks(content) : null;
}

/** The tree from the newest finished timeline call that answered with one. */
export function latestTimelineSummary(
  items: ReadonlyArray<{
    readonly type: string;
    readonly toolName?: string | null;
    readonly status?: string;
    readonly output?: unknown;
  }>,
): TimelineSummary | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type !== "dynamic_tool" || item.status !== "completed") continue;
    if (!TIMELINE_TOOL_NAMES.has(item.toolName ?? "")) continue;
    const text = timelineToolOutputText(item.output);
    if (text === null) continue;
    const tasks = parseTimelineTree(text);
    if (tasks.length > 0) return summarizeTimeline(tasks);
  }
  return null;
}
