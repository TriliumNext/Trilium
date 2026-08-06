import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    openDialog: vi.fn(async (dialog: JQuery<HTMLElement>) => dialog),
    hide: vi.fn()
}));

vi.mock("../../services/dialog", () => ({
    openDialog: mocks.openDialog
}));

// Only what is reached while a dialog is raised: its own instance, and the tooltip class the
// shared hooks patch as they load (see hooks.tsx).
vi.mock("bootstrap", () => ({
    Modal: { getOrCreateInstance: () => ({ hide: mocks.hide }) },
    Tooltip: class {
        static getInstance() { return null; }
        dispose() {}
    },
    Dropdown: class {}
}));

vi.mock("../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../components/app_context", () => ({
    default: { triggerCommand: vi.fn() }
}));

vi.mock("./modal_focustrap", () => ({
    suspendModalFocusTraps: () => () => {}
}));

import Modal from "./Modal";

let container: HTMLDivElement;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.openDialog.mockClear();
    mocks.hide.mockClear();
});

afterEach(() => {
    render(null, container);
    container.remove();
});

/**
 * A dialog holding something that changes, so that a test can make it render again without
 * touching the dialog's own props — a keystroke into what it holds, as far as the dialog knows.
 */
function DialogWithTypedInto({ show, onHidden }: { show: boolean; onHidden(): void }) {
    const [ typed, setTyped ] = useState("");

    return (
        <Modal className="test-dialog" size="md" show={show} onHidden={onHidden}>
            {/* Named, the dialog bringing a close button of its own that stands before it. */}
            <button className="typed-into" onClick={() => setTyped(`${typed}x`)}>{typed}</button>
        </Modal>
    );
}

describe("Modal", () => {
    /**
     * The bug this pins: `modalRef.current` stood among the effect's dependencies, and a ref holds
     * nothing while the render that names them runs and the element by the time the effect does —
     * so the first re-render after mounting read as a change and opened the dialog a second time.
     * Opening closes whichever dialog is active, which by then is this one, and the dialog put
     * itself away on the first keystroke typed into it (the calendar's ghost, where it was found).
     */
    it("opens once, however often what it holds is typed into", async () => {
        const onHidden = vi.fn();

        await act(async () => {
            render(<DialogWithTypedInto show onHidden={onHidden} />, container);
        });
        expect(mocks.openDialog).toHaveBeenCalledTimes(1);

        // Twice over: the first re-render is the one the ref's settling used to spoil, and a second
        // says the dependencies have come to rest rather than merely changed the once.
        for (let press = 0; press < 2; press++) {
            await act(async () => {
                container.querySelector("button.typed-into")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            });
            // The press must actually have re-rendered the dialog, or the test proves nothing.
            expect(container.querySelector("button.typed-into")?.textContent).toBe("x".repeat(press + 1));
            expect(mocks.openDialog).toHaveBeenCalledTimes(1);
        }

        expect(mocks.hide).not.toHaveBeenCalled();
    });

    /**
     * A dialog taken out of the tree while still up leaves Bootstrap's backdrop on the body, there
     * being nothing left to take it away — a dimmed page that cannot be pressed. The calendar's
     * ghost goes exactly that way once its event is made.
     */
    it("puts itself down when it is taken out of the tree while still up", async () => {
        await act(async () => {
            render(<DialogWithTypedInto show onHidden={() => {}} />, container);
        });
        expect(mocks.hide).not.toHaveBeenCalled();

        await act(async () => { render(null, container); });
        expect(mocks.hide).toHaveBeenCalled();
    });

    it("opens a dialog that starts closed only once it is asked to show", async () => {
        const onHidden = vi.fn();

        await act(async () => {
            render(<DialogWithTypedInto show={false} onHidden={onHidden} />, container);
        });
        expect(mocks.openDialog).not.toHaveBeenCalled();

        await act(async () => {
            render(<DialogWithTypedInto show onHidden={onHidden} />, container);
        });
        expect(mocks.openDialog).toHaveBeenCalledTimes(1);
    });
});

/**
 * Bootstrap's modal events are native events, so they bubble, and a modal opened from inside another
 * one is a DOM descendant of it. The listeners must therefore answer only for their own element.
 */
describe("Modal stacking", () => {
    it("does not report a nested modal's closing as its own", () => {
        const { outer, inner, onOuterHidden, onInnerHidden } = renderNested();

        fire(inner, "hidden.bs.modal");

        expect(onInnerHidden).toHaveBeenCalledOnce();
        expect(onOuterHidden).not.toHaveBeenCalled();

        fire(outer, "hidden.bs.modal");
        expect(onOuterHidden).toHaveBeenCalledOnce();
    });

    it("does not report a nested modal's opening as its own", () => {
        const { inner, onOuterShown, onInnerShown } = renderNested();

        fire(inner, "shown.bs.modal");

        expect(onInnerShown).toHaveBeenCalledOnce();
        expect(onOuterShown).not.toHaveBeenCalled();
    });
});

function renderNested() {
    const onOuterHidden = vi.fn();
    const onInnerHidden = vi.fn();
    const onOuterShown = vi.fn();
    const onInnerShown = vi.fn();

    // Kept in the DOM while hidden, so the pair is nested without Bootstrap having to run.
    act(() => render(
        <Modal
            className="outer-modal"
            size="lg"
            title="Outer"
            show={false}
            keepInDom
            onHidden={onOuterHidden}
            onShown={onOuterShown}
        >
            <Modal
                className="inner-modal"
                size="sm"
                title="Inner"
                show={false}
                keepInDom
                stackable
                onHidden={onInnerHidden}
                onShown={onInnerShown}
            >
                inner body
            </Modal>
        </Modal>,
        container
    ));

    const outer = container.querySelector<HTMLElement>(".outer-modal");
    const inner = container.querySelector<HTMLElement>(".inner-modal");
    if (!outer || !inner) {
        throw new Error("both modals should be in the DOM");
    }
    expect(outer.contains(inner)).toBe(true);

    return { outer, inner, onOuterHidden, onInnerHidden, onOuterShown, onInnerShown };
}

function fire(element: HTMLElement, type: string) {
    act(() => {
        element.dispatchEvent(new CustomEvent(type, { bubbles: true }));
    });
}
