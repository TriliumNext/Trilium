import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The part of a `WKURLSchemeTask` that `RequestBroker` uses, so that it runs without WebKit.
protocol SchemeTask: AnyObject {
    /// Identifies the WebKit task, which `RequestBroker.stop(id:)` receives.
    var id: ObjectIdentifier { get }
    var request: URLRequest { get }
    func didReceive(_ response: URLResponse)
    func didReceive(_ data: Data)
    func didFinish()
    func didFailWithError(_ error: Error)
}

/// Must match `isLocalApiRequest()` in apps/standalone/src/local-bridge.ts.
private let localApiPrefixes = ["/bootstrap", "/api/", "/sync/", "/search/", "/custom/"]

/// Tracks the local API requests `TriliumRequestBridge` forwards to the page, from dispatch until
/// the page's reply completes their scheme tasks. It imports no WebKit, so it runs in
/// `swift test`; the bridge supplies script evaluation, scheduling and logging.
///
/// A request goes to the page through `window.__triliumNativeRequest()`, and the page's JSON
/// replies arrive through `receive(_:)`; the protocol is described in
/// apps/standalone/src/native-request-bridge.ts. Requests that arrive before the page sends
/// `ready` are queued, and `pageStarted()` fails whatever the previous page left unanswered.
///
/// WebKit calls the scheme handler, the message handler and `evaluateJavaScript` completions on
/// the main thread, so the broker expects to be used from that thread only.
final class RequestBroker {
    /// Runs a script in the page and reports whether it returned `true`.
    typealias Evaluate = (_ script: String, _ accepted: @escaping (Bool) -> Void) -> Void
    /// Runs the work on the main thread after the delay.
    typealias Schedule = (_ delay: TimeInterval, _ work: @escaping () -> Void) -> Void

    static let errorHeader = "x-trilium-bridge-error"

    private final class PendingRequest {
        let task: SchemeTask
        let script: String
        var headSent = false

        init(task: SchemeTask, script: String) {
            self.task = task
            self.script = script
        }
    }

    private let evaluate: Evaluate
    private let schedule: Schedule
    private let log: (String) -> Void
    private let headTimeout: TimeInterval

    private var pending: [Int: PendingRequest] = [:]
    private var taskIds: [ObjectIdentifier: Int] = [:]
    private var queuedIds: [Int] = []
    private var pageReady = false
    private var nextId = 0

    /// - Parameter headTimeout: how long the page has to send the head; the default matches the
    ///   service worker's limit in sw.ts, since the worker can be inside a long synchronous
    ///   stretch (a VACUUM of a large database) before it answers.
    init(evaluate: @escaping Evaluate, schedule: @escaping Schedule, log: @escaping (String) -> Void,
         headTimeout: TimeInterval = 270) {
        self.evaluate = evaluate
        self.schedule = schedule
        self.log = log
        self.headTimeout = headTimeout
    }

    /// Whether the path belongs to the local worker rather than to the app's bundled files.
    static func isLocalApiPath(_ path: String) -> Bool {
        if path == "/share" || (path.hasPrefix("/share/") && !path.hasPrefix("/share/assets/")) {
            return true
        }
        return localApiPrefixes.contains { path.hasPrefix($0) }
    }

    /// U+2028 and U+2029 are valid in JSON strings but end a line in JavaScript source.
    static func escapeLineSeparators(_ json: String) -> String {
        json.replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }

    func start(_ task: SchemeTask) {
        let request = task.request
        let method = (request.httpMethod ?? "GET").uppercased()
        guard method == "GET" || method == "HEAD" else {
            // Android's bridge cannot see request bodies, so neither platform forwards them; the
            // page sends these through standaloneApi.localFetch instead.
            respondWithError(task, status: 405,
                             message: "\(method) cannot be answered natively: the request body is not available")
            return
        }

        nextId += 1
        let id = nextId
        let payload: [String: Any] = [
            "id": id,
            "method": method,
            "url": request.url?.absoluteString ?? "",
            "headers": request.allHTTPHeaderFields ?? [:],
            "binary": false
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            respondWithError(task, status: 500, message: "Cannot encode the request")
            return
        }
        let literal = Self.escapeLineSeparators(json)

        pending[id] = PendingRequest(
            task: task,
            script: "window.__triliumNativeRequest ? (window.__triliumNativeRequest(\(literal)), true) : false")
        taskIds[task.id] = id
        if pageReady {
            dispatch(id)
        } else {
            queuedIds.append(id)
        }

        schedule(headTimeout) { [weak self] in
            guard let self = self, let request = self.pending[id], !request.headSent else { return }
            self.fail(id, status: 504, message: "The local worker did not answer in time")
        }
    }

