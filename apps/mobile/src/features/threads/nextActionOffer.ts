import { type NextAction, splitNextActions } from "@t3tools/shared/nextActions";

import type { ThreadFeedEntry, ThreadFeedLatestRun } from "../../lib/threadActivity";

const NO_ACTIONS: ReadonlyArray<NextAction> = [];

/** The next actions the latest reply of a finished, idle run offers; none once anything newer starts. */
export function resolveOfferedNextActions(input: {
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
  readonly latestRun: ThreadFeedLatestRun | null;
  readonly busy: boolean;
  readonly hasPendingRequest: boolean;
}): ReadonlyArray<NextAction> {
  const { latestRun } = input;
  if (input.busy || input.hasPendingRequest || latestRun?.status !== "completed") return NO_ACTIONS;
  for (let index = input.feed.length - 1; index >= 0; index -= 1) {
    const entry = input.feed[index]!;
    if (entry.type !== "message") continue;
    const { message } = entry;
    if (message.role !== "assistant" || message.streaming || message.runId !== latestRun.runId) {
      return NO_ACTIONS;
    }
    return splitNextActions(message.text).actions;
  }
  return NO_ACTIONS;
}
