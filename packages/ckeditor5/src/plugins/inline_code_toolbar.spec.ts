import { describe, expect, it, vi } from "vitest";
import InlineCodeToolbar from "./inline_code_toolbar";

/**
 * #11077: the generic BalloonToolbar must not fight the inline-code toolbar
 * for the same selection. Clicking the boundary of inline code that carries
 * a link fired both toolbars' logic at once — the BalloonToolbar `show`, the
 * repository's removal of the inline-code balloon, and the removal's position
 * computation against a torn-down balloon stack
 * ("this._visibleStack is undefined"). The plugin now stops the generic
 * toolbar's `show` while the view selection sits inside an inline-code
 * element — the same suppression code_block_toolbar applies for code blocks.
 */
describe("InlineCodeToolbar BalloonToolbar suppression (#11077)", () => {
    type StopEvent = { stop: () => void; stopped: boolean };

    function makeEvent(): StopEvent {
        const evt: StopEvent = { stopped: false, stop: () => { evt.stopped = true; } };
        return evt;
    }

    function drive(positionParent: unknown): StopEvent {
        let handler: ((evt: StopEvent) => void) | undefined;
        const balloonToolbar = {};
        const repository = { register: vi.fn() };
        const editor = {
            plugins: {
                has: (name: string) => name === "BalloonToolbar",
                get: (name: string) =>
                    name === "BalloonToolbar" ? balloonToolbar : repository,
            },
            editing: {
                view: {
                    document: {
                        selection: {
                            getFirstPosition: () =>
                                positionParent === null ? null : { parent: positionParent },
                        },
                    },
                },
            },
            listenTo: (
                target: unknown,
                event: string,
                cb: (evt: StopEvent) => void,
            ) => {
                if (target === balloonToolbar && event === "show") {
                    handler = cb;
                }
            },
        };

        const plugin = Object.create(InlineCodeToolbar.prototype) as InlineCodeToolbar;
        (plugin as unknown as { editor: unknown }).editor = editor;
        plugin.afterInit();

        expect(typeof handler).toBe("function");
        const evt = makeEvent();
        handler!(evt);
        return evt;
    }

    it("stops the generic toolbar's show inside inline code", () => {
        const codeElement = {
            is: (type: string, name: string) =>
                type === "attributeElement" && name === "code",
            parent: null,
        };
        const evt = drive(codeElement);
        expect(evt.stopped).toBe(true);
    });

    it("lets the generic toolbar show outside inline code", () => {
        const paragraph = {
            is: () => false,
            parent: null,
        };
        const evt = drive(paragraph);
        expect(evt.stopped).toBe(false);
    });

    it("passes through when there is no view position", () => {
        const evt = drive(null);
        expect(evt.stopped).toBe(false);
    });
});
