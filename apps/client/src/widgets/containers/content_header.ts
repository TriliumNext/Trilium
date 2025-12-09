import { EventData } from "../../components/app_context";
import BasicWidget from "../basic_widget";
import Container from "./container";
import NoteContext from "../../components/note_context";
import "./content_header.css";

export default class ContentHeader extends Container<BasicWidget> {

    noteContext?: NoteContext;
    thisElement?: HTMLElement;
    parentElement?: HTMLElement;
    resizeObserver: ResizeObserver;
    currentHeight: number = 0;
    currentSafeMargin: number = NaN;
    previousScrollTop: number = 0;
    isFloating: boolean = false;
    scrollThreshold: number = 10; // pixels before triggering float

    constructor() {
        super();

        this.class("content-header-widget");
        this.css("contain", "unset");
        this.resizeObserver = new ResizeObserver(this.onResize.bind(this));
    }

    setNoteContextEvent({ noteContext }: EventData<"setNoteContext">) {
        this.noteContext = noteContext;
        this.init();
    }

    init() {
        this.parentElement = this.parent?.$widget.get(0);
        if (!this.parentElement) {
            console.warn("No parent set for <ContentHeader>.");
            return;
        }

        this.thisElement = this.$widget.get(0)!;

        this.resizeObserver.observe(this.thisElement);
        this.parentElement.addEventListener("scroll", this.updateScrollState.bind(this), { passive: true });
    }

    updateScrollState() {
        const currentScrollTop = this.parentElement!.scrollTop;
        const isScrollingUp = currentScrollTop < this.previousScrollTop;
        const hasDropdownOpen = this.thisElement!.querySelector(".dropdown-menu.show") !== null;
        const hasMovedEnough = Math.abs(currentScrollTop - this.previousScrollTop) > this.scrollThreshold;

        if (hasDropdownOpen) {
            this.setFloating(true);
        } else if (currentScrollTop === 0) {
            this.setFloating(false);
        } else if (hasMovedEnough) {
            this.setFloating(isScrollingUp);
        }
        this.previousScrollTop = currentScrollTop;
        this.updateSafeMargin();
    }

    setFloating(shouldFloat: boolean) {
        if (shouldFloat !== this.isFloating) {
            this.isFloating = shouldFloat;

            if (shouldFloat) {
                this.$widget.addClass("floating");
            } else {
                this.$widget.removeClass("floating");
            }
        }
    }

    updateSafeMargin() {
        const parentEl = this.parentElement?.closest<HTMLDivElement>(".note-split");
        if (this.isFloating || this.parentElement!.scrollTop === 0) {
            parentEl!.style.setProperty("--content-header-height", `${this.currentHeight}px`);
        } else {
            parentEl!.style.removeProperty("--content-header-height");
        }
    }

    onResize(entries: ResizeObserverEntry[]) {
        for (const entry of entries) {
            if (entry.target === this.thisElement) {
                this.currentHeight = entry.contentRect.height;
                this.updateSafeMargin();
            }
        }
    }

}