    /// Returns true when the task was one of ours. A stopped task must not be completed, so it
    /// leaves the pending map before WebKit returns from `stop`.
    func stop(id: ObjectIdentifier) -> Bool {
        guard let requestId = taskIds.removeValue(forKey: id) else {
            return false
        }
        pending.removeValue(forKey: requestId)
        return true
    }

    func pageStarted() {
        pageReady = false
        queuedIds.removeAll()
        for id in pending.keys.sorted() {
            fail(id, message: "The page reloaded before answering")
        }
    }

    /// A JSON message from the page.
    func receive(_ message: String) {
        guard let data = message.data(using: .utf8),
              let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let type = body["type"] as? String else {
            log("Malformed message from the page")
            return
        }
        if type == "ready" {
            onPageReady()
            return
        }

        guard let id = body["id"] as? Int, let request = pending[id] else { return }
        switch type {
        case "head":
            receiveHead(id, request, status: body["status"] as? Int ?? 200,
                        headers: body["headers"] as? [String: String] ?? [:])
        case "chunk":
            if request.headSent, let encoded = body["data"] as? String,
               let bytes = Data(base64Encoded: encoded) {
                request.task.didReceive(bytes)
            }
        case "end":
            if take(id) != nil, request.headSent {
                request.task.didFinish()
            }
        case "error":
            fail(id, message: body["message"] as? String ?? "The local request failed")
        default:
            log("Unknown message type: \(type)")
        }
    }

    private func onPageReady() {
        pageReady = true
        let ids = queuedIds
        queuedIds.removeAll()
        for id in ids {
            dispatch(id)
        }
    }

    private func dispatch(_ id: Int) {
        guard let request = pending[id] else { return }
        evaluate(request.script) { [weak self] accepted in
            if !accepted {
                self?.fail(id, message: "The page has no request handler")
            }
        }
    }

    private func receiveHead(_ id: Int, _ request: PendingRequest, status: Int, headers: [String: String]) {
        // WebKit does not follow a redirect from a scheme task; the page turns redirects into a
        // 200 already.
        guard (100...599).contains(status), !(300...399).contains(status),
              let url = request.task.request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                             headerFields: headers) else {
            fail(id, message: "The local worker answered with status \(status)")
            return
        }
        request.task.didReceive(response)
        request.headSent = true
    }

    /// Before the head, answers with an error response the page can read; after it, fails the
    /// load.
    private func fail(_ id: Int, status: Int = 502, message: String) {
        guard let request = take(id) else { return }
        log(message)
        if request.headSent {
            request.task.didFailWithError(NSError(
                domain: "TriliumRequestBridge", code: status,
                userInfo: [NSLocalizedDescriptionKey: message]))
        } else {
            respondWithError(request.task, status: status, message: message)
        }
    }

    private func take(_ id: Int) -> PendingRequest? {
        guard let request = pending.removeValue(forKey: id) else { return nil }
        taskIds.removeValue(forKey: request.task.id)
        return request
    }

    private func respondWithError(_ task: SchemeTask, status: Int, message: String) {
        let body = Data(message.utf8)
        let headerValue = String(message.unicodeScalars.map {
            (0x20...0x7e).contains($0.value) ? Character($0) : " "
        })
        guard let url = task.request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [
                  "Content-Type": "text/plain; charset=utf-8",
                  "Content-Length": String(body.count),
                  Self.errorHeader: headerValue
              ]) else {
            task.didFailWithError(NSError(domain: "TriliumRequestBridge", code: status,
                                          userInfo: [NSLocalizedDescriptionKey: message]))
            return
        }
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }
}
