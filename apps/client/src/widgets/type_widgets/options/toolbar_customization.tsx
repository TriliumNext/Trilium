/**
 * Settings UI for customizing the CKEditor5 toolbar.
 *
 * Allows users to:
 *   - Show / hide individual toolbar items and groups
 *   - Reorder items via drag-and-drop (HTML5 native DnD, no extra deps)
 *   - Move items into an existing dropdown group or into a new custom group
 *   - Move items out of a group back to the top level
 *   - Add or remove separators
 *   - Reset all three toolbars (classic / floating / block) to built-in defaults
 */
import { useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { useTriliumOption } from "../../react/hooks";
import OptionsSection from "./components/OptionsSection";
import {
    DEFAULT_CLASSIC_TOOLBAR,
    DEFAULT_FLOATING_TOOLBAR,
    DEFAULT_BLOCK_TOOLBAR,
    getDefaultConfig,
    getItemLabel,
    type ToolbarCustomConfig,
    type ToolbarEntry,
    type ToolbarGroup,
    type ToolbarItem,
    type ToolbarSeparator
} from "../text/toolbar_config";

// ─── Main exported component ─────────────────────────────────────────────────

export default function ToolbarCustomization() {
    // Use the raw string option so that we can store "" for "use defaults".
    const [rawConfig, setRawConfig] = useTriliumOption("textNoteToolbarConfig", true);
    const [activeTab, setActiveTab] = useState<"classic" | "floating" | "blockToolbar">("classic");

    // Parse stored JSON, falling back to a deep clone of the built-in defaults.
    const config: ToolbarCustomConfig = parseConfig(rawConfig);

    function saveConfig(newConfig: ToolbarCustomConfig) {
        setRawConfig(JSON.stringify(newConfig));
    }

    function updateList(tab: "classic" | "floating" | "blockToolbar", items: ToolbarEntry[]) {
        saveConfig({ ...config, [tab]: items });
    }

    function resetToDefault() {
        setRawConfig("");
    }

    const tabLabels: Record<"classic" | "floating" | "blockToolbar", string> = {
        classic: t("toolbar_customization.tab_classic"),
        floating: t("toolbar_customization.tab_floating"),
        blockToolbar: t("toolbar_customization.tab_block")
    };

    return (
        <OptionsSection title={t("toolbar_customization.title")}>
            <p className="form-text">
                {t("toolbar_customization.description")}
            </p>

            {/* Tab switcher */}
            <ul className="nav nav-tabs mb-3">
                {(["classic", "floating", "blockToolbar"] as const).map((tab) => (
                    <li className="nav-item" key={tab}>
                        <a
                            className={`nav-link${activeTab === tab ? " active" : ""}`}
                            style={{ cursor: "pointer" }}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tabLabels[tab]}
                        </a>
                    </li>
                ))}
            </ul>

            <ToolbarEntryList
                entries={config[activeTab]}
                onChange={(entries) => updateList(activeTab, entries)}
            />

            <div className="mt-3">
                <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={resetToDefault}
                    title={t("toolbar_customization.reset_title")}
                >
                    {t("toolbar_customization.reset")}
                </button>
            </div>
        </OptionsSection>
    );
}

// ─── Entry list with drag-and-drop ───────────────────────────────────────────

interface EntryListProps {
    entries: ToolbarEntry[];
    onChange: (entries: ToolbarEntry[]) => void;
}

