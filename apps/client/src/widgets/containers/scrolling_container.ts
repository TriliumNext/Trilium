import type { CommandListenerData, EventData, EventNames } from "../../components/app_context.js";
import type NoteContext from "../../components/note_context.js";
import type BasicWidget from "../basic_widget.js";
import Container from "./container.js";
import { findScrollAnchor, restoreScrollAnchor, type ScrollAnchor } from "./scroll_anchor.js";
import "./scrolling_container.css";

export default class ScrollingContainer extends Container<BasicWidget> {

    private noteContext?: NoteContext;
    private scrollAnchor: ScrollAnchor | null = null;
    private pendingAnchorFrame: number | null = null;
    private resizeObserver?: ResizeObserver;

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
            this.scrollAnchor = container.scrollTop > 0 ? findScrollAnchor(container) : null;
        };

        container.addEventListener("scroll", () => {
            if (this.pendingAnchorFrame !== null) return;
            this.pendingAnchorFrame = requestAnimationFrame(() => {
                this.pendingAnchorFrame = null;
                recordAnchor();
            });
        }, { passive: true });

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
        this.resizeObserver?.disconnect();
        if (this.pendingAnchorFrame !== null) {
            cancelAnimationFrame(this.pendingAnchorFrame);
        }
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
            const scrollTop = this.$widget.scrollTop() ?? 0;

            const promise = super.handleEventInChildren(name, data);

            // there seems to be some asynchronicity, and we need to wait a bit before scrolling
            if (promise) {
                promise.then(() => setTimeout(() => this.$widget.scrollTop(scrollTop), 500));
            }

            return promise;
        } else {
            return super.handleEventInChildren(name, data);
        }
    }

    scrollContainerToCommand({ position }: CommandListenerData<"scrollContainerTo">) {
        this.$widget.scrollTop(position);
    }
}
