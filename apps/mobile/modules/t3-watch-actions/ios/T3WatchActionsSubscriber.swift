import ExpoModulesCore
import ExpoNotifications
import UIKit
import UserNotifications

// Category and action ids match apps/server/src/watchPush/watchPushContent.ts.
private let approvalCategory = "t3-watch-approval"
private let approveAction = "t3-watch-approve"
private let denyAction = "t3-watch-deny"
private let replyAction = "t3-watch-reply"
private let nextActionPrefix = "t3-watch-next-"
private let actionUrlKey = "t3WatchActionUrl"

/// Buttons on pushes the T3 server sends straight over APNs. A press posts to the one-shot URL
/// in the push from native code, so it works from the lock screen and Apple Watch without
/// waiting for the JS app to start.
public final class T3WatchActionsSubscriber: ExpoAppDelegateSubscriber, NotificationDelegate {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    NotificationCenterManager.shared.addDelegate(self)
    registerCategories()
    return true
  }

  private func registerCategories() {
    // Authentication keeps a locked phone from approving; an unlocked watch on the wrist counts.
    let options: UNNotificationActionOptions = [.authenticationRequired]
    let reply = UNTextInputNotificationAction(
      identifier: replyAction,
      title: "返信",
      options: options,
      textInputButtonTitle: "送信",
      textInputPlaceholder: "メッセージ"
    )
    var categories: [UNNotificationCategory] = [
      UNNotificationCategory(
        identifier: approvalCategory,
        actions: [
          UNNotificationAction(identifier: approveAction, title: "許可", options: options),
          UNNotificationAction(
            identifier: denyAction, title: "拒否", options: options.union(.destructive)),
        ],
        intentIdentifiers: []
      )
    ]
    for count in 0...3 {
      let next = (0..<count).map { index in
        UNNotificationAction(
          identifier: "\(nextActionPrefix)\(index + 1)", title: "\(index + 1)", options: options)
      }
      categories.append(
        UNNotificationCategory(
          identifier: "\(nextActionPrefix)\(count)",
          actions: next + [reply],
          intentIdentifiers: []
        ))
    }
    let center = UNUserNotificationCenter.current()
    center.getNotificationCategories { existing in
      let ours = Set(categories.map(\.identifier))
      center.setNotificationCategories(
        existing.filter { !ours.contains($0.identifier) }.union(categories))
    }
  }

  public func didReceive(
    _ response: UNNotificationResponse, completionHandler: @escaping () -> Void
  ) -> Bool {
    guard
      let body = actionBody(response),
      let urlString = response.notification.request.content.userInfo[actionUrlKey] as? String,
      let url = URL(string: urlString)
    else { return false }
    post(body, to: url)
    return true
  }

  private func actionBody(_ response: UNNotificationResponse) -> [String: Any]? {
    switch response.actionIdentifier {
    case approveAction: return ["type": "approve"]
    case denyAction: return ["type": "deny"]
    case replyAction:
      guard let text = (response as? UNTextInputNotificationResponse)?.userText,
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      else { return nil }
      return ["type": "reply", "text": text]
    default:
      guard response.actionIdentifier.hasPrefix(nextActionPrefix),
        let index = Int(response.actionIdentifier.dropFirst(nextActionPrefix.count))
      else { return nil }
      return ["type": "next", "index": index]
    }
  }

  private func post(_ body: [String: Any], to url: URL) {
    let application = UIApplication.shared
    var task = UIBackgroundTaskIdentifier.invalid
    let finish = {
      guard task != .invalid else { return }
      application.endBackgroundTask(task)
      task = .invalid
    }
    task = application.beginBackgroundTask(withName: "T3 watch action") { finish() }

    var request = URLRequest(url: url, timeoutInterval: 20)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: request) { data, response, error in
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if error != nil || !(200..<300).contains(status) {
        let detail = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        Self.reportFailure(
          detail.isEmpty ? (error?.localizedDescription ?? "HTTP \(status)") : detail)
      }
      DispatchQueue.main.async { finish() }
    }.resume()
  }

  // A silent failure would leave the user thinking the agent got the answer.
  private static func reportFailure(_ detail: String) {
    let content = UNMutableNotificationContent()
    content.title = "T3 に送れませんでした"
    content.body = detail
    content.sound = .default
    UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
  }
}