function ToolbarEntryList({ entries, onChange }: EntryListProps) {
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    // ── Reorder (top-level) ──────────────────────────────────────────────────

    function applyDrop(from: number, to: number) {
        if (from === to) return;
        const next = [...entries];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        onChange(next);
    }

    function handleDragStart(index: number) {
        setDragIndex(index);
    }

    function handleDragOver(e: DragEvent, index: number) {
        e.preventDefault();
        setDropIndex(index);
    }

    function handleDrop(e: DragEvent, index: number) {
        e.preventDefault();
        if (dragIndex !== null) {
            applyDrop(dragIndex, index);
        }
        setDragIndex(null);
        setDropIndex(null);
    }

    function handleDragEnd() {
        setDragIndex(null);
        setDropIndex(null);
    }

    // ── Visibility ───────────────────────────────────────────────────────────

    function toggleVisible(index: number) {
        const entry = entries[index];
        if (entry.kind === "separator") return;
        const next = [...entries];
        next[index] = { ...entry, visible: !entry.visible } as ToolbarEntry;
        onChange(next);
    }

    // ── Separators ───────────────────────────────────────────────────────────

    function addSeparatorBefore(index: number) {
        const next = [...entries];
        const sep: ToolbarSeparator = { kind: "separator" };
        next.splice(index, 0, sep);
        onChange(next);
    }

    function removeSeparator(index: number) {
        onChange(entries.filter((_, i) => i !== index));
    }

    // ── Groups ───────────────────────────────────────────────────────────────

    function toggleGroupExpand(groupId: string) {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    }

    function toggleChildVisible(groupIndex: number, childIndex: number) {
        const group = entries[groupIndex] as ToolbarGroup;
        const child = group.items[childIndex] as ToolbarItem;
        if (child.kind !== "item") return;
        const newItems = [...group.items];
        newItems[childIndex] = { ...child, visible: !child.visible };
        const next = [...entries];
        next[groupIndex] = { ...group, items: newItems };
        onChange(next);
    }

    function reorderGroupChildren(groupIndex: number, from: number, to: number) {
        const group = entries[groupIndex] as ToolbarGroup;
        const newItems = [...group.items];
        const [moved] = newItems.splice(from, 1);
        newItems.splice(to, 0, moved);
        const next = [...entries];
        next[groupIndex] = { ...group, items: newItems };
        onChange(next);
    }

    function addChildSeparator(groupIndex: number, childIndex: number) {
        const group = entries[groupIndex] as ToolbarGroup;
        const newItems = [...group.items];
        newItems.splice(childIndex, 0, { kind: "separator" } as ToolbarSeparator);
        const next = [...entries];
        next[groupIndex] = { ...group, items: newItems };
        onChange(next);
    }

    function removeChildSeparator(groupIndex: number, childIndex: number) {
        const group = entries[groupIndex] as ToolbarGroup;
        const newItems = group.items.filter((_, i) => i !== childIndex);
        const next = [...entries];
        next[groupIndex] = { ...group, items: newItems };
        onChange(next);
    }

    /** Move an item out of a group back to the top level (directly after the group). */
    function moveOutOfGroup(groupIndex: number, childIndex: number) {
        const group = entries[groupIndex] as ToolbarGroup;
        const child = group.items[childIndex] as ToolbarItem;
        if (child.kind !== "item") return;
        const newGroupItems = group.items.filter((_, i) => i !== childIndex);
        const next = [...entries];
        next[groupIndex] = { ...group, items: newGroupItems };
        next.splice(groupIndex + 1, 0, child);
        onChange(next);
    }

    /** Move a top-level item into an existing group (appended at the end). */
    function moveIntoGroup(itemIndex: number, targetGroupId: string) {
        const item = entries[itemIndex] as ToolbarItem;
        if (item.kind !== "item") return;
        const groupIndex = entries.findIndex(
            (e) => e.kind === "group" && (e as ToolbarGroup).id === targetGroupId
        );
        if (groupIndex === -1) return;
        const group = entries[groupIndex] as ToolbarGroup;
        // Remove the item first to avoid index shifts.
        const next = entries.filter((_, i) => i !== itemIndex);
        const adjustedGroupIndex = groupIndex > itemIndex ? groupIndex - 1 : groupIndex;
        next[adjustedGroupIndex] = { ...group, items: [...group.items, item] };
        onChange(next);
    }

    /** Wrap a top-level item into a new custom group with a threeVerticalDots icon. */
    function wrapInNewGroup(itemIndex: number) {
        const item = entries[itemIndex] as ToolbarItem;
        if (item.kind !== "item") return;
        const newGroup: ToolbarGroup = {
            kind: "group",
            id: `custom_${Date.now()}`,
            label: getItemLabel(item.id),
            icon: "threeVerticalDots",
            visible: true,
            items: [item]
        };
        const next = [...entries];
        next[itemIndex] = newGroup;
        onChange(next);
    }

    // ── Render ───────────────────────────────────────────────────────────────

    const availableGroups = entries.filter((e): e is ToolbarGroup => e.kind === "group");

    return (
        <div className="toolbar-entry-list" style={{ fontSize: "0.9em" }}>
            {entries.map((entry, index) => {
                const isDropTarget = dropIndex === index && dragIndex !== null && dragIndex !== index;
                const isDragging = dragIndex === index;

                const commonDndProps = {
                    draggable: true as true,
                    onDragStart: () => handleDragStart(index),
                    onDragOver: (e: DragEvent) => handleDragOver(e, index),
                    onDrop: (e: DragEvent) => handleDrop(e, index),
                    onDragEnd: handleDragEnd
                };

                const rowStyle = {
                    opacity: isDragging ? 0.4 : 1,
                    borderTop: isDropTarget ? "2px solid var(--bs-primary, #0d6efd)" : "2px solid transparent",
                    transition: "border-top 0.1s"
                };

                if (entry.kind === "separator") {
                    return (
                        <div key={`sep-${index}`} style={rowStyle} {...commonDndProps}>
                            <SeparatorRow onRemove={() => removeSeparator(index)} />
                        </div>
                    );
                }

                if (entry.kind === "group") {
                    const expanded = expandedGroups.has(entry.id);
                    return (
                        <div key={entry.id} style={rowStyle} {...commonDndProps}>
                            <GroupRow
                                group={entry}
                                expanded={expanded}
                                onToggleExpand={() => toggleGroupExpand(entry.id)}
                                onToggleVisible={() => toggleVisible(index)}
                                onChildVisibleToggle={(ci) => toggleChildVisible(index, ci)}
                                onChildReorder={(from, to) => reorderGroupChildren(index, from, to)}
                                onChildAddSeparatorBefore={(ci) => addChildSeparator(index, ci)}
                                onChildRemoveSeparator={(ci) => removeChildSeparator(index, ci)}
                                onChildMoveOut={(ci) => moveOutOfGroup(index, ci)}
                            />
                        </div>
                    );
                }

                // Plain item
                return (
                    <div key={entry.id} style={rowStyle} {...commonDndProps}>
                        <ItemRow
                            item={entry}
                            onToggleVisible={() => toggleVisible(index)}
                            onAddSeparatorBefore={() => addSeparatorBefore(index)}
                            availableGroups={availableGroups}
                            onMoveIntoGroup={(gid) => moveIntoGroup(index, gid)}
                            onWrapInNewGroup={() => wrapInNewGroup(index)}
                        />
                    </div>
                );
            })}
        </div>
    );
}

