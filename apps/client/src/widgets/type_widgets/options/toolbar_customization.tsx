import "./toolbar_customization.css";

import { useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
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
    | { kind: "group"; groupIdx: number; index: number }
    | { kind: "trash" };

function itemLabel(item: string): string {
    return ITEM_LABELS[item] ?? item;
}

function parseConfig(configStr: string): ToolbarItem[] {
    if (!configStr) return [...DEFAULT_CLASSIC_TOOLBAR_ITEMS];
    try {
        return JSON.parse(configStr) as ToolbarItem[];
    } catch {
        return [...DEFAULT_CLASSIC_TOOLBAR_ITEMS];
    }
}

export default function ToolbarCustomization() {
    const [configStr, setConfigStr] = useTriliumOption("textNoteToolbarConfig");
    const items = parseConfig(configStr);

    const [expandedGroup, setExpandedGroup] = useState<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
    const dragSrc = useRef<DragSrc | null>(null);

    function saveItems(next: ToolbarItem[]) {
        setConfigStr(JSON.stringify(next));
    }

    // --- Mutation helpers ---

    function removeTopItem(index: number) {
        const next = items.filter((_, i) => i !== index);
        if (expandedGroup === index) setExpandedGroup(null);
        else if (expandedGroup !== null && expandedGroup > index) setExpandedGroup(expandedGroup - 1);
        saveItems(next);
    }

    function removeGroupItem(groupIdx: number, itemIdx: number) {
        const next = items.map((item, i) => {
            if (i !== groupIdx || typeof item !== "object") return item;
            return { ...item, items: (item as ToolbarGroup).items.filter((_, j) => j !== itemIdx) };
        });
        saveItems(next);
    }

    function addTopItem(cmd: string) {
        saveItems([...items, cmd]);
    }

    function addToGroup(cmd: string) {
        if (expandedGroup === null) return;
        const next = items.map((item, i) => {
            if (i !== expandedGroup || typeof item !== "object") return item;
            return { ...(item as ToolbarGroup), items: [...(item as ToolbarGroup).items, cmd] };
        });
        saveItems(next);
    }

    function handleAddItem(cmd: string) {
        if (expandedGroup !== null) addToGroup(cmd);
        else addTopItem(cmd);
    }

    function handleAddSeparator() {
        if (expandedGroup !== null) {
            const next = items.map((item, i) => {
                if (i !== expandedGroup || typeof item !== "object") return item;
                return { ...(item as ToolbarGroup), items: [...(item as ToolbarGroup).items, "|"] };
            });
            saveItems(next);
        } else {
            saveItems([...items, "|"]);
        }
    }

    function handleAddGroup() {
        const newGroup: ToolbarGroup = {
            label: t("toolbar_customization.new_group_label"),
            icon: "threeVerticalDots",
            items: []
        };
        const next = [...items, newGroup];
        saveItems(next);
        setExpandedGroup(next.length - 1);
    }

    function renameGroup(groupIdx: number, label: string) {
        const next = items.map((item, i) => {
            if (i !== groupIdx || typeof item !== "object") return item;
            return { ...(item as ToolbarGroup), label };
        });
        saveItems(next);
    }

    function handleReset() {
        setExpandedGroup(null);
        setConfigStr("");
    }

    // --- Drag & Drop ---

    function onDragStart(e: DragEvent, src: DragSrc) {
        dragSrc.current = src;
        setIsDragging(true);
        e.dataTransfer?.setData("text/plain", "");
    }

    function onDragEnd() {
        dragSrc.current = null;
        setIsDragging(false);
        setDropTarget(null);
    }

    function onDragOverZone(e: DragEvent, target: DropTarget) {
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(target);
    }

    function onDragLeave(e: DragEvent) {
        // Only clear when truly leaving the zone (not entering a child)
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

        if (!src || !target) return;

        if (target.kind === "trash") {
            if (src.kind === "top") removeTopItem(src.index);
            else removeGroupItem(src.groupIdx, src.itemIdx);
            return;
        }

        if (src.kind === "top" && target.kind === "top") {
            moveTopItem(src.index, target.index);
        } else if (src.kind === "group" && target.kind === "group" && src.groupIdx === target.groupIdx) {
            moveGroupItem(src.groupIdx, src.itemIdx, target.index);
        }
    }

    function moveTopItem(from: number, to: number) {
        if (from === to) return;
        const next = [...items];
        const [moved] = next.splice(from, 1);
        const dest = to > from ? to - 1 : to;
        next.splice(dest, 0, moved);
        if (expandedGroup === from) setExpandedGroup(dest);
        else if (expandedGroup !== null) {
            if (from < expandedGroup && dest >= expandedGroup) setExpandedGroup(expandedGroup - 1);
            else if (from > expandedGroup && dest <= expandedGroup) setExpandedGroup(expandedGroup + 1);
        }
        saveItems(next);
    }

    function moveGroupItem(groupIdx: number, from: number, to: number) {
        if (from === to) return;
        const group = items[groupIdx] as ToolbarGroup;
        const subItems = [...group.items];
        const [moved] = subItems.splice(from, 1);
        subItems.splice(to > from ? to - 1 : to, 0, moved);
        saveItems(items.map((item, i) => i === groupIdx ? { ...(item as ToolbarGroup), items: subItems } : item));
    }

    return (
        <OptionsSection title={t("toolbar_customization.title")}>
            <p className="form-text">{t("toolbar_customization.description")}</p>

            <div className="toolbar-editor">
                {/* Current toolbar */}
                <div
                    className="toolbar-current"
                    onDragOver={(e: DragEvent) => onDragOverZone(e, { kind: "top", index: items.length })}
                    onDragLeave={onDragLeave}
                    onDrop={onDropZone}
                >
                    {items.length === 0 && (
                        <span className="toolbar-empty-hint">{t("toolbar_customization.empty")}</span>
                    )}
                    {items.map((item, idx) => (
                        <ToolbarItemChip
                            key={idx}
                            item={item}
                            isExpanded={expandedGroup === idx}
                            isDropTarget={dropTarget?.kind === "top" && dropTarget.index === idx}
                            groupDropTargetIdx={
                                dropTarget?.kind === "group" && dropTarget.groupIdx === idx
                                    ? dropTarget.index
                                    : null
                            }
                            onToggleExpand={() => setExpandedGroup(expandedGroup === idx ? null : idx)}
                            onRemove={() => removeTopItem(idx)}
                            onRemoveGroupItem={(itemIdx) => removeGroupItem(idx, itemIdx)}
                            onRenameGroup={(label) => renameGroup(idx, label)}
                            onDragStart={(e) => onDragStart(e, { kind: "top", index: idx })}
                            onDragEnd={onDragEnd}
                            onDragOver={(e: DragEvent) => { e.stopPropagation(); onDragOverZone(e, { kind: "top", index: idx }); }}
                            onDragLeave={onDragLeave}
                            onDrop={(e: DragEvent) => { e.stopPropagation(); onDropZone(e); }}
                            onGroupItemDragStart={(itemIdx, e) => onDragStart(e, { kind: "group", groupIdx: idx, itemIdx })}
                            onGroupItemDragEnd={onDragEnd}
                            onGroupItemDragOver={(itemIdx, e) => { e.stopPropagation(); onDragOverZone(e, { kind: "group", groupIdx: idx, index: itemIdx }); }}
                            onGroupItemDrop={(e) => { e.stopPropagation(); onDropZone(e); }}
                        />
                    ))}
                </div>

                {/* Drop-to-delete zone */}
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

                {/* Available items pool */}
                <div className="toolbar-pool-section">
                    <div className="toolbar-pool-label">
                        {expandedGroup !== null
                            ? t("toolbar_customization.add_to_group")
                            : t("toolbar_customization.available_items")}
                    </div>
                    <div className="toolbar-pool">
                        {ALL_COMMANDS.map((cmd) => (
                            <button
                                key={cmd}
                                type="button"
                                className="btn btn-sm btn-outline-secondary toolbar-pool-btn"
                                onClick={() => handleAddItem(cmd)}
                            >
                                {ITEM_LABELS[cmd]}
                            </button>
                        ))}
                    </div>

                    <div className="toolbar-actions">
                        <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={handleAddSeparator}
                            title={t("toolbar_customization.separator_hint")}
                        >
                            | &nbsp;{t("toolbar_customization.add_separator")}
                        </button>

                        {expandedGroup === null && (
                            <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                onClick={handleAddGroup}
                            >
                                <span className="bx bx-folder-plus" />
                                {" "}{t("toolbar_customization.add_group")}
                            </button>
                        )}

                        <button
                            type="button"
                            className="btn btn-sm btn-outline-danger ms-auto"
                            onClick={handleReset}
                        >
                            {t("toolbar_customization.reset_default")}
                        </button>
                    </div>
                </div>
            </div>
        </OptionsSection>
    );
}

// ─── Sub-component ────────────────────────────────────────────────────────────

interface ToolbarItemChipProps {
    item: ToolbarItem;
    isExpanded: boolean;
    isDropTarget: boolean;
    groupDropTargetIdx: number | null;
    onToggleExpand: () => void;
    onRemove: () => void;
    onRemoveGroupItem: (itemIdx: number) => void;
    onRenameGroup: (label: string) => void;
    onDragStart: (e: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onGroupItemDragStart: (itemIdx: number, e: DragEvent) => void;
    onGroupItemDragEnd: () => void;
    onGroupItemDragOver: (itemIdx: number, e: DragEvent) => void;
    onGroupItemDrop: (e: DragEvent) => void;
}

function ToolbarItemChip({
    item,
    isExpanded,
    isDropTarget,
    groupDropTargetIdx,
    onToggleExpand,
    onRemove,
    onRemoveGroupItem,
    onRenameGroup,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
    onGroupItemDragStart,
    onGroupItemDragEnd,
    onGroupItemDragOver,
    onGroupItemDrop
}: ToolbarItemChipProps) {
    const isGroup = typeof item === "object";
    const isSeparator = item === "|";

    let label: string;
    if (isSeparator) {
        label = "│";
    } else if (isGroup) {
        label = (item as ToolbarGroup).label;
    } else {
        label = itemLabel(item as string);
    }

    return (
        <div
            className={`toolbar-chip-wrapper ${isDropTarget ? "drop-before" : ""}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <div
                className={`toolbar-chip ${isSeparator ? "separator" : ""} ${isGroup ? "group" : ""}`}
                draggable={true}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
            >
                <span class="bx bx-dots-vertical-rounded drag-handle" aria-hidden="true" />
                <span className="chip-label">{label}</span>
                {isGroup && (
                    <button
                        type="button"
                        className="chip-btn"
                        onClick={onToggleExpand}
                        title={isExpanded ? t("toolbar_customization.collapse_group") : t("toolbar_customization.expand_group")}
                    >
                        <span class={`bx ${isExpanded ? "bx-chevron-up" : "bx-chevron-down"}`} />
                    </button>
                )}
                <button
                    type="button"
                    className="chip-btn chip-remove"
                    onClick={onRemove}
                    title={t("toolbar_customization.remove_item")}
                >
                    <span class="bx bx-x" />
                </button>
            </div>

            {isGroup && isExpanded && (
                <div className="toolbar-group-panel">
                    <label className="form-label form-label-sm">
                        {t("toolbar_customization.group_name")}
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            value={(item as ToolbarGroup).label}
                            onInput={(e) => onRenameGroup((e.target as HTMLInputElement).value)}
                        />
                    </label>

                    <div className="toolbar-subchips">
                        {(item as ToolbarGroup).items.length === 0 && (
                            <span className="toolbar-empty-hint">{t("toolbar_customization.group_empty")}</span>
                        )}
                        {(item as ToolbarGroup).items.map((sub, subIdx) => (
                            <div
                                key={subIdx}
                                className={`toolbar-chip sub ${groupDropTargetIdx === subIdx ? "drop-before" : ""}`}
                                draggable={true}
                                onDragStart={(e) => onGroupItemDragStart(subIdx, e as DragEvent)}
                                onDragEnd={onGroupItemDragEnd}
                                onDragOver={(e) => { (e as DragEvent).preventDefault(); onGroupItemDragOver(subIdx, e as DragEvent); }}
                                onDrop={onGroupItemDrop}
                            >
                                <span class="bx bx-dots-vertical-rounded drag-handle" aria-hidden="true" />
                                <span className="chip-label">{sub === "|" ? "│" : itemLabel(sub)}</span>
                                <button
                                    type="button"
                                    className="chip-btn chip-remove"
                                    onClick={() => onRemoveGroupItem(subIdx)}
                                    title={t("toolbar_customization.remove_item")}
                                >
                                    <span class="bx bx-x" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
