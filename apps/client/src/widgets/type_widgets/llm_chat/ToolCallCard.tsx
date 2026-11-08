import "./ToolCallCard.css";

import type { LlmToolApprovalAnswer } from "@triliumnext/commons";
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { Trans } from "react-i18next";

import appContext from "../../../components/app_context.js";
import { t } from "../../../services/i18n.js";
import ActionButton from "../../react/ActionButton.js";
import Button, { SplitButton } from "../../react/Button.js";
import { FormListItem } from "../../react/FormList.js";
import Icon from "../../react/Icon.js";
import { NewNoteLink } from "../../react/NoteLink.js";
import { providerIcon } from "../options/llm/provider_icons.js";
import { EditNoteContentDiff, isSmallEdit, parseNoteContentEdits } from "./EditNoteContentDiff.js";
import { ExpandableSection } from "./ExpandableCard.js";
import { isFailedToolCall, type ToolCall, toolCallLabelKey } from "./llm_chat_types.js";
import { ExternalLink, getToolCallView, type ToolCallView } from "./ToolCallViews.js";

/**
 * Allows or denies a tool call of the running turn that waits for the user, or allows its tool for
 * the rest of the chat. Provided only around the reply that streams, since a saved reply has nothing
 * left to answer.
 */
export const ToolApprovalContext = createContext<
    ((toolCallId: string, approved: boolean, scope?: LlmToolApprovalAnswer["scope"]) => void) | undefined
>(undefined);

interface ToolCallContext {
    /** The primary note the tool operates on or created. */
    noteId: string | null;
    /** The parent note, shown as "in <parent>" for creation tools. */
    parentNoteId: string | null;
    /** Where `move_note` took the note: the new parent, and the old one when the result names it. */
    move?: { toNoteId: string; fromNoteId: string | null };
    /** The title of a note `delete_note` deleted, shown in place of a link to a note that is gone. */
    deletedTitle?: string;
    /** The title of the note `create_note` would create, in place of a link to a note not yet there. */
    createdTitle?: string;
    /** The subtree `search_notes` is confined to, unless it searches the whole tree. */
    scopeNoteId?: string;
    /** Plain-text detail (e.g. skill name, search query) when no note ref is available. */
    detailText: string | null;
}

/** Try to extract a string field from the tool call's result JSON. */
function parseResultField(toolCall: ToolCall, field: string): string | null {
    if (!toolCall.result) return null;
    try {
        const result = JSON.parse(toolCall.result);
        const value = result?.[field];
        return typeof value === "string" && value ? value : null;
    } catch {
        return null;
    }
}

/** Extract contextual info from a tool call for display in the summary. */
function getToolCallContext(toolCall: ToolCall): ToolCallContext {
    const input = toolCall.input;
    const parentNoteId = (input?.parentNoteId as string) || null;

    if (toolCall.toolName === "move_note"
            && typeof input?.noteId === "string" && typeof input.newParentNoteId === "string") {
        const move = {
            toNoteId: input.newParentNoteId,
            fromNoteId: parseResultField(toolCall, "oldParentNoteId")
        };
        return { noteId: input.noteId, parentNoteId: null, move, detailText: null };
    }

    const deletedTitle = toolCall.toolName === "delete_note"
        ? parseResultField(toolCall, "deletedTitle")
        : null;
    if (deletedTitle) {
        return { noteId: null, parentNoteId: null, deletedTitle, detailText: null };
    }

    // For creation tools, the created note ID is in the result.
    if (parentNoteId) {
        const createdNoteId = parseResultField(toolCall, "noteId");
        if (createdNoteId) {
            return { noteId: createdNoteId, parentNoteId, detailText: null };
        }
        const { title } = input;
        if (toolCall.toolName === "create_note" && !toolCall.result && typeof title === "string") {
            return { noteId: parentNoteId, parentNoteId: null, createdTitle: title, detailText: null };
        }
    }

    const noteId = (input?.noteId as string) || parentNoteId || parseResultField(toolCall, "noteId");
    if (noteId) {
        return { noteId, parentNoteId: null, detailText: null };
    }

    if (toolCall.toolName === "load_skill" && typeof input?.name === "string") {
        const skillTitle = t(`llm_chat.skills.${input.name}`, { defaultValue: input.name });
        return { noteId: null, parentNoteId: null, detailText: skillTitle };
    }

    const detailText = (input?.name ?? input?.query ?? input?.url) as string | undefined
        ?? readWebSearchAction(toolCall);
    const { ancestorNoteId } = input;
    // Searching under the root is the same as not narrowing the search at all.
    const scopeNoteId = toolCall.toolName === "search_notes" && typeof ancestorNoteId === "string"
        && ancestorNoteId !== "root" ? ancestorNoteId : undefined;
    return { noteId: null, parentNoteId: null, scopeNoteId, detailText: detailText || null };
}