// ─── Row components ───────────────────────────────────────────────────────────

function DragHandle() {
    return (
        <span
            title={t("toolbar_customization.drag_hint")}
            style={{ cursor: "grab", marginRight: "6px", color: "var(--bs-secondary-color, #6c757d)" }}
        >
            ⠿
        </span>
    );
}

interface SeparatorRowProps {
    onRemove: () => void;
}
function SeparatorRow({ onRemove }: SeparatorRowProps) {
    return (
        <div style={{ display: "flex", alignItems: "center", padding: "2px 0", gap: "6px" }}>
            <DragHandle />
            <span style={{ flex: 1, borderTop: "1px solid var(--bs-border-color, #dee2e6)" }} />
            <button
                type="button"
                className="btn btn-sm btn-link p-0"
                title={t("toolbar_customization.remove_separator")}
                onClick={onRemove}
                style={{ color: "var(--bs-danger, #dc3545)", lineHeight: 1 }}
            >
                ×
            </button>
        </div>
    );
}

interface ItemRowProps {
    item: ToolbarItem;
    onToggleVisible: () => void;
    onAddSeparatorBefore: () => void;
    availableGroups: ToolbarGroup[];
    onMoveIntoGroup: (groupId: string) => void;
    onWrapInNewGroup: () => void;
}
function ItemRow({
    item, onToggleVisible, onAddSeparatorBefore, availableGroups, onMoveIntoGroup, onWrapInNewGroup
}: ItemRowProps) {
    const [showMenu, setShowMenu] = useState(false);

    return (
        <div style={{ display: "flex", alignItems: "center", padding: "3px 0", gap: "6px", position: "relative" }}>
            <DragHandle />
            <input
                type="checkbox"
                checked={item.visible}
                onChange={onToggleVisible}
                title={item.visible ? t("toolbar_customization.hide_item") : t("toolbar_customization.show_item")}
                style={{ cursor: "pointer" }}
            />
            <span style={{ flex: 1, opacity: item.visible ? 1 : 0.45 }}>
                {getItemLabel(item.id)}
            </span>

            {/* Actions menu */}
            <div style={{ position: "relative" }}>
                <button
                    type="button"
                    className="btn btn-sm btn-link p-0"
                    title={t("toolbar_customization.more_actions")}
                    onClick={() => setShowMenu((v) => !v)}
                    style={{ color: "var(--bs-secondary-color, #6c757d)", lineHeight: 1 }}
                >
                    ···
                </button>
                {showMenu && (
                    <ActionsMenu onClose={() => setShowMenu(false)}>
                        <MenuAction onClick={() => { onAddSeparatorBefore(); setShowMenu(false); }}>
                            {t("toolbar_customization.add_separator_before")}
                        </MenuAction>
                        {availableGroups.length > 0 && (
                            <>
                                <MenuDivider />
                                <MenuLabel>{t("toolbar_customization.move_into_group")}</MenuLabel>
                                {availableGroups.map((g) => (
                                    <MenuAction
                                        key={g.id}
                                        onClick={() => { onMoveIntoGroup(g.id); setShowMenu(false); }}
                                    >
                                        {g.label}
                                    </MenuAction>
                                ))}
                            </>
                        )}
                        <MenuDivider />
                        <MenuAction onClick={() => { onWrapInNewGroup(); setShowMenu(false); }}>
                            {t("toolbar_customization.create_group")}
                        </MenuAction>
                    </ActionsMenu>
                )}
            </div>
        </div>
    );
}

