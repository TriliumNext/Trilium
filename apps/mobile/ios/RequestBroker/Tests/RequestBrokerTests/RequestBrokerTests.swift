import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import RequestBroker

final class RequestBrokerTests: XCTestCase {
    private var scripts: [String] = []
    private var logs: [String] = []
    private var timers: [() -> Void] = []
    private var pageAccepts = true
    private var broker: RequestBroker!

    override func setUp() {
        super.setUp()
        scripts = []
        logs = []
        timers = []
        pageAccepts = true
        broker = RequestBroker(
            evaluate: { [unowned self] script, accepted in
                scripts.append(script)
                accepted(pageAccepts)
            },
            schedule: { [unowned self] _, work in timers.append(work) },
            log: { [unowned self] message in logs.append(message) })
    }

    func testRecognizesTheWorkerPaths() {
        for path in ["/bootstrap", "/api/notes", "/sync/changed", "/search/x", "/custom/hook", "/share", "/share/abc"] {
            XCTAssertTrue(RequestBroker.isLocalApiPath(path), path)
        }
        for path in ["/share/assets/style.css", "/sharex", "/index.html", "/apix"] {
            XCTAssertFalse(RequestBroker.isLocalApiPath(path), path)
        }
    }

    func testRejectsMethodsThatCarryABody() {
        let task = FakeTask("capacitor://localhost/api/notes", method: "post")
        broker.start(task)

        let message = "POST cannot be answered natively: the request body is not available"
        XCTAssertEqual(task.events, ["response 405", "data \(message.utf8.count) bytes", "finish"])
        XCTAssertEqual(task.response?.value(forHTTPHeaderField: RequestBroker.errorHeader), message)
        XCTAssertEqual(task.bodyText, message)
        XCTAssertTrue(scripts.isEmpty)
    }

