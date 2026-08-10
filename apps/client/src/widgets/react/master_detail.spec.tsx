import { type ComponentChildren, type RefObject, render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    isMobile: vi.fn(() => true),
    windowWidth: 500,
    /** The header the modal stub was handed, so the flow's own header can be asserted on. */
    modalHeader: undefined as ComponentChildren
}));

vi.mock("../../services/utils", async (importActual) => {
    const actual = await importActual<typeof import("../../services/utils")>();
    return { ...actual, default: { ...actual.default, isMobile: mocks.isMobile } };
});

vi.mock("./hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./hooks")>()),
    useWindowSize: () => ({ windowWidth: mocks.windowWidth, windowHeight: 800 })
}));

// Bootstrap drives the real modal; what matters here is the header the flow hands it.
interface ModalStubProps {
    header?: ComponentChildren;
    children?: ComponentChildren;
    modalRef?: RefObject<HTMLDivElement>;
}

vi.mock("./Modal", () => ({
    default: ({ header, children, modalRef }: ModalStubProps) => {
        mocks.modalHeader = header;
        return <div ref={modalRef} className="modal-stub">{header}{children}</div>;
    }
}));

vi.mock("./ActionButton", () => ({
    default: ({ icon, text, onClick }: { icon: string, text: string, onClick?: () => void }) => (
        <button type="button" className={`action-stub ${icon}`} title={text} onClick={onClick} />
    )
}));

import {
    DetailPane,
    MasterDetailHeader,
    MasterDetailModal,
    MasterPane,
    type MobileMasterDetail,
    useMasterDetail,
    useMasterDetailPage,
    useMobileMasterDetail
} from "./master_detail";

let container: HTMLDivElement;
/** The flow's API, as the host component last saw it. */
let flow: MobileMasterDetail | undefined;

function Host() {
    const modalRef = useRef<HTMLDivElement>(null);
    flow = useMobileMasterDetail(modalRef);
    return <div ref={modalRef} className="host" />;
}

function host() {
    const el = container.querySelector<HTMLElement>(".host");
    expect(el).not.toBeNull();
    return el;
}

/** The classes master_detail.css lays the flow out with, in the order the hook sets them. */
function flowClasses() {
    return [ ...(host()?.classList ?? []) ].filter((name) => name !== "host");
}

/** Mounts afresh: the flow reads the viewport as it is when it mounts, so each case gets its own. */
function renderHost() {
    act(() => render(null, container));
    act(() => render(<Host />, container));
}

function endSlide() {
    act(() => {
        host()?.dispatchEvent(Object.assign(new Event("animationend", { bubbles: true }), {
            animationName: "tn-master-detail-slide-in"
        }));
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMobile.mockReturnValue(true);
    mocks.windowWidth = 500;
    mocks.modalHeader = undefined;
    flow = undefined;
    container = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, container);
    container.remove();
    document.body.classList.remove("motion-disabled");
});

describe("useMobileMasterDetail", () => {
    it("collapses to one pane at a time only on a narrow mobile viewport", () => {
        renderHost();
        expect(flow?.isMasterDetail).toBe(true);
        expect(flowClasses()).toContain("mobile-master-detail");

        // A tablet is wide enough to hold both panes, and so is any desktop window.
        mocks.windowWidth = 900;
        renderHost();
        expect(flow?.isMasterDetail).toBe(false);
        expect(flowClasses()).not.toContain("mobile-master-detail");

        mocks.windowWidth = 500;
        mocks.isMobile.mockReturnValue(false);
        renderHost();
        expect(flow?.isMasterDetail).toBe(false);
    });

    it("slides between the panes, holding both on screen until the slide finishes", () => {
        renderHost();
        expect(flowClasses()).toContain("mobile-view-list");

        act(() => flow?.switchMobileView("page"));
        expect(flowClasses()).toEqual(
            expect.arrayContaining([ "mobile-view-page", "mobile-transition-to-page" ]));

        endSlide();
        expect(flowClasses()).toContain("mobile-view-page");
        expect(flowClasses()).not.toContain("mobile-transition-to-page");

        act(() => flow?.switchMobileView("list"));
        expect(flowClasses()).toContain("mobile-transition-to-list");
        endSlide();
        expect(flowClasses()).not.toContain("mobile-transition-to-list");

        // An animation of something else inside the panes must not cut a slide short.
        act(() => flow?.switchMobileView("page"));
        act(() => {
            host()?.dispatchEvent(Object.assign(new Event("animationend", { bubbles: true }), {
                animationName: "fade-in"
            }));
        });
        expect(flowClasses()).toContain("mobile-transition-to-page");
    });

    it("switches without a slide where there would be nothing to end it", () => {
        // Nothing animates with motion off, so there would be no animationend to clear the class.
        document.body.classList.add("motion-disabled");
        renderHost();
        act(() => flow?.switchMobileView("page"));
        expect(flowClasses()).toContain("mobile-view-page");
        expect(flowClasses()).not.toContain("mobile-transition-to-page");
        document.body.classList.remove("motion-disabled");

        // Side by side, both panes are on show: there is nothing to slide between.
        mocks.windowWidth = 900;
        renderHost();
        act(() => flow?.switchMobileView("page"));
        expect(flowClasses()).not.toContain("mobile-transition-to-page");
    });

    it("stays put when asked for the pane already on show, and resets without animating", () => {
        renderHost();
        act(() => flow?.switchMobileView("list"));
        expect(flowClasses()).not.toContain("mobile-transition-to-list");

        act(() => flow?.switchMobileView("page"));
        act(() => flow?.resetMobileView("list"));
        expect(flowClasses()).toContain("mobile-view-list");
        expect(flowClasses()).not.toContain("mobile-transition-to-list");
    });
});

