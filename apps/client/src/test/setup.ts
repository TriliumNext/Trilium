import $ from "jquery";
import { vi } from "vitest";

// Top level, not in a beforeAll: vi.mock is hoisted either way, and nesting it only makes the order lie.
vi.mock("../services/ws.js", mockWebsocket);
vi.mock("../services/server.js", mockServer);

injectGlobals();

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

function mockWebsocket() {
    function subscribeToMessages(_callback: (message: unknown) => void) {
        // Do nothing.
    }

    function unsubscribeToMessage(_callback: (message: unknown) => void) {
        // Do nothing.
    }

    return {
        default: {
            subscribeToMessages
        },
        // consumers also import these as named exports (e.g. useNoteIds); leaving them out makes
        // the subscription effect throw, which silently skips every later effect of the component
        subscribeToMessages,
        unsubscribeToMessage,
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

        if (url === "tree") {
            return {
                branches: [],
                notes: [],
                attributes: []
            };
        }

        console.warn(`Unsupported GET to mocked server: ${url}`);
    }

    async function post(url: string, data: object) {
        if (url === "tree/load") {
            throw new Error(`A module tried to load from the server the following notes: ${((data as any).noteIds || []).join(",")}\nThis is not supported, use Froca mocking instead and ensure the note exist in the mock.`);
        }
    }

    return {
        default: {
            get,

            // Froca's blob and attachment loads go through this variant; it only differs from `get`
            // in how it reports 404s, which the mock never produces, so share the same routing.
            getWithSilentNotFound: get,

            // A backend script run goes through this variant so its failure is reported against the
            // note rather than as a request that went wrong; it differs from `post` only in how it
            // reports a 500, which the mock never produces.
            postWithSilentInternalServerError: (url: string, data: object) => post(url, data),

            post,

            // Widgets that persist as the user edits (attribute writes, view configs) reach for
            // these; without them the write rejects and surfaces as an unhandled rejection rather
            // than as whatever the test was actually asserting.
            async put(_url: string, _data?: object) {},
            async remove(_url: string) {}
        }
    };
}