interface GroupRowProps {
    group: ToolbarGroup;
    expanded: boolean;
    onToggleExpand: () => void;
    onToggleVisible: () => void;
    onChildVisibleToggle: (childIndex: number) => void;
    onChildReorder: (from: number, to: number) => void;
    onChildAddSeparatorBefore: (childIndex: number) => void;
    onChildRemoveSeparator: (childIndex: number) => void;
    onChildMoveOut: (childIndex: number) => void;
}
function GroupRow({
    group, expanded, onToggleExpand, onToggleVisible,
    onChildVisibleToggle, onChildReorder, onChildAddSeparatorBefore,
    onChildRemoveSeparator, onChildMoveOut
}: GroupRowProps) {
    const [childDragIndex, setChildDragIndex] = useState<number | null>(null);
    const [childDropIndex, setChildDropIndex] = useState<number | null>(null);

    function handleChildDrop(e: DragEvent, to: number) {
        e.preventDefault();
        e.stopPropagation();
        if (childDragIndex !== null && childDragIndex !== to) {
            onChildReorder(childDragIndex, to);
        }
        setChildDragIndex(null);
        setChildDropIndex(null);
    }

    return (
        <div>
            {/* Group header */}
            <div style={{ display: "flex", alignItems: "center", padding: "3px 0", gap: "6px" }}>
                <DragHandle />
                <input
                    type="checkbox"
                    checked={group.visible}
                    onChange={onToggleVisible}
                    title={group.visible ? t("toolbar_customization.hide_item") : t("toolbar_customization.show_item")}
                    style={{ cursor: "pointer" }}
                />
                <span style={{ flex: 1, opacity: group.visible ? 1 : 0.45, fontWeight: 500 }}>
                    {group.label}
                    <span style={{ marginLeft: "4px", fontSize: "0.75em", color: "var(--bs-secondary-color, #6c757d)" }}>
                        ({t("toolbar_customization.group")})
                    </span>
                </span>
                <button
                    type="button"
                    className="btn btn-sm btn-link p-0"
                    onClick={onToggleExpand}
                    title={expanded ? t("toolbar_customization.collapse") : t("toolbar_customization.expand")}
                    style={{ color: "var(--bs-secondary-color, #6c757d)", lineHeight: 1 }}
                >
                    {expanded ? "▲" : "▼"}
                </button>
            </div>

            {/* Group children */}
            {expanded && (
                <div style={{ paddingLeft: "28px", borderLeft: "2px solid var(--bs-border-color, #dee2e6)", marginLeft: "10px" }}>
                    {group.items.map((child, ci) => {
                        const isChildDropTarget = childDropIndex === ci && childDragIndex !== null && childDragIndex !== ci;
                        const isDragging = childDragIndex === ci;

                        const childDndProps = {
                            draggable: true as true,
                            onDragStart: (e: DragEvent) => { e.stopPropagation(); setChildDragIndex(ci); },
                            onDragOver: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setChildDropIndex(ci); },
                            onDrop: (e: DragEvent) => handleChildDrop(e, ci),
                            onDragEnd: () => { setChildDragIndex(null); setChildDropIndex(null); }
                        };

                        const childRowStyle = {
                            opacity: isDragging ? 0.4 : 1,
                            borderTop: isChildDropTarget ? "2px solid var(--bs-primary, #0d6efd)" : "2px solid transparent"
                        };

                        if (child.kind === "separator") {
                            return (
                                <div key={`child-sep-${ci}`} style={childRowStyle} {...childDndProps}>
                                    <div style={{ display: "flex", alignItems: "center", padding: "2px 0", gap: "4px" }}>
                                        <DragHandle />
                                        <span style={{ flex: 1, borderTop: "1px solid var(--bs-border-color, #dee2e6)" }} />
                                        <button
                                            type="button"
                                            className="btn btn-sm btn-link p-0"
                                            title={t("toolbar_customization.remove_separator")}
                                            onClick={() => onChildRemoveSeparator(ci)}
                                            style={{ color: "var(--bs-danger, #dc3545)", lineHeight: 1 }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                </div>
                            );
                        }

                        const childItem = child as ToolbarItem;
                        return (
                            <div key={childItem.id} style={childRowStyle} {...childDndProps}>
                                <div style={{ display: "flex", alignItems: "center", padding: "2px 0", gap: "4px" }}>
                                    <DragHandle />
                                    <input
                                        type="checkbox"
                                        checked={childItem.visible}
                                        onChange={() => onChildVisibleToggle(ci)}
                                        style={{ cursor: "pointer" }}
                                    />
                                    <span style={{ flex: 1, opacity: childItem.visible ? 1 : 0.45, fontSize: "0.9em" }}>
                                        {getItemLabel(childItem.id)}
                                    </span>
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-link p-0"
                                        title={t("toolbar_customization.add_separator_before")}
                                        onClick={() => onChildAddSeparatorBefore(ci)}
                                        style={{ color: "var(--bs-secondary-color, #6c757d)", lineHeight: 1, fontSize: "0.8em" }}
                                    >
                                        +|
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-sm btn-link p-0"
                                        title={t("toolbar_customization.move_out_of_group")}
                                        onClick={() => onChildMoveOut(ci)}
                                        style={{ color: "var(--bs-secondary-color, #6c757d)", lineHeight: 1, fontSize: "0.8em" }}
                                    >
                                        ↑
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ─── Small drop-down menu helpers ────────────────────────────────────────────

function ActionsMenu({ children, onClose }: { children: preact.ComponentChildren; onClose: () => void }) {
    return (
        <>
            {/* Invisible backdrop to close the menu on outside click */}
            <div
                style={{ position: "fixed", inset: 0, zIndex: 999 }}
                onClick={onClose}
            />
            <div
                style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    zIndex: 1000,
                    minWidth: "180px",
                    background: "var(--bs-dropdown-bg, #fff)",
                    border: "1px solid var(--bs-border-color, #dee2e6)",
                    borderRadius: "4px",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                    padding: "4px 0"
                }}
            >
                {children}
            </div>
        </>
    );
}

function MenuAction({ children, onClick }: { children: preact.ComponentChildren; onClick: () => void }) {
    return (
        <button
            type="button"
            className="dropdown-item"
            onClick={onClick}
            style={{ fontSize: "0.85em" }}
        >
            {children}
        </button>
    );
}

function MenuLabel({ children }: { children: preact.ComponentChildren }) {
    return (
        <span
            className="dropdown-header"
            style={{ fontSize: "0.75em" }}
        >
            {children}
        </span>
    );
}

function MenuDivider() {
    return <div className="dropdown-divider" />;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseConfig(raw: string): ToolbarCustomConfig {
    if (!raw) {
        return getDefaultConfig();
    }
    try {
        return JSON.parse(raw) as ToolbarCustomConfig;
    } catch {
        return getDefaultConfig();
    }
}
