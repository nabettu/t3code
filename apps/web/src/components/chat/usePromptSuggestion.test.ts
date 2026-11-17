import {
  MessageId,
  type OrchestrationV2Run,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { offeredNextActions } from "./nextActions.logic";
import { offeredPromptSuggestion } from "./usePromptSuggestion";

const now = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");
const run = (
  id: RunId,
  ordinal: number,
  status: OrchestrationV2Run["status"],
  started = true,
): OrchestrationV2Run => ({
  id,
  threadId: ThreadId.make("thread-1"),
  ordinal,
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-haiku-4-5" },
  providerThreadId: null,
  userMessageId: MessageId.make(`message-${ordinal}`),
  rootNodeId: null,
  activeAttemptId: null,
  status,
  requestedAt: now,
  startedAt: started ? now : null,
  completedAt: now,
  checkpointId: null,
  contextHandoffId: null,
});
const summary = (value: OrchestrationV2Run) => ({
  runId: value.id,
  status: value.status,
  requestedAt: null,
  startedAt: value.startedAt === null ? null : "2026-06-20T00:00:00.000Z",
  completedAt: "2026-06-20T00:00:00.000Z",
  assistantMessageId: null,
});

describe("offeredPromptSuggestion", () => {
  it("offers the finished turn's suggestion after a queued message was promoted to Steer", () => {
    const turn = run(RunId.make("run-1"), 1, "completed");
    const steered = run(RunId.make("run-2"), 2, "cancelled", false);
    const suggestion = { runId: turn.id, text: "run the tests" };

    expect(offeredPromptSuggestion(suggestion, summary(steered), [turn, steered])).toBe(suggestion);

    // A later run that did start still replaces the earlier turn's suggestion.
    const stopped = run(RunId.make("run-2"), 2, "cancelled");
    expect(offeredPromptSuggestion(suggestion, summary(stopped), [turn, stopped])).toBeNull();

    // Several never-started runs in a row still fall back to the turn that ran.
    const removed = run(RunId.make("run-3"), 3, "cancelled", false);
    expect(offeredPromptSuggestion(suggestion, summary(removed), [turn, steered, removed])).toBe(
      suggestion,
    );

    // A newer turn that completed behind the cancelled run owns the suggestion slot.
    const next = run(RunId.make("run-2"), 2, "completed");
    expect(offeredPromptSuggestion(suggestion, summary(removed), [turn, next, removed])).toBeNull();

    // Cached detail that predates the shell's cancelled run cannot vouch for what ran in between.
    const unseen = run(RunId.make("run-3"), 3, "cancelled", false);
    expect(offeredPromptSuggestion(suggestion, summary(unseen), [turn])).toBeNull();
  });
});

describe("offeredNextActions", () => {
  const block = '```next\n[{"label":"Open a PR","prompt":"Open a PR."}]\n```';
  const reply = (runId: RunId, streaming = false) => ({
    role: "assistant" as const,
    runId,
    text: `Done.\n\n${block}`,
    streaming,
  });

  it("offers the last reply's actions only while its run is the latest completed run", () => {
    const turn = run(RunId.make("run-1"), 1, "completed");
    expect(offeredNextActions(summary(turn), [turn], [reply(turn.id)])?.actions).toEqual([
      { label: "Open a PR", prompt: "Open a PR." },
    ]);
    expect(offeredNextActions(summary(turn), [turn], [reply(turn.id, true)])).toBeNull();

    const next = run(RunId.make("run-2"), 2, "running");
    expect(offeredNextActions(summary(next), [turn, next], [reply(turn.id)])).toBeNull();

    // A later reply without a block hides the earlier one's actions.
    const done = run(RunId.make("run-2"), 2, "completed");
    expect(
      offeredNextActions(
        summary(done),
        [turn, done],
        [reply(turn.id), { role: "assistant", runId: done.id, text: "Done.", streaming: false }],
      ),
    ).toBeNull();
  });
});
