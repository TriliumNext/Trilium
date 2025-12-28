import { beforeAll, vi } from "vitest";
import $ from "jquery";

injectGlobals();

beforeAll(() => {
    vi.mock("../services/ws.js", mockWebsocket);
    vi.mock("../services/server.js", mockServer);
});

function injectGlobals() {
    const uncheckedWindow = window as any;
    uncheckedWindow.$ = $;
    uncheckedWindow.WebSocket = () => {};
    uncheckedWindow.glob = {
        isMainWindow: true
    };
}

function mockWebsocket() {
    return {
        default: {
            subscribeToMessages(callback: (message: unknown) => void) {
                // Do nothing.
            }
        }
    }
}

function mockServer() {
    return {
        default: {
            async get(url: string) {
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
                    }
                }

                console.warn(`Unsupported GET to mocked server: ${url}`);
            },

            async post(url: string, data: object) {
                if (url === "tree/load") {
                    throw new Error(`A module tried to load from the server the following notes: ${((data as any).noteIds || []).join(",")}\nThis is not supported, use Froca mocking instead and ensure the note exist in the mock.`)
                }
            }
        }
    };
}
