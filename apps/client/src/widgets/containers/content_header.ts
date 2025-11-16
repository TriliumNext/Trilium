import { EventData } from "../../components/app_context";
import BasicWidget from "../basic_widget";
import Container from "./container";
import NoteContext from "../../components/note_context";

export default class ContentHeader extends Container<BasicWidget> {
    
    noteContext?: NoteContext;
    thisElement?: HTMLElement;
    parentElement?: HTMLElement;
    resizeObserver: ResizeObserver;
    currentHeight: number = 0;
    currentSafeMargin: number = NaN;

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
        this.parentElement.addEventListener("scroll", this.updateSafeMargin.bind(this));
    }

    updateSafeMargin() {
        const newSafeMargin = Math.max(this.currentHeight - this.parentElement!.scrollTop, 0);

        if (newSafeMargin !== this.currentSafeMargin) {
            this.currentSafeMargin = newSafeMargin;

            this.triggerEvent("contentSafeMarginChanged", {
                top: newSafeMargin,
                noteContext: this.noteContext!
            });
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