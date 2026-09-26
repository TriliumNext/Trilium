import "./ToolCallCard.css";

import { Trans } from "react-i18next";

import appContext from "../../../components/app_context.js";
import { t } from "../../../services/i18n.js";
import ActionButton from "../../react/ActionButton.js";
import { NewNoteLink } from "../../react/NoteLink.js";
import { EditNoteContentDiff, isSmallEdit, parseNoteContentEdits } from "./EditNoteContentDiff.js";
import { ExpandableSection } from "./ExpandableCard.js";
import type { ToolCall } from "./llm_chat_types.js";
import { getToolCallView } from "./ToolCallViews.js";

interface ToolCallContext {
    /** The primary note the tool operates on or created. */
    noteId: string | null;
    /** The parent note, shown as "in <parent>" for creation tools. */
    parentNoteId: string | null;
    /** Plain-text detail (e.g. skill name, search query) when no note ref is available. */
    detailText: string | null;
}

/** Try to extract a noteId from the tool call's result JSON. */
function parseResultNoteId(toolCall: ToolCall): string | null {
    if (!toolCall.result) return null;
    try {
        const result = typeof toolCall.result === "string"
            ? JSON.parse(toolCall.result)
            : toolCall.result;
        return result?.noteId || null;
    } catch {
        return null;
    }
}

/** Extract contextual info from a tool call for display in the summary. */
function getToolCallContext(toolCall: ToolCall): ToolCallContext {
    const input = toolCall.input;
    const parentNoteId = (input?.parentNoteId as string) || null;

    // For creation tools, the created note ID is in the result.
    if (parentNoteId) {
        const createdNoteId = parseResultNoteId(toolCall);
        if (createdNoteId) {
            return { noteId: createdNoteId, parentNoteId, detailText: null };
        }
    }

    const noteId = (input?.noteId as string) || parentNoteId || parseResultNoteId(toolCall);
    if (noteId) {
        return { noteId, parentNoteId: null, detailText: null };
    }

    const detailText = (input?.name ?? input?.query ?? input?.url) as string | undefined;
    return { noteId: null, parentNoteId: null, detailText: detailText || null };
}

function toolNameIcon(toolName: string): string {
    if (toolName.includes("search")) return "bx bx-search";
    // Specific note-content tools, checked before the generic "note" match below.
    if (toolName === "set_note_content" || toolName === "update_note_content") return "bx bx-sync";
    if (toolName === "edit_note_content") return "bx bx-pencil";
    if (toolName.includes("note")) return "bx bx-note";
    if (toolName.includes("attribute")) return "bx bx-purchase-tag";
    if (toolName.includes("attachment")) return "bx bx-paperclip";
    if (toolName.includes("skill")) return "bx bx-book-open";
    if (toolName.includes("web")) return "bx bx-globe";
    return "bx bx-wrench";
}

function toolCallIcon(toolCall: ToolCall): string {
    if (toolCall.isError) return "bx bx-error-circle";
    if (!toolCall.result) return "bx bx-loader-alt bx-spin";
    return toolNameIcon(toolCall.toolName);
}

/** The message of a failed call: the `error` field of a JSON result, or else the whole result. */
function getErrorMessage(result: string): string {
    try {
        const parsed: unknown = JSON.parse(result);
        if (typeof parsed === "object" && parsed !== null && "error" in parsed && typeof parsed.error === "string") {
            return parsed.error;
        }
    } catch {
        // A result that is not JSON is the message itself.
    }
    return result;
}

/** Build the label content for a tool call section. */
function ToolCallLabel({ toolCall, summary }: { toolCall: ToolCall; summary?: string }) {
    const { noteId: refNoteId, parentNoteId: refParentId, detailText } = getToolCallContext(toolCall);
    const hasError = toolCall.isError;

    return (
        <>
            <span className="llm-chat-tool-call-name">{t(`llm.tools.${toolCall.toolName}`, { defaultValue: toolCall.toolName })}</span>
            {detailText && (
                <span className="llm-chat-tool-call-detail">{detailText}</span>
            )}
            {refNoteId && (
                <span className="llm-chat-tool-call-note-ref">
                    {refParentId ? (
                        <Trans
                            i18nKey="llm.tools.note_in_parent"
                            components={{
                                Note: <NewNoteLink notePath={refNoteId} showNoteIcon noPreview />,
                                Parent: <NewNoteLink notePath={refParentId} showNoteIcon noPreview />
                            } as any}
                        />
                    ) : (
                        <NewNoteLink notePath={refNoteId} showNoteIcon noPreview />
                    )}
                </span>
            )}
            {summary && <span className="llm-chat-tool-call-result-count">{summary}</span>}
            {hasError && <span className="llm-chat-tool-call-error-badge">{t("llm_chat.tool_error")}</span>}
        </>
    );
}

/**
 * A single tool call. It folds open only for what is worth reading inline: the input while it
 * streams, the diff of an `edit_note_content` call, why the call failed, or the view
 * `getToolCallView()` builds for the tools that have one. The raw input and
 * result are in the dialog the debug button opens.
 */
