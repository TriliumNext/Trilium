import type { CommandListenerData, EventData, EventNames } from "../../components/app_context.js";
import type NoteContext from "../../components/note_context.js";
import type BasicWidget from "../basic_widget.js";
import Container from "./container.js";
import { findScrollAnchor, restoreScrollAnchor, type ScrollAnchor } from "./scroll_anchor.js";
import "./scrolling_container.css";

const SCROLL_HOLD_TIMEOUT_MS = 10_000;
const SCROLL_STOP_DELAY_MS = 150;

export default class ScrollingContainer extends Container<BasicWidget> {

    private noteContext?: NoteContext;
    private scrollAnchor: ScrollAnchor | null = null;
    private pendingAnchorTimeout?: ReturnType<typeof setTimeout>;
    private resizeObserver?: ResizeObserver;
    private scrollListener?: AbortController;
    private scrollHold?: AbortController;

    constructor() {
        super();

        this.class("scrolling-container");
    }

    doRender() {
        super.doRender();
        this.keepScrollAnchorWhileHidden(this.$widget[0]);
    }

    /**
     * Puts the block at the top of the view back in place when the container is shown again: the
     * browser restores only `scrollTop`, which is stale if the width changed while it was hidden.
     */
    private keepScrollAnchorWhileHidden(container: HTMLElement) {
        const recordAnchor = () => {
            // A hidden container reads `scrollTop` as 0, so the recorded anchor stays.
            if (!container.getClientRects().length) return;
            this.scrollAnchor = container.scrollTop > 0
                ? findScrollAnchor(container, this.scrollAnchor?.element)
                : null;
        };

        // Recorded once the scroll stops, so that a scrolled frame does no layout reads of its own.
        this.scrollListener = new AbortController();
        const listenerOptions = { passive: true, signal: this.scrollListener.signal };
        if ("onscrollend" in HTMLElement.prototype) {
            container.addEventListener("scrollend", recordAnchor, listenerOptions);
        } else {
            // WebKit before Safari 26.2, which the iOS app still runs on, has no `scrollend`.
            container.addEventListener("scroll", () => {
                clearTimeout(this.pendingAnchorTimeout);
                this.pendingAnchorTimeout = setTimeout(recordAnchor, SCROLL_STOP_DELAY_MS);
            }, listenerOptions);
        }

        let wasHidden = false;
        this.resizeObserver = new ResizeObserver(([ entry ]) => {
            const isHidden = entry.contentRect.width === 0 && entry.contentRect.height === 0;
            if (isHidden) {
                wasHidden = true;
                return;
            }

            if (wasHidden && this.scrollAnchor) {
                restoreScrollAnchor(container, this.scrollAnchor);
            }
            wasHidden = false;
            recordAnchor();
        });
        this.resizeObserver.observe(container);
    }

    cleanup() {
        this.scrollListener?.abort();
        this.scrollHold?.abort();
        this.resizeObserver?.disconnect();
        clearTimeout(this.pendingAnchorTimeout);
    }

    setNoteContextEvent({ noteContext }: EventData<"setNoteContext">) {
        this.noteContext = noteContext;
    }

    async noteSwitchedEvent({ noteContext, notePath }: EventData<"noteSwitched">) {
        this.$widget.scrollTop(0);
    }

    async noteSwitchedAndActivatedEvent({ noteContext, notePath }: EventData<"noteSwitchedAndActivated">) {
        this.noteContext = noteContext;

        this.$widget.scrollTop(0);
    }

    async activeContextChangedEvent({ noteContext }: EventData<"activeContextChanged">) {
        this.noteContext = noteContext;
    }

    async handleEventInChildren<T extends EventNames>(name: T, data: EventData<T>) {
        if (name === "readOnlyTemporarilyDisabled" && this.noteContext && "noteContext" in data && this.noteContext.ntxId === data.noteContext?.ntxId) {
            this.holdScrollPosition(this.$widget[0]);
        }

        return super.handleEventInChildren(name, data);
    }

    /**
     * Keeps `scrollTop` while the note detail swaps between read-only and editable text. The
     * content stays collapsed until the other type widget has loaded and filled in, which takes
     * seconds when CKEditor loads for the first time, so the position is put back on every resize
     * of the content until the user scrolls, types or clicks.
     */
    private holdScrollPosition(container: HTMLElement) {
        this.scrollHold?.abort();
        const scrollTop = container.scrollTop;
        if (!scrollTop) return;

        const hold = new AbortController();
        this.scrollHold = hold;
        const observer = new ResizeObserver(() => {
            container.scrollTo({ top: scrollTop, behavior: "instant" });
        });
        for (const child of container.children) {
            observer.observe(child);
        }

        const release = () => hold.abort();
        const timeout = setTimeout(release, SCROLL_HOLD_TIMEOUT_MS);
        hold.signal.addEventListener("abort", () => {
            observer.disconnect();
            clearTimeout(timeout);
        });
        for (const type of [ "wheel", "touchstart", "pointerdown", "keydown" ]) {
            container.addEventListener(type, release, { passive: true, signal: hold.signal });
        }
    }

    scrollContainerToCommand({ position }: CommandListenerData<"scrollContainerTo">) {
        this.$widget.scrollTop(position);
    }
}
