import type { NextAction } from "@t3tools/shared/nextActions";
import { PencilIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ComposerNextActions({
  actions,
  onSend,
  onEdit,
}: {
  readonly actions: ReadonlyArray<NextAction>;
  readonly onSend: (prompt: string) => void;
  readonly onEdit: (prompt: string) => void;
}) {
  return actions.map((action) => (
    <Group key={action.prompt} aria-label={action.label}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onSend(action.prompt)}
            />
          }
        >
          {action.label}
        </TooltipTrigger>
        <TooltipPopup side="top">{action.reason ?? action.prompt}</TooltipPopup>
      </Tooltip>
      <GroupSeparator />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              aria-label={`Edit before sending: ${action.label}`}
              onClick={() => onEdit(action.prompt)}
            />
          }
        >
          <PencilIcon />
        </TooltipTrigger>
        <TooltipPopup side="top">Edit before sending</TooltipPopup>
      </Tooltip>
    </Group>
  ));
}
