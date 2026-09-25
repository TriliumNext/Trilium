import { Modal } from "bootstrap";
import $ from "jquery";
import { vi } from "vitest";

// Top level, not in a beforeAll: vi.mock is hoisted either way, and nesting it only makes the order lie.
vi.mock("../services/ws.js", mockWebsocket);
vi.mock("../services/server.js", mockServer);

injectGlobals();
survivePendingModalCallbacks();

function injectGlobals() {
    const uncheckedWindow = window as any;
    uncheckedWindow.$ = $;
    // some libraries (e.g. jquery.fancytree's ui-deps) expect the jQuery global, same as src/index.ts
    uncheckedWindow.jQuery = $;
    uncheckedWindow.WebSocket = () => {};
    uncheckedWindow.glob = {
        isMainWindow: true,
        baseApiUrl: "api/"
    };
}

/**
 * Keeps a disposed modal readable by the callbacks Bootstrap has already queued.
 *
 * `dispose()` nulls every property (twbs/bootstrap#37474) while the end of the opening is still
 * waiting on a `transitionend` that happy-dom never fires, so it runs against a disposed instance
 * some milliseconds later and throws where no test can catch it. A teardown that disposes a modal
 * is how a spec releases the focus trap, so leave values those callbacks can read.
 */
function survivePendingModalCallbacks() {
    const proto = Modal.prototype as unknown as Record<string, unknown>;
    const dispose = proto.dispose as () => void;

    proto.dispose = function (this: Record<string, unknown>) {
        dispose.call(this);
        this._config = { focus: false, backdrop: false, keyboard: false };
        this._element = document.createElement("noscript");
        this._dialog = this._element;
        this._focustrap = { activate() {}, deactivate() {} };
        this._backdrop = { show() {}, hide() {}, dispose() {} };
    };
}

function mockWebsocket() {
    function subscribeToMessages(_callback: (message: unknown) => void) {
        // Do nothing.
    }

    function unsubscribeToMessage(_callback: (message: unknown) => void) {
        // Do nothing.
    }

    // Awaited before reading back what the server wrote. No write happens under test.
    async function waitForMaxKnownEntityChangeId() {}

    return {
        default: {
            subscribeToMessages,
            waitForMaxKnownEntityChangeId
        },
        // consumers also import these as named exports (e.g. useNoteIds); leaving them out makes
        // the subscription effect throw, which silently skips every later effect of the component
        subscribeToMessages,
        unsubscribeToMessage,
        waitForMaxKnownEntityChangeId,
        // Code that reports a failure this way is usually in a catch block, so an undefined export
        // here throws over the error being handled and loses whatever the component did about it.
        logError(_message: string) {}
    };
}

function mockServer() {
    async function get(url: string) {
        if (url === "options") {
            return {};
        }

        if (url === "keyboard-actions") {
            return [];
        }

        // Asked for by the icon picker as it opens, to sort the icons a note already wears first.
        if (url === "other/icon-usage") {
            return { iconClassToCountMap: {} };
        }

        if (url === "tree") {
            return {
                branches: [],
                notes: [],
                attributes: []
            };
        }

        console.warn(`Unsupported GET to mocked server: ${url}`);
    }

    return {
        default: {
            get,

            // Froca's blob and attachment loads go through this variant; it only differs from `get`
            // in how it reports 404s, which the mock never produces, so share the same routing.
            getWithSilentNotFound: get,

            async post(url: string, data: object) {
                if (url === "tree/load") {
                    throw new Error(`A module tried to load from the server the following notes: ${((data as any).noteIds || []).join(",")}\nThis is not supported, use Froca mocking instead and ensure the note exist in the mock.`);
                }
            },

            // Widgets that persist as the user edits (attribute writes, view configs) reach for
            // these; without them the write rejects and surfaces as an unhandled rejection rather
            // than as whatever the test was actually asserting.
            async put(_url: string, _data?: object) {},
            async remove(_url: string) {}
        }
    };
}
