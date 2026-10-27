import Capacitor
import Foundation
import WebKit

/// Capacitor's `WebViewAssetHandler` for `capacitor://`, re-typed by
/// `ViewController.webView(with:configuration:)`. It sees every request on the scheme, whichever
/// part of the engine issued it (fetch, XHR, images, fonts, media, iframes), hands local API
/// paths to `TriliumRequestBridge`, and leaves the rest to Capacitor's asset serving.
///
/// It must not declare stored properties: the instance it takes over was allocated as a
/// `WebViewAssetHandler`, so the subclass's storage would be uninitialized.
final class TriliumAssetHandler: WebViewAssetHandler {
    override func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let request = urlSchemeTask.request
        if let url = request.url, url == request.mainDocumentURL {
            TriliumRequestBridge.shared.pageStarted()
        }
        if let path = request.url?.path, RequestBroker.isLocalApiPath(path) {
            TriliumRequestBridge.shared.start(urlSchemeTask, in: webView)
            return
        }
        super.webView(webView, start: urlSchemeTask)
    }

    override func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        if TriliumRequestBridge.shared.stop(urlSchemeTask) {
            return
        }
        super.webView(webView, stop: urlSchemeTask)
    }
}

/// Answers local API requests from the page's SQLite worker, in place of a service worker.
///
/// Connects `RequestBroker`, which holds the request logic, to WebKit: `evaluateJavaScript`
/// delivers requests, and the `triliumRequestBridge` script message handler carries the page's
/// replies.
final class TriliumRequestBridge: NSObject, WKScriptMessageHandler {
    static let shared = TriliumRequestBridge()
    static let messageHandlerName = "triliumRequestBridge"

    private weak var webView: WKWebView?

    private lazy var broker = RequestBroker(
        evaluate: { [weak self] script, accepted in
            guard let webView = self?.webView else {
                accepted(false)
                return
            }
            webView.evaluateJavaScript(script) { result, error in
                accepted(error == nil && (result as? Bool) == true)
            }
        },
        schedule: { delay, work in
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
        },
        log: { message in
            NSLog("[TriliumRequestBridge] %@", message)
        })

    func start(_ task: WKURLSchemeTask, in webView: WKWebView) {
        self.webView = webView
        broker.start(WebKitSchemeTask(task))
    }

    /// Returns true when the task was one of ours.
    func stop(_ task: WKURLSchemeTask) -> Bool {
        broker.stop(id: ObjectIdentifier(task))
    }

    func pageStarted() {
        broker.pageStarted()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let text = message.body as? String else { return }
        broker.receive(text)
    }
}

/// A `WKURLSchemeTask` as `RequestBroker` sees it.
private final class WebKitSchemeTask: SchemeTask {
    private let task: WKURLSchemeTask

    init(_ task: WKURLSchemeTask) {
        self.task = task
    }

    var id: ObjectIdentifier { ObjectIdentifier(task) }
    var request: URLRequest { task.request }
    func didReceive(_ response: URLResponse) { task.didReceive(response) }
    func didReceive(_ data: Data) { task.didReceive(data) }
    func didFinish() { task.didFinish() }
    func didFailWithError(_ error: Error) { task.didFailWithError(error) }
}
