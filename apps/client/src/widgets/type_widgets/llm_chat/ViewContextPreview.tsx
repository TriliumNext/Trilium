import "./ViewContextPreview.css";

import { useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import ActionButton from "../../react/ActionButton.js";
import FormCheckbox from "../../react/FormCheckbox.js";
import { getLlmViewContext, useTriliumEvents } from "../../react/hooks.js";
import Popover from "../../react/Popover.js";

interface ViewContextPreviewProps {
    /** The note whose widget is asked what it shows. */
    noteId: string;
    included: boolean;
    onIncludedChange: (value: boolean) => void;
    disabled?: boolean;
}

/**
 * The chip beside the note-context toggle that says a widget's view report goes along with each
 * message, and opens on the exact text the model is given, with the switch to keep it back.
 * Rendered only while some pane showing the note has something to report.
 */
export default function ViewContextPreview({ noteId, included, onIncludedChange, disabled }: ViewContextPreviewProps) {
    const [ open, setOpen ] = useState(false);
    const anchorRef = useRef<HTMLSpanElement>(null);
    const [ , setTick ] = useState(0);
    // The report is read afresh on every render; these are the moments a pane starts or stops
    // having one, or starts showing a different note.
    useTriliumEvents([ "contextDataChanged", "noteSwitched", "activeContextChanged" ], () => setTick((tick) => tick + 1));

    const viewContext = getLlmViewContext(noteId);
    if (!viewContext) {
        return null;
    }

    return (
        <span ref={anchorRef} className="llm-chat-view-context-anchor">
            <ActionButton
                icon="bx bx-show"
                text={t(included ? "llm_chat.view_context_tooltip" : "llm_chat.view_context_tooltip_off", { label: viewContext.label })}
                active={included}
                onClick={() => setOpen((wasOpen) => !wasOpen)}
                disabled={disabled}
                className="llm-chat-view-context"
            />
            {open && (
                <Popover
                    className="llm-chat-view-context-popover"
                    placement="top"
                    getAnchorRect={() => anchorRef.current?.getBoundingClientRect() ?? new DOMRect()}
                    updateKey={viewContext.text}
                    onDismiss={() => setOpen(false)}
                >
                    <div className="llm-chat-view-context-header">
                        <strong>{t("llm_chat.view_context_title")}</strong>
                        <span className="llm-chat-view-context-label">{viewContext.label}</span>
                    </div>
                    <pre className="llm-chat-view-context-text">{viewContext.text}</pre>
                    <FormCheckbox
                        label={t("llm_chat.view_context_include")}
                        currentValue={included}
                        onChange={onIncludedChange}
                    />
                </Popover>
            )}
        </span>
    );
}
