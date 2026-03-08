import "./toolbar_customization.css";

import { useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { reloadFrontendApp } from "../../../services/utils";
import { useTriliumOption } from "../../react/hooks";
import { DEFAULT_CLASSIC_TOOLBAR_ITEMS, type ToolbarGroup, type ToolbarItem } from "../text/toolbar";
import OptionsSection from "./components/OptionsSection";

/** Human-readable labels for all known CKEditor commands. */
const ITEM_LABELS: Record<string, string> = {
    "heading": "Heading",
    "fontSize": "Font Size",
    "bold": "Bold",
    "italic": "Italic",
    "underline": "Underline",
    "strikethrough": "Strikethrough",
    "superscript": "Superscript",
    "subscript": "Subscript",
    "kbd": "Keyboard",
    "formatPainter": "Format Painter",
    "fontColor": "Font Color",
    "fontBackgroundColor": "Font Background",
    "removeFormat": "Remove Format",
    "bulletedList": "Bulleted List",
    "numberedList": "Numbered List",
    "todoList": "To-do List",
    "blockQuote": "Block Quote",
    "admonition": "Admonition",
    "insertTable": "Insert Table",
    "code": "Inline Code",
    "codeBlock": "Code Block",
    "footnote": "Footnote",
    "imageUpload": "Image Upload",
    "link": "Link",
    "bookmark": "Bookmark",
    "internallink": "Internal Link",
    "includeNote": "Include Note",
    "specialCharacters": "Special Characters",
    "emoji": "Emoji",
    "math": "Math",
    "mermaid": "Mermaid",
    "horizontalLine": "Horizontal Line",
    "pageBreak": "Page Break",
    "dateTime": "Date/Time",
    "alignment:left": "Align Left",
    "alignment:center": "Align Center",
    "alignment:right": "Align Right",
    "alignment:justify": "Align Justify",
    "outdent": "Outdent",
    "indent": "Indent",
    "insertTemplate": "Insert Template",
    "markdownImport": "Import Markdown",
    "cuttonote": "Cut to Note",
};

const ALL_COMMANDS = Object.keys(ITEM_LABELS);

type DragSrc =
    | { kind: "top"; index: number }
    | { kind: "group"; groupIdx: number; itemIdx: number };

type DropTarget =
    | { kind: "top"; index: number }
    | { kind: "group-header"; groupIdx: number }
    | { kind: "group"; groupIdx: number; index: number }
    | { kind: "trash" };

function itemLabel(cmd: string): string {
    return ITEM_LABELS[cmd] ?? cmd;
}

function parseConfig(configStr: string): ToolbarItem[] {
    if (!configStr) return [...DEFAULT_CLASSIC_TOOLBAR_ITEMS];
    try {
        return JSON.parse(configStr) as ToolbarItem[];
    } catch {
        return [...DEFAULT_CLASSIC_TOOLBAR_ITEMS];
    }
}

function collectUsed(items: ToolbarItem[]): Set<string> {
    const used = new Set<string>();
    for (const item of items) {
        if (typeof item === "string" && item !== "|") used.add(item);
        else if (typeof item === "object") {
            for (const sub of (item as ToolbarGroup).items) {
                if (sub !== "|") used.add(sub);
            }
        }
    }
    return used;
}

export default function ToolbarCustomization() {
    const [configStr, setConfigStr] = useTriliumOption("textNoteToolbarConfig");

    // Local pending state — only pushed to the server when the user clicks "Save & Apply"
    const [pending, setPending] = useState<ToolbarItem[]>(() => parseConfig(configStr));
    const [saving, setSaving] = useState(false);

    const [expandedGroup, setExpandedGroup] = useState<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
    const dragSrc = useRef<DragSrc | null>(null);
    const autoExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const usedCommands = collectUsed(pending);
    const availableCommands = ALL_COMMANDS.filter((cmd) => !usedCommands.has(cmd));
    const hasChanges = JSON.stringify(pending) !== JSON.stringify(parseConfig(configStr));

    function update(next: ToolbarItem[]) {
        setPending(next);
    }

    // ── Save / Discard ──────────────────────────────────────────────────

    async function handleSave() {
        setSaving(true);
        await setConfigStr(JSON.stringify(pending));
        reloadFrontendApp("toolbar configuration changed");
    }

    function handleDiscard() {
        setPending(parseConfig(configStr));
        setExpandedGroup(null);
    }

    // ── Mutations ───────────────────────────────────────────────────────

    function removeTopItem(index: number) {
        const next = pending.filter((_, i) => i !== index);
        if (expandedGroup === index) setExpandedGroup(null);
        else if (expandedGroup !== null && expandedGroup > index) setExpandedGroup(expandedGroup - 1);
        update(next);
    }

    function removeGroupItem(groupIdx: number, itemIdx: number) {
        update(pending.map((item, i) => {
            if (i !== groupIdx || typeof item !== "object") return item;
            return { ...(item as ToolbarGroup), items: (item as ToolbarGroup).items.filter((_, j) => j !== itemIdx) };
        }));
    }

    function handleAddItem(cmd: string) {
        if (expandedGroup !== null) {
            update(pending.map((item, i) => {
                if (i !== expandedGroup || typeof item !== "object") return item;
                return { ...(item as ToolbarGroup), items: [...(item as ToolbarGroup).items, cmd] };
            }));
        } else {
            update([...pending, cmd]);
        }
    }

    function handleAddSeparator() {
        if (expandedGroup !== null) {
            update(pending.map((item, i) => {
                if (i !== expandedGroup || typeof item !== "object") return item;
                return { ...(item as ToolbarGroup), items: [...(item as ToolbarGroup).items, "|"] };
            }));
        } else {
            update([...pending, "|"]);
        }
    }

    function handleAddGroup() {
        const newGroup: ToolbarGroup = {
            label: t("toolbar_customization.new_group_label"),
            icon: "threeVerticalDots",
            items: []
        };
        const next = [...pending, newGroup];
        update(next);
        setExpandedGroup(next.length - 1);
    }

    function renameGroup(groupIdx: number, label: string) {
        update(pending.map((item, i) => {
            if (i !== groupIdx || typeof item !== "object") return item;
            return { ...(item as ToolbarGroup), label };
        }));
    }

    function handleReset() {
        setPending([...DEFAULT_CLASSIC_TOOLBAR_ITEMS]);
        setExpandedGroup(null);
    }

    // ── Auto-expand on hover ────────────────────────────────────────────

    function scheduleExpand(groupIdx: number) {
        if (autoExpandTimer.current !== null) return;
        autoExpandTimer.current = setTimeout(() => {
            setExpandedGroup(groupIdx);
            autoExpandTimer.current = null;
        }, 600);
    }

    function cancelExpand() {
        if (autoExpandTimer.current !== null) {
            clearTimeout(autoExpandTimer.current);
            autoExpandTimer.current = null;
        }
    }

    // ── Drag & Drop ─────────────────────────────────────────────────────

    function onDragStart(e: DragEvent, src: DragSrc) {
        dragSrc.current = src;
        setIsDragging(true);
        e.dataTransfer?.setData("text/plain", "");
    }

    function onDragEnd() {
        dragSrc.current = null;
        setIsDragging(false);
        setDropTarget(null);
        cancelExpand();
    }

    function onDragOverZone(e: DragEvent, target: DropTarget) {
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(target);

        if (target.kind === "group-header") {
            // Only allow dropping non-group items into a group
            const src = dragSrc.current;
            const srcItem = src?.kind === "top" ? pending[src.index] : null;
            if (srcItem === null || typeof srcItem === "string") {
                scheduleExpand(target.groupIdx);
            }
        } else {
            cancelExpand();
        }
    }

    function onDragLeave(e: DragEvent) {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
            setDropTarget(null);
        }
    }

    function onDropZone(e: DragEvent) {
        e.preventDefault();
        const src = dragSrc.current;
        const target = dropTarget;
        dragSrc.current = null;
        setIsDragging(false);
        setDropTarget(null);
        cancelExpand();
        if (!src || !target) return;

        if (target.kind === "trash") {
            if (src.kind === "top") removeTopItem(src.index);
            else removeGroupItem(src.groupIdx, src.itemIdx);
            return;
        }
        if (src.kind === "top" && target.kind === "top") {
            moveTopItem(src.index, target.index);
        } else if (src.kind === "top" && target.kind === "group-header") {
            moveTopIntoGroup(src.index, target.groupIdx, undefined);
        } else if (src.kind === "top" && target.kind === "group") {
            moveTopIntoGroup(src.index, target.groupIdx, target.index);
        } else if (src.kind === "group" && target.kind === "top") {
            moveGroupItemToTop(src.groupIdx, src.itemIdx, target.index);
        } else if (src.kind === "group" && target.kind === "group" && src.groupIdx === target.groupIdx) {
            moveWithinGroup(src.groupIdx, src.itemIdx, target.index);
        } else if (src.kind === "group" && target.kind === "group" && src.groupIdx !== target.groupIdx) {
            moveCrossGroup(src.groupIdx, src.itemIdx, target.groupIdx, target.index);
        } else if (src.kind === "group" && target.kind === "group-header" && src.groupIdx !== target.groupIdx) {
            moveCrossGroup(src.groupIdx, src.itemIdx, target.groupIdx, undefined);
        }
    }

    function moveTopItem(from: number, to: number) {
        if (from === to) return;
        const next = [...pending];
        const [moved] = next.splice(from, 1);
        const dest = to > from ? to - 1 : to;
        next.splice(dest, 0, moved);
        if (expandedGroup === from) setExpandedGroup(dest);
        else if (expandedGroup !== null) {
            if (from < expandedGroup && dest >= expandedGroup) setExpandedGroup(expandedGroup - 1);
            else if (from > expandedGroup && dest <= expandedGroup) setExpandedGroup(expandedGroup + 1);
        }
        update(next);
    }

    /** Move a top-level string/separator item into a group. Groups cannot be nested. */
    function moveTopIntoGroup(topIdx: number, groupIdx: number, insertAt: number | undefined) {
        const item = pending[topIdx];
        if (typeof item === "object") return; // groups cannot nest

        const withoutItem = pending.filter((_, i) => i !== topIdx);
        const adjGroup = topIdx < groupIdx ? groupIdx - 1 : groupIdx;

        const result = withoutItem.map((g, i) => {
            if (i !== adjGroup || typeof g !== "object") return g;
            const sub = [...(g as ToolbarGroup).items];
            if (insertAt === undefined) sub.push(item as string);
            else sub.splice(insertAt, 0, item as string);
            return { ...(g as ToolbarGroup), items: sub };
        });

        setExpandedGroup(adjGroup);
        update(result);
    }

    /** Pull a group sub-item out to the top level. */
    function moveGroupItemToTop(groupIdx: number, itemIdx: number, topIdx: number) {
        const item = (pending[groupIdx] as ToolbarGroup).items[itemIdx];

        const withoutFromGroup = pending.map((g, i) => {
            if (i !== groupIdx || typeof g !== "object") return g;
            return { ...(g as ToolbarGroup), items: (g as ToolbarGroup).items.filter((_, j) => j !== itemIdx) };
        });

        const result = [...withoutFromGroup];
        result.splice(topIdx, 0, item);

        // The group may have shifted if we inserted before it
        if (expandedGroup !== null) {
            setExpandedGroup(topIdx <= groupIdx ? groupIdx + 1 : groupIdx);
        }
        update(result);
    }

    function moveWithinGroup(groupIdx: number, from: number, to: number) {
        if (from === to) return;
        const group = pending[groupIdx] as ToolbarGroup;
        const sub = [...group.items];
        const [moved] = sub.splice(from, 1);
        sub.splice(to > from ? to - 1 : to, 0, moved);
        update(pending.map((item, i) => i === groupIdx ? { ...(item as ToolbarGroup), items: sub } : item));
    }

    function moveCrossGroup(fromGroupIdx: number, itemIdx: number, toGroupIdx: number, insertAt: number | undefined) {
        const item = (pending[fromGroupIdx] as ToolbarGroup).items[itemIdx];
        const result = pending.map((g, i) => {
            if (typeof g !== "object") return g;
            if (i === fromGroupIdx) return { ...(g as ToolbarGroup), items: (g as ToolbarGroup).items.filter((_, j) => j !== itemIdx) };
            if (i === toGroupIdx) {
                const sub = [...(g as ToolbarGroup).items];
                if (insertAt === undefined) sub.push(item);
                else sub.splice(insertAt, 0, item);
                return { ...(g as ToolbarGroup), items: sub };
            }
            return g;
        });
        setExpandedGroup(toGroupIdx);
        update(result);
    }

    // ── Render ──────────────────────────────────────────────────────────

    return (
        <OptionsSection title={t("toolbar_customization.title")}>
            <p className="form-text">{t("toolbar_customization.description")}</p>

            {/* Save / Discard bar */}
            <div className={`toolbar-save-bar ${hasChanges ? "has-changes" : ""}`}>
                <span className="toolbar-save-status">
                    {hasChanges ? t("toolbar_customization.unsaved_changes") : t("toolbar_customization.no_changes")}
                </span>
                <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    disabled={!hasChanges || saving}
                    onClick={handleDiscard}
                >
                    {t("toolbar_customization.discard")}
                </button>
                <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!hasChanges || saving}
                    onClick={handleSave}
                >
                    {saving ? t("toolbar_customization.saving") : t("toolbar_customization.save_apply")}
                </button>
            </div>

            <div className="toolbar-editor">
                <div className="toolbar-columns">

                    {/* Left panel: current toolbar */}
                    <div className="toolbar-panel">
                        <div className="toolbar-panel-header">{t("toolbar_customization.current_toolbar")}</div>
                        <div
                            className="toolbar-list"
                            onDragOver={(e: DragEvent) => onDragOverZone(e, { kind: "top", index: pending.length })}
                            onDragLeave={onDragLeave}
                            onDrop={onDropZone}
                        >
                            {pending.length === 0 && (
                                <div className="toolbar-empty-hint">{t("toolbar_customization.empty")}</div>
                            )}
                            {pending.map((item, idx) => (
                                <ToolbarRow
                                    key={idx}
                                    item={item}
                                    isExpanded={expandedGroup === idx}
                                    isDropTarget={dropTarget?.kind === "top" && dropTarget.index === idx}
                                    isGroupDropTarget={dropTarget?.kind === "group-header" && dropTarget.groupIdx === idx}
                                    groupDropTargetIdx={
                                        dropTarget?.kind === "group" && dropTarget.groupIdx === idx
                                            ? dropTarget.index : null
                                    }
                                    onToggleExpand={() => setExpandedGroup(expandedGroup === idx ? null : idx)}
                                    onRemove={() => removeTopItem(idx)}
                                    onRemoveGroupItem={(itemIdx) => removeGroupItem(idx, itemIdx)}
                                    onRenameGroup={(label) => renameGroup(idx, label)}
                                    onDragStart={(e) => onDragStart(e, { kind: "top", index: idx })}
                                    onDragEnd={onDragEnd}
                                    onDragOver={(e: DragEvent) => { e.stopPropagation(); onDragOverZone(e, { kind: "top", index: idx }); }}
                                    onDragOverGroupHeader={(e: DragEvent) => { e.stopPropagation(); onDragOverZone(e, { kind: "group-header", groupIdx: idx }); }}
                                    onDragLeave={onDragLeave}
                                    onDrop={(e: DragEvent) => { e.stopPropagation(); onDropZone(e); }}
                                    onGroupItemDragStart={(itemIdx, e) => onDragStart(e, { kind: "group", groupIdx: idx, itemIdx })}
                                    onGroupItemDragEnd={onDragEnd}
                                    onGroupItemDragOver={(itemIdx, e) => { e.stopPropagation(); onDragOverZone(e, { kind: "group", groupIdx: idx, index: itemIdx }); }}
                                    onGroupItemDrop={(e) => { e.stopPropagation(); onDropZone(e); }}
                                />
                            ))}
                        </div>

                        {isDragging && (
                            <div
                                className={`toolbar-trash ${dropTarget?.kind === "trash" ? "active" : ""}`}
                                onDragOver={(e: DragEvent) => onDragOverZone(e, { kind: "trash" })}
                                onDragLeave={onDragLeave}
                                onDrop={onDropZone}
                            >
                                <span className="bx bx-trash" />
                                {" "}{t("toolbar_customization.drop_to_remove")}
                            </div>
                        )}

                        <div className="toolbar-actions">
                            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={handleAddSeparator} title={t("toolbar_customization.separator_hint")}>
                                |&nbsp; {t("toolbar_customization.add_separator")}
                            </button>
                            {expandedGroup === null && (
                                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={handleAddGroup}>
                                    <span className="bx bx-folder-plus" />
                                    {" "}{t("toolbar_customization.add_group")}
                                </button>
                            )}
                            <button type="button" className="btn btn-sm btn-outline-danger ms-auto" onClick={handleReset}>
                                {t("toolbar_customization.reset_default")}
                            </button>
                        </div>
                    </div>

                    {/* Right panel: available items */}
                    <div className="toolbar-panel">
                        <div className="toolbar-panel-header">
                            {expandedGroup !== null
                                ? t("toolbar_customization.add_to_group")
                                : t("toolbar_customization.available_items")}
                        </div>
                        <div className="toolbar-list available-list">
                            {availableCommands.length === 0 && (
                                <div className="toolbar-empty-hint">{t("toolbar_customization.all_used")}</div>
                            )}
                            {availableCommands.map((cmd) => (
                                <div
                                    key={cmd}
                                    className="toolbar-row available"
                                    onClick={() => handleAddItem(cmd)}
                                    title={t("toolbar_customization.click_to_add")}
                                >
                                    <span class="bx bx-plus row-add-icon" aria-hidden="true" />
                                    <span className="row-label">{ITEM_LABELS[cmd]}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            </div>
        </OptionsSection>
    );
}

// ─── ToolbarRow sub-component ─────────────────────────────────────────────────

interface ToolbarRowProps {
    item: ToolbarItem;
    isExpanded: boolean;
    isDropTarget: boolean;
    isGroupDropTarget: boolean;
    groupDropTargetIdx: number | null;
    onToggleExpand: () => void;
    onRemove: () => void;
    onRemoveGroupItem: (itemIdx: number) => void;
    onRenameGroup: (label: string) => void;
    onDragStart: (e: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (e: DragEvent) => void;
    onDragOverGroupHeader: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onGroupItemDragStart: (itemIdx: number, e: DragEvent) => void;
    onGroupItemDragEnd: () => void;
    onGroupItemDragOver: (itemIdx: number, e: DragEvent) => void;
    onGroupItemDrop: (e: DragEvent) => void;
}

function ToolbarRow({
    item,
    isExpanded,
    isDropTarget,
    isGroupDropTarget,
    groupDropTargetIdx,
    onToggleExpand,
    onRemove,
    onRemoveGroupItem,
    onRenameGroup,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragOverGroupHeader,
    onDragLeave,
    onDrop,
    onGroupItemDragStart,
    onGroupItemDragEnd,
    onGroupItemDragOver,
    onGroupItemDrop
}: ToolbarRowProps) {
    const isGroup = typeof item === "object";
    const isSeparator = item === "|";
    const label = isSeparator ? "── separator ──"
        : isGroup ? (item as ToolbarGroup).label
            : itemLabel(item as string);

    return (
        <div
            className={`toolbar-row-wrapper ${isDropTarget ? "drop-above" : ""}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <div
                className={`toolbar-row ${isSeparator ? "separator" : ""} ${isGroup ? "group-header" : ""} ${isGroupDropTarget ? "drop-into-group" : ""}`}
                draggable={true}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={isGroup ? onDragOverGroupHeader : undefined}
            >
                <span class="bx bx-dots-vertical-rounded drag-handle" aria-hidden="true" />
                <span className="row-label">{label}</span>
                {isGroup && (
                    <button
                        type="button"
                        className="row-btn"
                        onClick={onToggleExpand}
                        title={isExpanded ? t("toolbar_customization.collapse_group") : t("toolbar_customization.expand_group")}
                    >
                        <span class={`bx ${isExpanded ? "bx-chevron-up" : "bx-chevron-down"}`} />
                    </button>
                )}
                <button
                    type="button"
                    className="row-btn remove"
                    onClick={onRemove}
                    title={t("toolbar_customization.remove_item")}
                >
                    <span class="bx bx-x" />
                </button>
            </div>

            {isGroup && isExpanded && (
                <div className="group-expanded">
                    <div className="group-name-row">
                        <span className="group-name-label">{t("toolbar_customization.group_name")}</span>
                        <input
                            type="text"
                            className="form-control form-control-sm group-name-input"
                            value={(item as ToolbarGroup).label}
                            onInput={(e) => onRenameGroup((e.target as HTMLInputElement).value)}
                        />
                    </div>
                    {(item as ToolbarGroup).items.length === 0 && (
                        <div className="toolbar-empty-hint indented">{t("toolbar_customization.group_empty")}</div>
                    )}
                    {(item as ToolbarGroup).items.map((sub, subIdx) => (
                        <div
                            key={subIdx}
                            className={`toolbar-row sub ${groupDropTargetIdx === subIdx ? "drop-above" : ""}`}
                            draggable={true}
                            onDragStart={(e) => onGroupItemDragStart(subIdx, e as DragEvent)}
                            onDragEnd={onGroupItemDragEnd}
                            onDragOver={(e) => { (e as DragEvent).preventDefault(); onGroupItemDragOver(subIdx, e as DragEvent); }}
                            onDrop={onGroupItemDrop}
                        >
                            <span class="bx bx-dots-vertical-rounded drag-handle" aria-hidden="true" />
                            <span className="row-label">{sub === "|" ? "── separator ──" : itemLabel(sub)}</span>
                            <button
                                type="button"
                                className="row-btn remove"
                                onClick={() => onRemoveGroupItem(subIdx)}
                                title={t("toolbar_customization.remove_item")}
                            >
                                <span class="bx bx-x" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
