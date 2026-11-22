import UserNotifications

// Ids match apps/server/src/watchPush/watchPushContent.ts and the app's T3WatchActionsSubscriber.
private let choicesKey = "t3WatchChoices"
private let nextActionPrefix = "t3-watch-next-"
private let replyAction = "t3-watch-reply"
private let choiceCategoryPrefix = "t3-watch-choices-"
private let choiceCategoriesKey = "t3WatchChoiceCategories"
// Older notifications keep their buttons while their category is still registered.
private let keptChoiceCategories = 32

/// Gives each next-action push its own category, so the buttons read "1. Open a PR" instead of
/// "1". Categories are fixed per id, and the labels only arrive with the push.
final class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var fallback: UNNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    fallback = request.content
    guard
      let labels = request.content.userInfo[choicesKey] as? [String], !labels.isEmpty,
      let content = request.content.mutableCopy() as? UNMutableNotificationContent
    else { return finish(request.content) }

    let category = "\(choiceCategoryPrefix)\(request.identifier)"
    let options: UNNotificationActionOptions = [.authenticationRequired]
    let actions: [UNNotificationAction] =
      labels.prefix(3).enumerated().map { index, label in
        UNNotificationAction(
          identifier: "\(nextActionPrefix)\(index + 1)", title: "\(index + 1). \(label)",
          options: options)
      } + [
        UNTextInputNotificationAction(
          identifier: replyAction, title: "返信", options: options,
          textInputButtonTitle: "送信", textInputPlaceholder: "メッセージ")
      ]

    let defaults = UserDefaults.standard
    let order = (defaults.stringArray(forKey: choiceCategoriesKey) ?? []) + [category]
    let dropped = Set(order.dropLast(keptChoiceCategories))
    defaults.set(Array(order.suffix(keptChoiceCategories)), forKey: choiceCategoriesKey)

    let center = UNUserNotificationCenter.current()
    center.getNotificationCategories { existing in
      var categories = existing.filter { !dropped.contains($0.identifier) }
      categories.insert(
        UNNotificationCategory(identifier: category, actions: actions, intentIdentifiers: []))
      center.setNotificationCategories(categories)
      content.categoryIdentifier = category
      // Reading back waits for the new category to be stored before the banner looks it up.
      center.getNotificationCategories { _ in self.finish(content) }
    }
  }

  override func serviceExtensionTimeWillExpire() {
    if let fallback { finish(fallback) }
  }

  private func finish(_ content: UNNotificationContent) {
    contentHandler?(content)
    contentHandler = nil
  }
}