/**
 * The query or page of an OpenAI `web_search` call, which takes no input and names what it did in its
 * result's `action` instead.
 */
function readWebSearchAction(toolCall: ToolCall): string | undefined {
    if (toolCall.toolName !== "web_search" || !toolCall.result) return undefined;
    try {
        const action = JSON.parse(toolCall.result)?.action;
        if (typeof action?.query === "string") return action.query;
        if (Array.isArray(action?.queries)) return action.queries.join("; ");
        return typeof action?.url === "string" ? action.url : undefined;
    } catch {
        return undefined;
    }
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

function toolCallIcon(toolCall: ToolCall) {
    if (toolCall.approval === "pending") return "bx bxs-hand";
    if (toolCall.approval === "declined") return "bx bx-block";
    if (isFailedToolCall(toolCall)) return "bx bx-error-circle";
    if (!toolCall.result) return "bx bx-loader-alt bx-spin";
    const searchProvider = readSearchProvider(toolCall);
    return searchProvider ? <SearchProviderIcon {...searchProvider} /> : toolNameIcon(toolCall.toolName);
}

/**
 * The search provider named in a `web_search` result, which a configured search provider's
 * search carries and the model's built-in search does not.
 */
function readSearchProvider(toolCall: ToolCall): { type: string; name: string } | undefined {
    if (toolCall.toolName !== "web_search" || !toolCall.result) return undefined;
    try {
        const { searchProvider } = JSON.parse(toolCall.result) ?? {};
        return typeof searchProvider?.type === "string" && typeof searchProvider.name === "string"
            ? { type: searchProvider.type, name: searchProvider.name }
            : undefined;
    } catch {
        return undefined;
    }
}

/** The logo of the search provider that ran a search, in place of the magnifier. */
function SearchProviderIcon({ type, name }: { type: string; name: string }) {
    return (
        <span className="llm-chat-tool-call-provider" title={t("llm_chat.searched_with", { name })}>
            <Icon icon={providerIcon(type)} />
        </span>
    );
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
function ToolCallLabel({ toolCall, view }: { toolCall: ToolCall; view: ToolCallView | null }) {
    const context = getToolCallContext(toolCall);
    const {
        noteId: refNoteId, parentNoteId: refParentId, move, deletedTitle, createdTitle, scopeNoteId,
        detailText
    } = context;
    const hasError = isFailedToolCall(toolCall);
    const detail = detailText && (
        <span className="llm-chat-tool-call-detail">
            {toolCall.toolName === "read_web_page" && /^https?:\/\//i.test(detailText)
                ? <ExternalLink url={detailText}>{detailText}</ExternalLink>
                : detailText}
        </span>
    );

    return (
        <>
            <span className="llm-chat-tool-call-name">{t(toolCallLabelKey(toolCall), { defaultValue: toolCall.toolName })}</span>
            {scopeNoteId && detail ? (
                <span className="llm-chat-tool-call-scope">
                    <Trans
                        i18nKey="llm.tools.search_in_subtree"
                        components={{
                            Query: detail,
                            Subtree: <NewNoteLink notePath={scopeNoteId} showNoteIcon noPreview />
                        } as any}
                    />
                </span>
            ) : detail}
            {view?.lead}
            {deletedTitle && <span className="llm-chat-tool-call-deleted-title">{deletedTitle}</span>}
            {refNoteId && (
                <span className="llm-chat-tool-call-note-ref">
                    <NoteRef noteId={refNoteId} parentNoteId={refParentId} move={move} createdTitle={createdTitle} />
                </span>
            )}
            {view?.trail}
            {view?.summary && <span className="llm-chat-tool-call-result-count">{view.summary}</span>}
            {toolCall.approval === "declined" && (
                <span className="llm-chat-tool-call-approval-badge">
                    {t("llm_chat.tool_approval_declined")}
                </span>
            )}
            {hasError && <span className="llm-chat-tool-call-error-badge">{t("llm_chat.tool_error")}</span>}
        </>
    );
}

/**
 * The notes a call worked on: the note alone, the note in its parent (named by its title while
 * `create_note` waits to create it), or where a move took it.
 */
function NoteRef({ noteId, parentNoteId, move, createdTitle }: {
    noteId: string;
    parentNoteId: string | null;
    move?: ToolCallContext["move"];
    createdTitle?: string;
}) {
    const link = (notePath: string) => <NewNoteLink notePath={notePath} showNoteIcon noPreview />;

    if (createdTitle !== undefined) {
        const components = {
            Note: <span className="llm-chat-tool-call-created-title">{createdTitle}</span>,
            Parent: link(noteId)
        };
        return <Trans i18nKey="llm.tools.note_in_parent" components={components as any} />;
    }
    if (move) {
        const components = move.fromNoteId
            ? { Note: link(noteId), From: link(move.fromNoteId), To: link(move.toNoteId) }
            : { Note: link(noteId), To: link(move.toNoteId) };
        const key = move.fromNoteId ? "llm.tools.note_moved_from" : "llm.tools.note_moved";
        return <Trans i18nKey={key} components={components as any} />;
    }
    if (parentNoteId) {
        const components = { Note: link(noteId), Parent: link(parentNoteId) };
        return <Trans i18nKey="llm.tools.note_in_parent" components={components as any} />;
    }
    return link(noteId);
}

/**
 * A single tool call. It folds open only for what is worth reading inline: the input while it
 * streams, the diff of an `edit_note_content` call, why the call failed, or the view
 * `getToolCallView()` builds for the tools that have one. The raw input and
 * result are in the dialog the debug button opens.
 *
 * A call that waits for the user is open, showing what it would do when it has a view,
 * with the buttons that allow or deny it below.
 */
function ToolCallSection({ toolCall }: { toolCall: ToolCall }) {
    const section = <ToolCallDisclosure toolCall={toolCall} />;
    if (toolCall.approval !== "pending") {
        return section;
    }
    return (
        <div className="llm-chat-tool-call-pending">
            {section}
            <ToolApprovalBar toolCall={toolCall} />
        </div>
    );
}

function ToolCallDisclosure({ toolCall }: { toolCall: ToolCall }) {
    const hasError = isFailedToolCall(toolCall);
    const isStreamingInput = toolCall.inputStreaming !== undefined;
    const isPending = toolCall.approval === "pending";

    // The partial JSON of a streaming input does not parse, so the diff waits for the whole input.
    const noteContentEdits = !isStreamingInput && toolCall.toolName === "edit_note_content"
        ? parseNoteContentEdits(toolCall.input?.edits)
        : null;
    const editedNoteId = typeof toolCall.input.noteId === "string" ? toolCall.input.noteId : undefined;
    const errorMessage = hasError && toolCall.result ? getErrorMessage(toolCall.result) : null;
    const view = isStreamingInput ? null : getToolCallView(toolCall);

    const className = `llm-chat-tool-call ${hasError ? "llm-chat-tool-call-error" : ""}`;
    const icon = toolCallIcon(toolCall);
    const label = <ToolCallLabel toolCall={toolCall} view={view} />;
    const debugButton = <ToolCallDebugButton toolCall={toolCall} />;
    const open = isPending
        || (noteContentEdits ? isSmallEdit(noteContentEdits) : isStreamingInput || undefined);

    if (!isStreamingInput && !noteContentEdits && !errorMessage && !view?.body) {
        return (
            <div className={`expandable-line ${className}`}>
                <div className="expandable-line-header">
                    {typeof icon === "string" ? <span className={icon} /> : icon}
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
            open={open}
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
    const anyError = toolCalls.some(isFailedToolCall);

    const searchProvider = readSearchProvider(first);
    const icon = anyPending ? "bx bx-loader-alt bx-spin"
        : searchProvider && toolCalls.every(tc => readSearchProvider(tc)?.type === searchProvider.type)
            ? <SearchProviderIcon {...searchProvider} />
            : toolNameIcon(first.toolName);
    const friendlyName = t(toolCallLabelKey(first), { defaultValue: first.toolName });
    const label = (
        <>
            <span className="llm-chat-tool-call-name">{friendlyName}</span>
            <span className="llm-chat-tool-call-count">×{toolCalls.length}</span>
            {anyError && <span className="llm-chat-tool-call-error-badge">{t("llm_chat.tool_error")}</span>}
        </>
    );

    return (
        <ExpandableSection
            variant="line"
            icon={icon}
            label={label}
            className="llm-chat-tool-call llm-chat-tool-call-group"
        >
            {toolCalls.map((tc, idx) => (
                <ToolCallSection key={tc.id ?? idx} toolCall={tc} />
            ))}
        </ExpandableSection>
    );
}

/**
 * Group consecutive tool calls that share the same label. Singletons pass through unchanged, and
 * a call that waits for approval stays out of any group.
 */
function groupByLabel(toolCalls: ToolCall[]): Array<ToolCall | ToolCall[]> {
    const groups: Array<ToolCall | ToolCall[]> = [];
    for (const tc of toolCalls) {
        const last = groups[groups.length - 1];
        if (tc.approval === "pending" || (last && !Array.isArray(last) && last.approval === "pending")) {
            groups.push(tc);
        } else if (Array.isArray(last) && toolCallLabelKey(last[0]) === toolCallLabelKey(tc)) {
            last.push(tc);
        } else if (last && !Array.isArray(last) && toolCallLabelKey(last) === toolCallLabelKey(tc)) {
            groups[groups.length - 1] = [last, tc];
        } else {
            groups.push(tc);
        }
    }
    return groups;
}

/** One or more sequential tool calls, each a disclosure line like a thought. */
export default function ToolCallCard({ toolCalls }: { toolCalls: ToolCall[] }) {
    const groups = groupByLabel(toolCalls);
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

/** Asks the user whether a waiting tool call can run. */
function ToolApprovalBar({ toolCall }: { toolCall: ToolCall }) {
    const answer = useContext(ToolApprovalContext);
    if (!answer) {
        return null;
    }
    const { id: toolCallId, toolName } = toolCall;
    const tool = t(`llm.tools.${toolName}`, { defaultValue: toolName });

    return (
        <div
            className="llm-chat-tool-approval"
            role="group"
            aria-label={t("llm_chat.tool_approval_prompt")}
        >
            <Button
                size="small"
                text={t("llm_chat.tool_approval_deny")}
                onClick={() => answer(toolCallId, false)}
            />
            <SplitButton
                size="small"
                kind="primary"
                icon="bx bx-check"
                text={t("llm_chat.tool_approval_allow")}
                onClick={() => answer(toolCallId, true)}
            >
                <FormListItem icon="bx bx-check-double" onClick={() => answer(toolCallId, true, "chat")}>
                    {t("llm_chat.tool_approval_allow_for_chat", { tool })}
                </FormListItem>
            </SplitButton>
        </div>
    );
}
