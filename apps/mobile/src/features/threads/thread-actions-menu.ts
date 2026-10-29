import type { AppBarMenu } from "../../components/ui/AppBar.types";

const TITLE = "Thread actions";
const ICON = "ellipsis.circle";
const SETTLE = {
  title: "Settle",
  icon: "checkmark.circle",
  subtitle: "Close this chat and return to the list",
};

/** Android app bars and the pre-glass iOS toolbar render this menu shape. */
export function threadActionsMenu(onSettle: () => void): AppBarMenu {
  return {
    title: TITLE,
    icon: ICON,
    items: [{ id: "thread-settle", ...SETTLE, onPress: onSettle }],
  };
}

/** iOS native header items serialize menus in react-native-screens' shape. */
export function threadActionsHeaderItem(onSettle: () => void) {
  return {
    accessibilityLabel: TITLE,
    icon: { name: ICON, type: "sfSymbol" as const },
    identifier: "thread-right-actions",
    label: TITLE,
    menu: {
      items: [
        {
          description: SETTLE.subtitle,
          icon: { name: SETTLE.icon, type: "sfSymbol" as const },
          label: SETTLE.title,
          onPress: onSettle,
          type: "action" as const,
        },
      ],
      title: TITLE,
    },
    sharesBackground: true,
    type: "menu" as const,
    variant: "plain" as const,
  };
}
