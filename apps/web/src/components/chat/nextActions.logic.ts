import type { OrchestrationV2ConversationMessage, OrchestrationV2Run } from "@t3tools/contracts";
import { splitNextActions } from "@t3tools/client-runtime/next-actions";

import type { Thread } from "../../types";
import { offeredPromptSuggestion } from "./usePromptSuggestion";

/** The next actions the thread's last reply suggests, while its run is the latest completed one. */
export function offeredNextActions(
  latestRun: Thread["latestRun"] | undefined,
  runs: ReadonlyArray<OrchestrationV2Run>,
  messages: ReadonlyArray<
    Pick<OrchestrationV2ConversationMessage, "role" | "runId" | "text" | "streaming">
  >,
) {
  const reply = messages.findLast((message) => message.role === "assistant");
  if (reply === undefined || reply.runId === null || reply.streaming) return null;
  const { actions } = splitNextActions(reply.text);
  if (actions.length === 0) return null;
  return offeredPromptSuggestion({ runId: reply.runId, actions }, latestRun, runs);
}
