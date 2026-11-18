/**
 * The claude-timeline mod's task tree, rebuilt from its `timeline_tasks` inputs: the wire drops tool
 * results. Applying and measuring follow the mod's `hooks/tree.ts`: siblings split their parent's
 * share by weight, and open work stays below 100%.
 */

const TIMELINE_TASKS_TOOL = "mcp__timeline__timeline_tasks";

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

const STATUSES: readonly TimelineTaskStatus[] = ["pending", "in_progress", "completed", "blocked"];

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
  const children = new Map<string | null, TimelineTask[]>();
  for (const task of tasks) {
    const siblings = children.get(task.parent);
    if (siblings === undefined) children.set(task.parent, [task]);
    else siblings.push(task);
  }
  const visit = (id: string | null): Measure | undefined => {
    const kids = children.get(id) ?? [];
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

interface TimelineOp {
  readonly op: "add" | "update" | "remove";
  readonly id: string;
  readonly parent?: string;
  readonly title?: string;
  readonly status?: TimelineTaskStatus;
  readonly weight?: number;
  readonly note?: string;
  readonly done?: readonly [number, number];
}

function isStatus(value: unknown): value is TimelineTaskStatus {
  return STATUSES.includes(value as TimelineTaskStatus);
}

const OP_FIELDS = {
  parent: (value: unknown) => typeof value === "string",
  title: (value: unknown) => typeof value === "string",
  note: (value: unknown) => typeof value === "string",
  description: (value: unknown) => typeof value === "string",
  status: isStatus,
  weight: (value: unknown) => typeof value === "number",
  done: (value: unknown) =>
    Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number"),
} as const;

/** The operation, or null when the mod would refuse it for a malformed or missing field. */
function readOp(value: unknown): TimelineOp | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.op !== "add" && raw.op !== "update" && raw.op !== "remove") return null;
  if (typeof raw.id !== "string") return null;
  for (const [field, isValid] of Object.entries(OP_FIELDS)) {
    if (raw[field] !== undefined && !isValid(raw[field])) return null;
  }
  return raw as unknown as TimelineOp;
}

function isValidDone(done: readonly [number, number]) {
  return done[0] >= 0 && done[0] <= done[1] && done[1] > 0;
}

function statusFromDone([completed, total]: readonly [number, number]): TimelineTaskStatus {
  if (completed === total) return "completed";
  return completed > 0 ? "in_progress" : "pending";
}

/** A status wins, a done without a status sets it, and completing fills every unit. */
function resolveState(
  status: TimelineTaskStatus | undefined,
  done: readonly [number, number] | undefined,
  before: { readonly status: TimelineTaskStatus; readonly done?: readonly [number, number] },
): { status: TimelineTaskStatus; done?: readonly [number, number] } | null {
  const units = done ?? before.done;
  const next = status ?? (done === undefined ? before.status : statusFromDone(done));
  if (next === "pending" && units !== undefined && units[0] > 0) return null;
  if (units === undefined) return { status: next };
  return { status: next, done: next === "completed" ? [units[1], units[1]] : units };
}

function withoutDone({ done: _done, ...rest }: TimelineTask): TimelineTask {
  return rest;
}

/** A task with subtasks takes its status from them and keeps no units of its own. */
function settleGroups(tasks: readonly TimelineTask[]): TimelineTask[] {
  const measures = measureAll(tasks);
  const parents = new Set(tasks.map((task) => task.parent));
  return tasks.map((task) =>
    parents.has(task.id)
      ? { ...withoutDone(task), status: measures.get(task.id)?.status ?? task.status }
      : task,
  );
}

function descendantIds(tasks: readonly TimelineTask[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const task of tasks) {
      if (task.parent !== null && ids.has(task.parent) && !ids.has(task.id)) {
        ids.add(task.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Applies `timeline_tasks` operations as the mod does, skipping the ones it refuses. */
export function applyTimelineOps(
  tasks: readonly TimelineTask[],
  ops: readonly unknown[],
): TimelineTask[] {
  let next = [...tasks];
  for (const value of ops) {
    const op = readOp(value);
    if (op === null) continue;
    if (op.done !== undefined && !isValidDone(op.done)) continue;
    if (op.weight !== undefined && !(op.weight > 0)) continue;
    const index = next.findIndex((task) => task.id === op.id);
    const current = next[index];
    if (op.op === "add") {
      if (current !== undefined) continue;
      if (op.parent !== undefined && !next.some((task) => task.id === op.parent)) continue;
      const state = resolveState(op.status, op.done, { status: "pending" });
      if (state === null) continue;
      next = settleGroups([
        ...next,
        {
          id: op.id,
          parent: op.parent ?? null,
          title: op.title ?? op.id,
          status: state.status,
          weight: op.weight ?? 1,
          ...(op.note === undefined ? {} : { note: op.note }),
          ...(state.done === undefined ? {} : { done: state.done }),
        },
      ]);
      continue;
    }
    if (current === undefined) continue;
    if (op.op === "remove") {
      const gone = descendantIds(next, op.id);
      next = settleGroups(next.filter((task) => !gone.has(task.id)));
      continue;
    }
    const isGroup = next.some((task) => task.parent === op.id);
    const state = isGroup ? { status: current.status } : resolveState(op.status, op.done, current);
    if (state === null) continue;
    next[index] = {
      ...withoutDone(current),
      ...(op.title === undefined ? {} : { title: op.title }),
      ...(op.weight === undefined ? {} : { weight: op.weight }),
      ...(op.note === undefined ? {} : { note: op.note }),
      ...state,
    };
    next = settleGroups(next);
  }
  return next;
}

/** The tree the thread's finished `timeline_tasks` calls build, in order. */
export function latestTimelineSummary(
  items: ReadonlyArray<{
    readonly type: string;
    readonly toolName?: string | null;
    readonly status?: string;
    readonly input?: unknown;
    readonly ordinal?: number;
  }>,
): TimelineSummary | null {
  // Older history pages are appended after the newer items, so order by ordinal.
  const calls = items
    .filter(
      (item) =>
        item.type === "dynamic_tool" &&
        item.status === "completed" &&
        item.toolName === TIMELINE_TASKS_TOOL,
    )
    .toSorted((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  const ops = calls.flatMap((item) => {
    const value = (item.input as { ops?: unknown } | null | undefined)?.ops;
    return Array.isArray(value) ? value : [];
  });
  const tasks = applyTimelineOps([], ops);
  return tasks.length === 0 ? null : summarizeTimeline(tasks);
}

/**
 * Tenths, rounded down, so open work (capped at 99.99%) never reads 100%; finished work can sum to
 * a hair under 1 in floating point.
 */
export function formatTimelinePercent(share: number) {
  return share > 0.99995 ? "100%" : `${(Math.floor(share * 1000) / 10).toFixed(1)}%`;
}

/** Rows to show: from just before the first open task without subtasks, else the last ones. */
export function timelineRowWindow(
  rows: ReadonlyArray<{ readonly status: TimelineTaskStatus; readonly leaf: boolean }>,
  limit: number,
) {
  if (rows.length <= limit) return { start: 0, end: rows.length };
  const open = rows.findIndex((row) => row.leaf && row.status !== "completed");
  const start = Math.min(Math.max(0, (open < 0 ? rows.length : open) - 2), rows.length - limit);
  return { start, end: start + limit };
}
