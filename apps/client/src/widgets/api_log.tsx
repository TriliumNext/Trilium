import { useEffect, useState } from "preact/hooks";
import "./api_log.css";
import { useNoteContext, useTriliumEvent } from "./react/hooks";
import ActionButton from "./react/ActionButton";
import { t } from "../services/i18n";

/**
 * Displays the messages that are logged by the current note via `api.log`, for frontend and backend scripts.
 */
export default function ApiLog() {
    const { note, noteId } = useNoteContext();
    const [ messages, setMessages ] = useState<string[]>();

    useTriliumEvent("apiLogMessages", ({ messages, noteId: eventNoteId }) => {
        if (eventNoteId !== noteId) return;
        setMessages(messages);
    });

    // Clear when navigating away.
    useEffect(() => setMessages(undefined), [ note ]);

    const isEnabled = note?.mime.startsWith("application/javascript;env=") && messages?.length;
    return (
        <div className={`api-log-widget ${!isEnabled ? "hidden-ext" : ""}`}>
            {isEnabled && (
                <>
                    <ActionButton
                        icon="bx bx-x"
                        className="close-api-log-button"
                        text={t("api_log.close")}
                        onClick={() => setMessages(undefined)}
                    />

                    <div className="api-log-container">
                        {messages.join("\n")}
                    </div>
                </>
            )}
        </div>
    )
}