function ToolCallSection({ toolCall }: { toolCall: ToolCall }) {
    const hasError = toolCall.isError;
    const isStreamingInput = toolCall.inputStreaming !== undefined;

    // The partial JSON of a streaming input does not parse, so the diff waits for the whole input.
    const noteContentEdits = !isStreamingInput && toolCall.toolName === "edit_note_content"
        ? parseNoteContentEdits(toolCall.input?.edits)
        : null;
    const editedNoteId = typeof toolCall.input.noteId === "string" ? toolCall.input.noteId : undefined;
    const errorMessage = hasError && toolCall.result ? getErrorMessage(toolCall.result) : null;
    const view = isStreamingInput ? null : getToolCallView(toolCall);

    const className = `llm-chat-tool-call ${hasError ? "llm-chat-tool-call-error" : ""}`;
    const icon = toolCallIcon(toolCall);
    const label = <ToolCallLabel toolCall={toolCall} summary={view?.summary} />;
    const debugButton = <ToolCallDebugButton toolCall={toolCall} />;

    if (!isStreamingInput && !noteContentEdits && !errorMessage && !view?.body) {
        return (
            <div className={`expandable-line ${className}`}>
                <div className="expandable-line-header">
                    <span className={icon} />
                    <span className="expandable-section-label">{label}</span>
                    {debugButton}
                </div>
            </div>
        );
    }

    return (
        <ExpandableSection
            icon={icon}
            label={label}
            actions={debugButton}
            variant="line"
            className={className}
            open={noteContentEdits ? isSmallEdit(noteContentEdits) : isStreamingInput || undefined}
        >
            {isStreamingInput && <pre className="llm-chat-tool-call-streaming">{toolCall.inputStreaming}</pre>}
            {noteContentEdits && (
                <div className="llm-chat-tool-call-diff">
                    <EditNoteContentDiff noteId={editedNoteId} edits={noteContentEdits} />
                </div>
            )}
            {errorMessage && <p className="llm-chat-tool-call-error-message">{errorMessage}</p>}
            {view?.body}
        </ExpandableSection>
    );
}

/** Opens the raw input and result of a call in `ToolCallDetailsDialog`. */
function ToolCallDebugButton({ toolCall }: { toolCall: ToolCall }) {
    return (
        <ActionButton
            className="llm-chat-tool-call-debug"
            icon="bx bx-code-alt"
            text={t("llm_chat.show_tool_call_details")}
            onClick={(e) => {
                // Inside a summary, the click would also fold the line open or shut.
                e.preventDefault();
                void appContext.triggerEvent("showToolCallDetails", { toolCall });
            }}
        />
    );
}

/** Fold a section showing multiple invocations of the same tool under a single header. */
function ToolCallGroupSection({ toolCalls }: { toolCalls: ToolCall[] }) {
    const first = toolCalls[0];
    const anyPending = toolCalls.some(tc => !tc.result);
    const anyError = toolCalls.some(tc => tc.isError);

    const icon = anyPending ? "bx bx-loader-alt bx-spin" : toolNameIcon(first.toolName);
    const friendlyName = t(`llm.tools.${first.toolName}`, { defaultValue: first.toolName });
    const label = (
        <>
            <span className="llm-chat-tool-call-name">{friendlyName}</span>
            <span className="llm-chat-tool-call-count">×{toolCalls.length}</span>
            {anyError && <span className="llm-chat-tool-call-error-badge">{t("llm_chat.tool_error")}</span>}
        </>
    );

    return (
        <ExpandableSection variant="line" icon={icon} label={label} className="llm-chat-tool-call llm-chat-tool-call-group">
            {toolCalls.map((tc, idx) => (
                <ToolCallSection key={tc.id ?? idx} toolCall={tc} />
            ))}
        </ExpandableSection>
    );
}

/** Group consecutive tool calls that share the same tool name. Singletons pass through unchanged. */
function groupByToolName(toolCalls: ToolCall[]): Array<ToolCall | ToolCall[]> {
    const groups: Array<ToolCall | ToolCall[]> = [];
    for (const tc of toolCalls) {
        const last = groups[groups.length - 1];
        if (Array.isArray(last) && last[0].toolName === tc.toolName) {
            last.push(tc);
        } else if (last && !Array.isArray(last) && last.toolName === tc.toolName) {
            groups[groups.length - 1] = [last, tc];
        } else {
            groups.push(tc);
        }
    }
    return groups;
}

/** One or more sequential tool calls, each a disclosure line like a thought. */
export default function ToolCallCard({ toolCalls }: { toolCalls: ToolCall[] }) {
    const groups = groupByToolName(toolCalls);
    return (
        <div className="llm-chat-tool-calls">
            {groups.map((group, idx) => (
                Array.isArray(group)
                    ? <ToolCallGroupSection key={idx} toolCalls={group} />
                    : <ToolCallSection key={group.id ?? idx} toolCall={group} />
            ))}
        </div>
    );
}
