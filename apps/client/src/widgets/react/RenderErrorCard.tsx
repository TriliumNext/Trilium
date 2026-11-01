import "./RenderErrorCard.css";

import { t } from "../../services/i18n";
import { rootCauseMessage } from "../../services/utils";
import { ExtendedAdmonition } from "./Admonition";
import NoteLink from "./NoteLink";

/**
 * The error card shown when a render/script note fails to run. Shared by the render-note
 * type widget and the (jQuery-based) content renderer so both surfaces look identical.
 *
 * The underlying error is surfaced via {@link rootCauseMessage}, so the bundler's
 * `Load of script note ... failed with:` wrapper never reaches the card — the failing
 * note is already identified by the reference link below the message.
 *
 * @param noteId the script note that failed, linked below the message so the user can jump to it.
 */
export default function RenderErrorCard({ error, noteId }: { error: unknown; noteId?: string }) {
    const { summary, details } = splitRenderError(rootCauseMessage(error));

    return (
        <ExtendedAdmonition
            className="render-error-card"
            type="caution"
            icon="bx bx-error-circle"
            title={t("render.error_title")}
            detailsLabel={t("render.error_show_details")}
            details={details && <pre>{details}</pre>}
        >
            <div className="render-error-message">{summary}</div>
            {noteId && (
                <div className="render-error-note">
                    <span className="render-error-note-label">{t("render.error_note_label")}</span>
                    <NoteLink notePath={noteId} showNoteIcon noPreview />
                </div>
            )}
        </ExtendedAdmonition>
    );
}

/**
 * Splits a raw render error into its first line, shown under the title as a headline,
 * and the remaining lines, revealed by the "show details" collapsible. The first line
 * is never repeated in the details; `details` is omitted when the error is a single line.
 */
function splitRenderError(error: string): { summary: string; details?: string } {
    const trimmed = error.trim();
    const newlineIndex = trimmed.indexOf("\n");
    if (newlineIndex < 0) {
        return { summary: trimmed };
    }
    return {
        summary: trimmed.slice(0, newlineIndex).trim(),
        details: trimmed.slice(newlineIndex + 1).trim() || undefined
    };
}
