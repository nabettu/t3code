import { CommandId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildWatchPushContent, watchPushActionCommand } from "./watchPushContent.ts";

const base = {
  threadTitle: "Fix login",
  projectTitle: "app",
  requestId: null,
  approvalText: null,
  assistantText: null,
} as const;

describe("buildWatchPushContent", () => {
  it("puts the reply and numbered next labels in the body and the prompts behind the buttons", () => {
    const content = buildWatchPushContent({
      ...base,
      phase: "completed",
      assistantText: [
        "Done.",
        "",
        "```next",
        '[{"label":"Open a PR","prompt":"Push and open a PR."},{"label":"Run tests","prompt":"Run the tests."}]',
        "```",
      ].join("\n"),
    });
    expect(content).toEqual({
      title: "完了 · Fix login",
      subtitle: "app",
      body: "Done.\n\n1. Open a PR\n2. Run tests",
      category: "t3-watch-next-2",
      target: { requestId: null, prompts: ["Push and open a PR.", "Run the tests."] },
    });
  });

  it("gives an approval its request and the approval buttons, and none without a request", () => {
    const requestId = RuntimeRequestId.make("request-1");
    const content = buildWatchPushContent({
      ...base,
      phase: "waiting_for_approval",
      requestId,
      approvalText: "rm -rf build",
    });
    expect(content.category).toBe("t3-watch-approval");
    expect(content.body).toBe("rm -rf build");
    expect(content.target).toEqual({ requestId, prompts: [] });

    const withoutRequest = buildWatchPushContent({ ...base, phase: "waiting_for_approval" });
    expect(withoutRequest.category).toBeNull();
    expect(withoutRequest.target).toBeNull();
  });
});

describe("watchPushActionCommand", () => {
  const threadId = ThreadId.make("thread-1");
  const commandId = CommandId.make("watch-push:token");
  const requestId = RuntimeRequestId.make("request-1");

  it("answers the pending request for approve and deny, and refuses without one", () => {
    expect(
      watchPushActionCommand({ threadId, requestId, prompts: [] }, { type: "deny" }, commandId),
    ).toMatchObject({ type: "runtime-request.respond", requestId, decision: "decline" });
    expect(
      watchPushActionCommand(
        { threadId, requestId: null, prompts: [] },
        { type: "approve" },
        commandId,
      ),
    ).toBe("Nothing is waiting for approval.");
  });

  it("sends the chosen next prompt or the typed reply as a queued user message", () => {
    const target = { threadId, requestId: null, prompts: ["first", "second"] };
    expect(watchPushActionCommand(target, { type: "next", index: 2 }, commandId)).toMatchObject({
      type: "message.dispatch",
      text: "second",
      createdBy: "user",
      dispatchMode: { type: "queue_after_active" },
    });
    expect(watchPushActionCommand(target, { type: "next", index: 3 }, commandId)).toBe(
      "There is nothing to send.",
    );
    expect(
      watchPushActionCommand(target, { type: "reply", text: "  looks good  " }, commandId),
    ).toMatchObject({ type: "message.dispatch", text: "looks good" });
  });
});