    func testQueuesUntilReadyThenStreamsTheBody() throws {
        let task = FakeTask("capacitor://localhost/api/images/x", headers: ["Range": "bytes=0-"])
        broker.start(task)
        XCTAssertTrue(scripts.isEmpty, "nothing is dispatched before the page is ready")

        broker.receive(#"{"type":"ready"}"#)
        XCTAssertEqual(scripts.count, 1)
        let script = scripts[0]
        XCTAssertTrue(script.hasPrefix("window.__triliumNativeRequest ? (window.__triliumNativeRequest({"), script)
        XCTAssertTrue(script.hasSuffix("), true) : false"), script)
        let payload = try payloadOf(script)
        XCTAssertEqual(payload["method"] as? String, "GET")
        XCTAssertEqual(payload["binary"] as? Bool, false)
        XCTAssertEqual(payload["url"] as? String, "capacitor://localhost/api/images/x")
        XCTAssertEqual((payload["headers"] as? [String: String])?["Range"], "bytes=0-")
        let id = try XCTUnwrap(payload["id"] as? Int)

        broker.receive(#"{"type":"head","id":\#(id),"status":206,"headers":{"Content-Type":"image/png"}}"#)
        broker.receive(#"{"type":"chunk","id":\#(id),"data":"\#(base64("hel"))"}"#)
        broker.receive(#"{"type":"chunk","id":\#(id),"data":"\#(base64("lo"))"}"#)
        broker.receive(#"{"type":"end","id":\#(id)}"#)

        XCTAssertEqual(task.events, ["response 206", "data 3 bytes", "data 2 bytes", "finish"])
        XCTAssertEqual(task.response?.value(forHTTPHeaderField: "Content-Type"), "image/png")
        XCTAssertEqual(task.bodyText, "hello")
        XCTAssertTrue(broker.stop(id: task.id) == false, "a finished task leaves the broker")
    }

    func testDispatchesAtOnceWhenThePageIsReady() throws {
        broker.receive(#"{"type":"ready"}"#)
        let task = FakeTask("capacitor://localhost/api/notes", method: "HEAD")
        broker.start(task)

        XCTAssertEqual(try payloadOf(XCTUnwrap(scripts.first))["method"] as? String, "HEAD")
    }

    func testAnswersAnErrorBeforeTheHeadAsABadGateway() throws {
        let (task, id) = try startReady()
        broker.receive(#"{"type":"error","id":\#(id),"message":"café closed"}"#)

        XCTAssertEqual(task.events.first, "response 502")
        XCTAssertEqual(task.events.last, "finish")
        XCTAssertEqual(task.response?.value(forHTTPHeaderField: RequestBroker.errorHeader), "caf  closed")
        XCTAssertEqual(task.bodyText, "café closed")
        XCTAssertEqual(logs, ["café closed"])
    }

    func testFailsTheLoadOnAnErrorAfterTheHead() throws {
        let (task, id) = try startReady()
        broker.receive(#"{"type":"head","id":\#(id),"status":200}"#)
        broker.receive(#"{"type":"error","id":\#(id)}"#)

        XCTAssertEqual(task.events, ["response 200", "failure The local request failed"])
    }

    func testFailsARequestThePageCannotTake() {
        pageAccepts = false
        broker.receive(#"{"type":"ready"}"#)
        let task = FakeTask("capacitor://localhost/api/x")
        broker.start(task)

        XCTAssertEqual(task.events.first, "response 502")
        XCTAssertEqual(task.bodyText, "The page has no request handler")
    }

    func testFailsPendingRequestsOnReloadAndWaitsForTheNewPage() throws {
        let (first, _) = try startReady()
        broker.pageStarted()
        XCTAssertEqual(first.events.first, "response 502")
        XCTAssertEqual(first.bodyText, "The page reloaded before answering")

        let second = FakeTask("capacitor://localhost/api/b")
        broker.start(second)
        XCTAssertEqual(scripts.count, 1, "the reloaded page has not announced itself yet")

        broker.receive(#"{"type":"ready"}"#)
        let id = try XCTUnwrap(payloadOf(scripts[1])["id"] as? Int)
        broker.receive(#"{"type":"head","id":\#(id),"status":204}"#)
        broker.receive(#"{"type":"end","id":\#(id)}"#)
        XCTAssertEqual(second.events, ["response 204", "finish"])
    }

    func testTimesOutOnlyARequestStillWaitingForItsHead() throws {
        let (slow, _) = try startReady()
        let (answered, id) = try startReady()
        broker.receive(#"{"type":"head","id":\#(id),"status":200}"#)

        for timer in timers {
            timer()
        }

        XCTAssertEqual(slow.events.first, "response 504")
        XCTAssertEqual(slow.bodyText, "The local worker did not answer in time")
        XCTAssertEqual(answered.events, ["response 200"])
    }

    func testStopForgetsTheTaskSoItIsNeverCompleted() throws {
        let (task, id) = try startReady()

        XCTAssertTrue(broker.stop(id: task.id))
        XCTAssertFalse(broker.stop(id: task.id))
        broker.receive(#"{"type":"head","id":\#(id),"status":200}"#)
        broker.receive(#"{"type":"end","id":\#(id)}"#)
        broker.pageStarted()

        XCTAssertTrue(task.events.isEmpty)
    }

    func testRejectsStatusesASchemeTaskCannotCarry() throws {
        for status in [302, 99, 600] {
            let (task, id) = try startReady()
            broker.receive(#"{"type":"head","id":\#(id),"status":\#(status)}"#)

            XCTAssertEqual(task.events.first, "response 502")
            XCTAssertEqual(task.bodyText, "The local worker answered with status \(status)")
        }
    }

    func testIgnoresMessagesItCannotPlace() throws {
        let (task, id) = try startReady()
        broker.receive("not json")
        broker.receive(#"{"type":"head","id":999,"status":200}"#)
        broker.receive(#"{"type":"chunk","id":\#(id),"data":"\#(base64("early"))"}"#)
        broker.receive(#"{"type":"surprise","id":\#(id)}"#)

        XCTAssertEqual(logs, ["Malformed message from the page", "Unknown message type: surprise"])
        XCTAssertTrue(task.events.isEmpty, "a chunk before the head is dropped")
    }

    func testEscapesLineSeparatorsForTheScript() {
        XCTAssertEqual(RequestBroker.escapeLineSeparators("{\"url\":\"a\u{2028}b\u{2029}c\"}"),
                       "{\"url\":\"a\\u2028b\\u2029c\"}")
    }

    // MARK: - Helpers

    /// Starts a GET on a ready page and returns its task with the id the page would answer.
    private func startReady() throws -> (FakeTask, Int) {
        broker.receive(#"{"type":"ready"}"#)
        let task = FakeTask("capacitor://localhost/api/x")
        broker.start(task)
        let id = try XCTUnwrap(payloadOf(XCTUnwrap(scripts.last))["id"] as? Int)
        return (task, id)
    }

    private func payloadOf(_ script: String) throws -> [String: Any] {
        let start = try XCTUnwrap(script.range(of: "window.__triliumNativeRequest(", options: .backwards))
        let end = try XCTUnwrap(script.range(of: "), true) : false", options: .backwards))
        let json = String(script[start.upperBound..<end.lowerBound])
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    }

    private func base64(_ text: String) -> String {
        Data(text.utf8).base64EncodedString()
    }
}

/// Records every call a scheme task receives, in order.
private final class FakeTask: SchemeTask {
    let request: URLRequest
    private(set) var events: [String] = []
    private(set) var response: HTTPURLResponse?
    private var body = Data()

    var id: ObjectIdentifier { ObjectIdentifier(self) }
    var bodyText: String { String(decoding: body, as: UTF8.self) }

    init(_ url: String, method: String = "GET", headers: [String: String] = [:]) {
        var request = URLRequest(url: URL(string: url) ?? URL(fileURLWithPath: "/"))
        request.httpMethod = method
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        self.request = request
    }

    func didReceive(_ response: URLResponse) {
        self.response = response as? HTTPURLResponse
        events.append("response \(self.response?.statusCode ?? 0)")
    }

    func didReceive(_ data: Data) {
        body.append(data)
        events.append("data \(data.count) bytes")
    }

    func didFinish() {
        events.append("finish")
    }

    func didFailWithError(_ error: Error) {
        events.append("failure \(error.localizedDescription)")
    }
}