describe("MasterDetailHeader", () => {
    it("heads the list with its own name and actions, and a page with the way back", () => {
        const onBack = vi.fn();
        const header = (inPage: boolean) => (
            <MasterDetailHeader
                inPage={inPage}
                onBack={onBack}
                backTitle="back to the list"
                pageTitle="Page"
                listTitle="Dialog"
                listIcon="bx bx-cog"
                listActions={<button type="button" className="list-action" />}
            />
        );

        act(() => render(header(false), container));
        expect(container.querySelector(".tn-master-detail-title")?.textContent).toBe("Dialog");
        expect(container.querySelector(".tn-master-detail-icon")?.className).toContain("bx-cog");
        expect(container.querySelector(".list-action")).not.toBeNull();
        expect(container.querySelector(".action-stub")).toBeNull();

        act(() => render(header(true), container));
        expect(container.querySelector(".tn-master-detail-title")?.textContent).toBe("Page");
        // The dialog's own actions belong to the list, not to one page of it.
        expect(container.querySelector(".list-action")).toBeNull();

        container.querySelector<HTMLElement>(".action-stub")?.click();
        expect(onBack).toHaveBeenCalled();
    });

    it("takes no room for a title a page carries itself, nor for a missing icon", () => {
        act(() => render(
            <MasterDetailHeader inPage onBack={() => {}} backTitle="back" listTitle="Dialog" />,
            container
        ));

        expect(container.querySelector(".tn-master-detail-title")).toBeNull();
        expect(container.querySelector(".tn-master-detail-icon")).toBeNull();
    });
});

describe("MasterDetailModal", () => {
    /** A component deep inside the modal, announcing whatever page it is showing. */
    function Page({ title, close }: { title: string | null, close: () => void }) {
        const { isMasterDetail } = useMasterDetail();
        useMasterDetailPage(title, close);
        return <div className="page-stub" data-in-flow={String(isMasterDetail)} />;
    }

    function renderModal(title: string | null, close: () => void, show = true) {
        act(() => render(
            <MasterDetailModal
                backTitle="back to the list"
                title="Dialog"
                listIcon="bx bx-cog"
                show={show}
                className="host-dialog"
                size="lg"
                onHidden={() => {}}
            >
                <Page title={title} close={close} />
            </MasterDetailModal>,
            container
        ));
    }

    it("heads and slides to the page a nested component announces, and back out of it", () => {
        const close = vi.fn();
        // However a previous show was left, the dialog opens on the list.
        renderModal(null, close);
        expect(container.querySelector(".tn-master-detail-title")?.textContent).toBe("Dialog");

        renderModal("Attributes", close);

        expect(container.querySelector<HTMLElement>(".page-stub")?.dataset.inFlow).toBe("true");
        expect(container.querySelector(".tn-master-detail-title")?.textContent).toBe("Attributes");
        expect(container.querySelector<HTMLElement>(".modal-stub")?.classList.contains("mobile-view-page"))
            .toBe(true);

        container.querySelector<HTMLElement>(".action-stub")?.click();
        expect(close).toHaveBeenCalled();

        // Announcing no page at all is what returns the flow to the list.
        renderModal(null, close);
        expect(container.querySelector(".tn-master-detail-title")?.textContent).toBe("Dialog");
        expect(container.querySelector<HTMLElement>(".modal-stub")?.classList.contains("mobile-view-list"))
            .toBe(true);
    });

    it("leaves the header to the dialog where both panes fit side by side", () => {
        mocks.windowWidth = 900;
        renderModal("Attributes", vi.fn());

        expect(container.querySelector<HTMLElement>(".page-stub")?.dataset.inFlow).toBe("false");
        expect(container.querySelector(".tn-master-detail-header")).toBeNull();
        expect(mocks.modalHeader).toBeUndefined();
    });

    it("holds the pane it was left on while closed, resetting only as it opens", () => {
        const close = vi.fn();
        renderModal("Attributes", close, false);

        // Closed, so nothing resets it: the announced page is still what the header names.
        expect(container.querySelector(".tn-master-detail-title")?.textContent).toBe("Attributes");
    });

    it("wraps each half in the class master_detail.css lays it out with", () => {
        act(() => render(
            <>
                <MasterPane className="dialog-list"><span className="in-list" /></MasterPane>
                <DetailPane className="dialog-page"><span className="in-page" /></DetailPane>
            </>,
            container
        ));

        expect(container.querySelector(".tn-master-pane.dialog-list > .in-list")).not.toBeNull();
        expect(container.querySelector(".tn-detail-pane.dialog-page > .in-page")).not.toBeNull();
    });
});
