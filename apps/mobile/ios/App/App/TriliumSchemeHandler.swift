import Capacitor
import Foundation
import WebKit

/// Path prefixes served by the in-page SQLite worker.
/// Keep in sync with LOCAL_API_PREFIXES in apps/standalone/src/local-bridge.ts.
private let localApiPrefixes = ["/bootstrap", "/api/", "/sync/", "/search/"]

/// Takes over Capacitor's registered WebViewAssetHandler via object_setClass (see
/// ViewController.webView(with:configuration:)), so it sees every request on the
/// capacitor:// scheme regardless of which engine subsystem initiated it — fetch,
/// XHR, images, fonts, media, iframes, CSS @import. Local API paths are answered by
/// the in-page SQLite worker through TriliumSchemeBridge; everything else falls
/// through to Capacitor's regular asset serving.
///
/// MUST NOT declare stored properties: the instance it takes over was allocated as
/// WebViewAssetHandler, so subclass ivars would be uninitialized. All state lives in
/// TriliumSchemeBridge.shared.
final class TriliumAssetHandler: WebViewAssetHandler {
    override func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        if let path = urlSchemeTask.request.url?.path,
           localApiPrefixes.contains(where: { path.hasPrefix($0) }) {
            TriliumSchemeBridge.shared.intercept(urlSchemeTask, from: webView)
            return
        }
        super.webView(webView, start: urlSchemeTask)
    }

    override func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        if TriliumSchemeBridge.shared.cancel(urlSchemeTask) {
            return
        }
        super.webView(webView, stop: urlSchemeTask)
    }
}

/// Forwards intercepted local API requests into the page's JS bridge
/// (`window.__triliumNativeRequest`, installed by apps/standalone/src/ios-native-bridge.ts),
/// which routes them to the SQLite worker, and completes the WKURLSchemeTasks with
/// the responses posted back through the "triliumScheme" script message handler.
///
/// All state is confined to the main thread — WebKit delivers scheme-handler
/// callbacks, script messages, and evaluateJavaScript completions there.
final class TriliumSchemeBridge: NSObject, WKScriptMessageHandler {
    static let shared = TriliumSchemeBridge()

    private var pendingTasks: [String: WKURLSchemeTask] = [:]
    private var taskIds: [ObjectIdentifier: String] = [:]
    /// Requests intercepted before the JS bridge announced readiness.
    private var queuedRequests: [(id: String, json: String)] = []
    private var isJsReady = false
    private weak var webView: WKWebView?
    private var requestCounter = 0

    func intercept(_ urlSchemeTask: WKURLSchemeTask, from webView: WKWebView) {
        self.webView = webView
        requestCounter += 1
        let id = "req\(requestCounter)"

        let request = urlSchemeTask.request
        var payload: [String: Any] = [
            "id": id,
            "method": request.httpMethod ?? "GET",
            "url": request.url?.absoluteString ?? "",
            "headers": request.allHTTPHeaderFields ?? [:]
        ]
        if let body = requestBody(of: request), !body.isEmpty {
            payload["bodyBase64"] = body.base64EncodedString()
        }

        guard let json = try? JSONSerialization.data(withJSONObject: payload),
              let jsonString = String(data: json, encoding: .utf8) else {
            urlSchemeTask.didFailWithError(bridgeError("Could not encode request payload"))
            return
        }
        // JSON is not quite a JS literal: U+2028/U+2029 are legal unescaped in JSON
        // strings but are line terminators in JS source.
        let jsSafeJson = jsonString
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")

        pendingTasks[id] = urlSchemeTask
        taskIds[ObjectIdentifier(urlSchemeTask)] = id

        if isJsReady {
            deliver(jsSafeJson, id: id)
        } else {
            queuedRequests.append((id: id, json: jsSafeJson))
        }
    }

    /// Returns true when the task was one of ours and is now dropped. Completing a
    /// stopped WKURLSchemeTask raises an exception, so it must leave the pending map
    /// before WebKit returns from stop().
    func cancel(_ urlSchemeTask: WKURLSchemeTask) -> Bool {
        guard let id = taskIds.removeValue(forKey: ObjectIdentifier(urlSchemeTask)) else {
            return false
        }
        pendingTasks.removeValue(forKey: id)
        return true
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            isJsReady = true
            let queued = queuedRequests
            queuedRequests = []
            for item in queued {
                deliver(item.json, id: item.id)
            }
        case "response":
            guard let id = body["id"] as? String, let task = takeTask(id: id) else { return }
            complete(task, with: body)
        case "error":
            guard let id = body["id"] as? String else { return }
            fail(id: id, message: body["message"] as? String ?? "Request failed")
        default:
            break
        }
    }

    private func deliver(_ json: String, id: String) {
        webView?.evaluateJavaScript("window.__triliumNativeRequest(\(json))") { [weak self] _, error in
            if error != nil {
                // The page is mid-reload or the JS bridge is missing; fail fast
                // instead of leaving the load hanging forever.
                self?.fail(id: id, message: "JS bridge unavailable")
            }
        }
    }

    private func complete(_ task: WKURLSchemeTask, with body: [String: Any]) {
        guard let url = task.request.url else {
            task.didFailWithError(bridgeError("Task has no URL"))
            return
        }
        let data = (body["bodyBase64"] as? String).flatMap { Data(base64Encoded: $0) } ?? Data()
        // The worker's content-length reflects its own encoding; it must match the
        // bytes actually delivered or WebKit stalls the load.
        var headers = ((body["headers"] as? [String: String]) ?? [:])
            .filter { $0.key.caseInsensitiveCompare("Content-Length") != .orderedSame }
        headers["Content-Length"] = String(data.count)

        guard let response = HTTPURLResponse(
            url: url,
            statusCode: body["status"] as? Int ?? 200,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ) else {
            task.didFailWithError(bridgeError("Could not build response"))
            return
        }
        task.didReceive(response)
        if !data.isEmpty {
            task.didReceive(data)
        }
        task.didFinish()
    }

    private func fail(id: String, message: String) {
        guard let task = takeTask(id: id) else { return }
        task.didFailWithError(bridgeError(message))
    }

    private func takeTask(id: String) -> WKURLSchemeTask? {
        guard let task = pendingTasks.removeValue(forKey: id) else { return nil }
        taskIds.removeValue(forKey: ObjectIdentifier(task))
        return task
    }

    /// httpBody is nil for WKURLSchemeTask requests on some WebKit versions; the
    /// body arrives as a stream instead.
    private func requestBody(of request: URLRequest) -> Data? {
        if let body = request.httpBody {
            return body
        }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufferSize = 64 * 1024
        var buffer = [UInt8](repeating: 0, count: bufferSize)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: bufferSize)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }

    private func bridgeError(_ message: String) -> NSError {
        NSError(domain: "TriliumSchemeBridge", code: 0, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
