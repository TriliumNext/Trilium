import $ from "jquery";
import { beforeAll, vi } from "vitest";

injectGlobals();

beforeAll(() => {
    vi.mock("../services/ws.js", mockWebsocket);
    vi.mock("../services/server.js", mockServer);
});

function injectGlobals() {
    const uncheckedWindow = window as any;
    uncheckedWindow.$ = $;
    // some libraries (e.g. jquery.fancytree's ui-deps) expect the jQuery global, same as src/index.ts
    uncheckedWindow.jQuery = $;
    uncheckedWindow.WebSocket = () => {};
    uncheckedWindow.glob = {
        isMainWindow: true
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
        unsubscribeToMessage
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
            }
        }
    };
}
