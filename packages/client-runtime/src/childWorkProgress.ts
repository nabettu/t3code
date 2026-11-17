import type { OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";

import { todoProgressSummary, type TodoProgressSummary } from "./todoProgress.ts";

export interface ChildWork {
  readonly threadId: ThreadId | null;
  readonly title: string;
  readonly finished: boolean;
  readonly todo: TodoProgressSummary | null;
}

export interface ChildWorkProgress {
  readonly finished: number;
  readonly total: number;
  readonly children: ReadonlyArray<ChildWork>;
}

/**
 * A parent's subagent counts from its own shell, with the todo list of each child the client
 * holds. Shells may omit idle children, so the counts never come from child shells.
 */
export function childWorkProgress(
  parent: Pick<OrchestrationV2ThreadShell, "childWork"> | null,
  threadIndex: ReadonlyMap<ThreadId, OrchestrationV2ThreadShell>,
): ChildWorkProgress | null {
  const work = parent?.childWork;
  if (work == null || work.total === 0) return null;
  return {
    finished: work.finished,
    total: work.total,
    children: work.children.map((child) => {
      const shell = child.threadId === null ? undefined : threadIndex.get(child.threadId);
      return {
        threadId: child.threadId,
        title: child.title,
        finished: child.finished,
        todo:
          shell === undefined
            ? null
            : todoProgressSummary({
                todoProgress: shell.todoProgress,
                latestRun: shell.latestRunId === null ? null : { runId: shell.latestRunId },
              }),
      };
    }),
  };
}

export function sameChildWorkProgress(
  left: ChildWorkProgress | null,
  right: ChildWorkProgress | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.finished === right.finished &&
    left.total === right.total &&
    left.children.length === right.children.length &&
    left.children.every((child, index) => {
      const other = right.children[index]!;
      return (
        child.threadId === other.threadId &&
        child.title === other.title &&
        child.finished === other.finished &&
        child.todo?.completed === other.todo?.completed &&
        child.todo?.total === other.todo?.total &&
        child.todo?.current === other.todo?.current
      );
    })
  );
}
