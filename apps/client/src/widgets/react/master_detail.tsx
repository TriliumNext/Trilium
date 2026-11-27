import "./master_detail.css";
import "./slide_animations.css";

import clsx from "clsx";
import { ComponentChildren, createContext, RefObject } from "preact";
import { useCallback, useContext, useEffect, useRef, useState } from "preact/hooks";

import { onSystemBack } from "../../services/system_back";
import utils, { STACKED_TREE_LAYOUT } from "../../services/utils";
import ActionButton from "./ActionButton";
import { useMediaQuery, useSlide } from "./hooks/dom";
import MasterDetailHeader from "./MasterDetailHeader";
import Modal, { ModalProps } from "./Modal";

/**
 * The flow a dialog that pairs a list with a detail takes on a screen too narrow to hold both: one at a
 * time, the detail sliding in over the list and a way back in its header. Everything a dialog needs for
 * it lives here — the state and the classes ({@link useMobileMasterDetail}), the two panes
 * ({@link MasterPane}, {@link DetailPane}) and their styling (master_detail.css), with the header in
 * MasterDetailHeader.tsx — so that three dialogs do not each carry their own copy of the same slide.
 */

export interface MobileMasterDetail {
    /** True on narrow mobile viewports where the list and detail collapse into a master-detail flow. */
    isMasterDetail: boolean;
    /** Which half of the master-detail flow is currently visible. */
    mobileView: "list" | "page";
    /** Switch between the two views with a slide animation. */
    switchMobileView: (view: "list" | "page") => void;
    /** Set the view directly without animating (e.g. when (re)opening the dialog). */
    resetMobileView: (view: "list" | "page") => void;
}

/**
 * Drives the mobile master-detail flow: it tracks which pane is visible, animates the slide between
 * them, and toggles the corresponding classes on the modal element (`mobile-master-detail`,
 * `mobile-view-{list,page}`, `mobile-transition-to-{list,page}`), which master_detail.css lays out and
 * slides. The dialog's own stylesheet is left with whatever is particular to its panes.
 */
export function useMobileMasterDetail(modalRef: RefObject<HTMLElement | null>): MobileMasterDetail {
    const [ mobileView, setMobileView ] = useState<"list" | "page">("list");
    const isMobile = utils.isMobile();
    // A phone, by the breakpoint that also stacks the note tree; a tablet keeps both panes side by side.
    const isPhone = useMediaQuery(STACKED_TREE_LAYOUT);
    const isMasterDetail = isMobile && isPhone;
    /** Whether the next change of view slides: a switch does, a reset does not. */
    const slideNext = useRef(false);
    // Outside the master-detail flow both panes are on show, and there is nothing to slide between.
    const slide = useSlide(mobileView, isMasterDetail && slideNext.current);
    // While set, both panes stay rendered so the outgoing one can slide away as the incoming one slides in.
    const mobileTransition = slide.from === undefined ? null : mobileView === "page" ? "to-page" : "to-list";

    const switchMobileView = useCallback((view: "list" | "page") => {
        slideNext.current = true;
        setMobileView(view);
    }, []);

    const { settle } = slide;
    const resetMobileView = useCallback((view: "list" | "page") => {
        slideNext.current = false;
        setMobileView(view);
        settle();
    }, [ settle ]);

    // Bootstrap adds its own classes (e.g. `show`) to the modal element at runtime, so the className
    // prop must stay static; toggle the mobile view classes directly on the element instead.
    useEffect(() => {
        modalRef.current?.classList.toggle("mobile-master-detail", isMasterDetail);
        modalRef.current?.classList.toggle("mobile-view-list", mobileView === "list");
        modalRef.current?.classList.toggle("mobile-view-page", mobileView === "page");
        modalRef.current?.classList.toggle("mobile-transition-to-list", mobileTransition === "to-list");
        modalRef.current?.classList.toggle("mobile-transition-to-page", mobileTransition === "to-page");
    }, [ isMasterDetail, mobileView, mobileTransition ]);

    // The slide's end bubbles up from the panes.
    const { onAnimationEnd } = slide;
    useEffect(() => {
        const modalElement = modalRef.current;
        if (!modalElement) return;
        modalElement.addEventListener("animationend", onAnimationEnd);
        return () => modalElement.removeEventListener("animationend", onAnimationEnd);
    }, [ onAnimationEnd ]);

    return { isMasterDetail, mobileView, switchMobileView, resetMobileView };
}

