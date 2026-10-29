export const SETTLE_THREAD_ACTION = {
  accessibilityLabel: "Settle thread",
  icon: "checkmark.circle",
} as const;

/** iOS native header items serialize buttons in react-native-screens' shape. */
export function settleThreadHeaderItem(onSettle: () => void) {
  return {
    accessibilityLabel: SETTLE_THREAD_ACTION.accessibilityLabel,
    icon: { name: SETTLE_THREAD_ACTION.icon, type: "sfSymbol" as const },
    identifier: "thread-right-settle",
    label: "Settle",
    onPress: onSettle,
    sharesBackground: true,
    type: "button" as const,
    variant: "plain" as const,
  };
}
