import { CommandId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildWatchPushApnsPayload,
  buildWatchPushContent,
  readWatchPushText,
  watchPushActionCommand,
} from "./watchPushContent.ts";

const base = {
  threadTitle: "Fix login",
  projectTitle: "app",
  requestId: null,
  approvalText: null,
  assistantText: null,
} as const;

describe("buildWatchPushContent", () => {
  it("puts the reply in the body and the next labels and prompts on the buttons", () => {
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
      body: "Done.",
      buttonTitles: ["1. Open a PR", "2. Run tests"],
      category: "t3-watch-next-2",
      target: { requestId: null, prompts: ["Push and open a PR.", "Run the tests."] },
    });
  });

  it("takes its wording, lengths and button format from the text settings", () => {
    const text = readWatchPushText({
      phaseLabels: { completed: "Done" },
      titleFormat: "{thread} ({phase})",
      bodyMaxLength: 3,
      listChoicesInBody: true,
      buttonFormat: "{label}",
      buttonMaxLength: 5,
    });
    const content = buildWatchPushContent(
      {
        ...base,
        phase: "completed",
        assistantText: 'Done.\n\n```next\n[{"label":"Open a PR","prompt":"p"}]\n```',
      },
      text,
    );
    expect(content).toMatchObject({
      title: "Fix login (Done)",
      body: "Do…",
      choices: "1. Open a PR",
      buttonTitles: ["Open…"],
    });
    expect(buildWatchPushContent({ ...base, phase: "failed" }, text).title).toBe(
      "Fix login (失敗)",
    );
  });

  it("falls back to the defaults for missing or malformed text settings", () => {
    const defaults = readWatchPushText(undefined);
    expect(
      readWatchPushText({
        phaseLabels: { completed: 1 },
        titleFormat: "",
        bodyMaxLength: -5,
        listChoicesInBody: "yes",
        buttonFormat: 3,
        buttonMaxLength: "40",
      }),
    ).toEqual(defaults);
    expect(defaults).toMatchObject({ listChoicesInBody: false, buttonFormat: "{n}. {label}" });
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

describe("buildWatchPushApnsPayload", () => {
  it("stays under the APNs size limit however long the reply, title and project are", () => {
    const long = "あ".repeat(3000);
    const payload = buildWatchPushApnsPayload({
      content: {
        title: long,
        subtitle: long,
        body: long,
        choices: "1. Open a PR",
        buttonTitles: ["1. Open a PR", "2. Run tests"],
        category: "t3-watch-next-2",
        target: null,
      },
      environmentId: "environment",
      threadId: "thread",
      deepLink: "/threads/environment/thread",
      actionUrl: `https://${"h".repeat(500)}.test/api/watch-push/action/${"x".repeat(32)}`,
    });
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(3800);
    expect(payload.aps.alert.body.length).toBeGreaterThan(100);
    expect(payload.aps.alert.body.startsWith("1. Open a PR\n\n")).toBe(true);
    // The phone's notification extension uses these as the button titles.
    expect(payload.aps["mutable-content"]).toBe(1);
    expect(payload.t3WatchChoices).toEqual(["1. Open a PR", "2. Run tests"]);
  });

  it("leaves the extension out when there are no choices", () => {
    const payload = buildWatchPushApnsPayload({
      content: { title: "t", subtitle: "s", body: "b", category: "t3-watch-next-0", target: null },
      environmentId: "environment",
      threadId: "thread",
      deepLink: "/threads/environment/thread",
      actionUrl: null,
    });
    expect(payload.aps).not.toHaveProperty("mutable-content");
    expect(payload).not.toHaveProperty("t3WatchChoices");
  });
});

describe("watchPushActionCommand", () => {
  const threadId = ThreadId.make("thread-1");
  const commandId = CommandId.make("watch-push:token");
  const requestId = RuntimeRequestId.make("request-1");

  it("answers the pending request for approve and deny, and refuses without one", () => {
    expect(
      watchPushActionCommand({ threadId, requestId, prompts: [] }, { type: "approve" }, commandId),
    ).toMatchObject({ type: "runtime-request.respond", requestId, decision: "accept" });
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