interface PaneProps {
    /** The dialog's own class for the pane, for whatever is particular to what is in it. */
    className?: string;
    children: ComponentChildren;
}

/** The list half of the flow. Rendered inside the modal body, the Modal sidebar being unused there. */
export function MasterPane({ className, children }: PaneProps) {
    return <div class={clsx("tn-master-pane", className)}>{children}</div>;
}

/** The half the list leads to, which slides in over it. */
export function DetailPane({ className, children }: PaneProps) {
    return <div class={clsx("tn-detail-pane", className)}>{children}</div>;
}

interface MasterDetailState {
    /** Whether the host is showing one pane at a time, with the other sliding in over it. */
    isMasterDetail: boolean;
    /**
     * Announces the page being shown to the host, so that it can head it and slide to it: its title,
     * and how to leave it. A `null` title means the list is what is on show.
     */
    showPage: (title: string | null, close: () => void) => void;
}

const MasterDetailContext = createContext<MasterDetailState>({
    isMasterDetail: false,
    showPage: () => {}
});

/** What a component nested in a master-detail modal knows of the flow it is part of. */
export function useMasterDetail() {
    return useContext(MasterDetailContext);
}

/**
 * Hands the page a component is showing to the master-detail host around it — the host heads it with the
 * title and slides to it, and its back button calls `close`. Outside such a host this does nothing, so a
 * component that can be shown in either place needs no second version of itself.
 */
export function useMasterDetailPage(title: string | null, close: () => void) {
    const { showPage } = useMasterDetail();
    // Read at press time rather than captured: what closing the page means changes as it is edited.
    const closeRef = useRef(close);
    closeRef.current = close;

    useEffect(() => showPage(title, () => closeRef.current()), [ title, showPage ]);
}

/**
 * A modal whose contents are a master-detail flow: it drives the flow, heads the page on show with a way
 * back, and lets whatever is inside it announce that page ({@link useMasterDetailPage}) rather than
 * having to be handed down to the pieces that draw it.
 */
export function MasterDetailModal({ backTitle, listIcon, listActions, children, ...modalProps }: ModalProps & {
    backTitle: string;
    listIcon?: string;
    listActions?: ComponentChildren;
}) {
    const modalRef = useRef<HTMLDivElement>(null);
    const [ page, setPage ] = useState<{ title: string; close: () => void } | null>(null);
    const { isMasterDetail, mobileView, switchMobileView, resetMobileView } = useMobileMasterDetail(modalRef);

    const showPage = useCallback((title: string | null, close: () => void) => {
        // Whatever was announced last, `close` included: two pages of the same name are still two pages,
        // and holding on to the first one's would be closing something else than what is on show.
        setPage(title === null ? null : { title, close });
        switchMobileView(title === null ? "list" : "page");
    }, [ switchMobileView ]);

    // Opens on the list, whatever page a previous show was left on. Hiding closes the page, so that a
    // modal kept in the DOM (`keepInDom`) leaves no page for the system back gesture to act on.
    const pageRef = useRef(page);
    pageRef.current = page;
    const wasShown = useRef(false);
    useEffect(() => {
        if (modalProps.show) {
            resetMobileView("list");
        } else if (wasShown.current) {
            pageRef.current?.close();
        }
        wasShown.current = modalProps.show;
    }, [ modalProps.show, resetMobileView ]);

    return (
        <Modal
            {...modalProps}
            modalRef={modalRef}
            header={isMasterDetail ? (
                <MasterDetailHeader
                    inPage={mobileView === "page"}
                    onBack={() => page?.close()}
                    backTitle={backTitle}
                    pageTitle={page?.title}
                    listTitle={modalProps.title}
                    listIcon={listIcon}
                    listActions={listActions}
                />
            ) : modalProps.header}
        >
            <MasterDetailContext.Provider value={{ isMasterDetail, showPage }}>
                {children}
            </MasterDetailContext.Provider>
        </Modal>
    );
}
