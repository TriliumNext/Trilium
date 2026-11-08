import "./ApiLog.css";

import { useEffect, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import ActionButton from "../../react/ActionButton";
import { useNoteProperty, useTriliumEvent } from "../../react/hooks";

/**
 * Displays the messages that a frontend or backend script note logs via `api.log()`, below its editor.
 */
export default function ApiLog({ note }: { note: FNote }) {
    const [ messages, setMessages ] = useState<string[]>();
    const mime = useNoteProperty(note, "mime");

    useTriliumEvent("apiLogMessages", ({ messages, noteId }) => {
        if (noteId === note.noteId) {
            setMessages(messages);
        }
    });

    // Clears the log when the editor moves to another note, but not on mount, which can run after a message arrives.
    useEffect(() => () => setMessages(undefined), [ note ]);

    if (!mime?.startsWith("application/javascript;env=") || !messages?.length) {
        return null;
    }

    return (
        <div className="api-log-widget">
            <ActionButton
                icon="bx bx-x"
                className="close-api-log-button"
                text={t("api_log.close")}
                onClick={() => setMessages(undefined)}
            />

            <div className="api-log-container">
                {messages.join("\n")}
            </div>
        </div>
    );
}
