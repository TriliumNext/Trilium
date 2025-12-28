import type { CommandListenerData, EventData, EventNames } from "../../components/app_context.js";
import type NoteContext from "../../components/note_context.js";
import type BasicWidget from "../basic_widget.js";
import Container from "./container.js";
import "./scrolling_container.css";

export default class ScrollingContainer extends Container<BasicWidget> {

    private noteContext?: NoteContext;

    constructor() {
        super();

        this.class("scrolling-container");
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
