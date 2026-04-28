import "./ToolCallCard.css";

import { Trans } from "react-i18next";

import { t } from "../../../services/i18n.js";
import { NewNoteLink } from "../../react/NoteLink.js";
import { ExpandableCard, ExpandableSection } from "./ExpandableCard.js";
import type { ToolCall } from "./llm_chat_types.js";

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

    const detailText = (input?.name ?? input?.query) as string | undefined;
    return { noteId: null, parentNoteId: null, detailText: detailText || null };
}

function toolNameIcon(toolName: string): string {
    if (toolName.includes("search")) return "bx bx-search";
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

/** Try to parse a JSON string into a structured value. */
function tryParseJson(data: unknown): unknown {
    if (typeof data === "string") {
        try {
            return JSON.parse(data);
        } catch {
            return data;
        }
    }
    return data;
}

/** Check if a value is a plain object (not null, not array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_TABLE_DEPTH = 2;

/** Render a single value — recurse for objects/arrays up to max depth. */
function ValueCell({ value, depth }: { value: unknown; depth: number }) {
    if (value === null || value === undefined) return <pre />;

    // Beyond max depth, fall back to JSON.
    if (depth >= MAX_TABLE_DEPTH) {
        if (isPlainObject(value) || Array.isArray(value)) {
            return <pre>{JSON.stringify(value, null, 2)}</pre>;
        }
        return <pre>{String(value)}</pre>;
    }

    if (isPlainObject(value)) {
        return <KeyValueTable data={value} depth={depth} />;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) return <pre>{"[]"}</pre>;

        // Array of objects: render each as a nested table.
        if (value.every(isPlainObject)) {
            return (
                <div className="llm-chat-tool-call-table-array">
                    {value.map((item, idx) => (
                        <KeyValueTable key={idx} data={item} depth={depth} />
                    ))}
                </div>
            );
        }

        // Array of primitives: comma-separated.
        return <pre>{value.map(String).join(", ")}</pre>;
    }

    return <pre>{String(value)}</pre>;
}

/** Renders a data object as a recursive two-column key-value table. */
function KeyValueTable({ data, className, depth = 0 }: { data: unknown; className?: string; depth?: number }) {
    const obj = tryParseJson(data);

    if (!isPlainObject(obj)) {
        const raw = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        return <pre className={className}>{raw}</pre>;
    }

    return (
        <table className={`llm-chat-tool-call-table ${className ?? ""}`}>
            <tbody>
                {Object.entries(obj).map(([key, value]) => (
                    <tr key={key}>
                        <td className="llm-chat-tool-call-table-key">{key}</td>
                        <td className="llm-chat-tool-call-table-value">
                            <ValueCell value={value} depth={depth + 1} />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** Build the label content for a tool call section. */
function ToolCallLabel({ toolCall }: { toolCall: ToolCall }) {
    const { noteId: refNoteId, parentNoteId: refParentId, detailText } = getToolCallContext(toolCall);
    const hasError = toolCall.isError;

    return (
        <>
            {t(`llm.tools.${toolCall.toolName}`, { defaultValue: toolCall.toolName })}
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
            {hasError && <span className="llm-chat-tool-call-error-badge">{t("llm_chat.tool_error")}</span>}
        </>
    );
}

/** A single tool call section within a ToolCallCard. */
function ToolCallSection({ toolCall }: { toolCall: ToolCall }) {
    const hasError = toolCall.isError;

    return (
        <ExpandableSection
            icon={toolCallIcon(toolCall)}
            label={<ToolCallLabel toolCall={toolCall} />}
            className={hasError ? "llm-chat-tool-call-error" : ""}
        >
            <div className="llm-chat-tool-call-input">
                <strong>{t("llm_chat.input")}</strong>
                <KeyValueTable data={toolCall.input} />
            </div>
            {toolCall.result && (
                <div className={`llm-chat-tool-call-result ${hasError ? "llm-chat-tool-call-result-error" : ""}`}>
                    <strong>{hasError ? t("llm_chat.error") : t("llm_chat.result")}</strong>
                    <KeyValueTable data={toolCall.result} />
                </div>
            )}
        </ExpandableSection>
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
            {friendlyName}
            <span className="llm-chat-tool-call-count">×{toolCalls.length}</span>
            {anyError && <span className="llm-chat-tool-call-error-badge">{t("llm_chat.tool_error")}</span>}
        </>
    );

    return (
        <ExpandableSection icon={icon} label={label} className="llm-chat-tool-call-group">
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

/** A card that groups one or more sequential tool calls together. */
export default function ToolCallCard({ toolCalls }: { toolCalls: ToolCall[] }) {
    const groups = groupByToolName(toolCalls);
    return (
        <ExpandableCard>
            {groups.map((group, idx) => (
                Array.isArray(group)
                    ? <ToolCallGroupSection key={idx} toolCalls={group} />
                    : <ToolCallSection key={group.id ?? idx} toolCall={group} />
            ))}
        </ExpandableCard>
    );
}
