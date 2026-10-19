// Keep paid requests behind a real browser gesture without an extra dialog.
export function isUserAction(event: { nativeEvent: { isTrusted: boolean } }) {
  return event.nativeEvent.isTrusted;
}
