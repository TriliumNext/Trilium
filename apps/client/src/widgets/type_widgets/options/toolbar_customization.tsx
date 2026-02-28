/**
 * Toolbar customization – horizontal chip-based drag-and-drop editor.
 *
 * Layout
 * ──────
 *  [Classic] [Floating] [Block]
 *  ┌──────────────────────────────────────────────┐  ← active toolbar bar
 *  │ [⠿ Heading ×] [⠿ Font ×] │ [⠿ Bold ×] [⠿ ···(7)▼ ×] │          │
 *  └──────────────────────────────────────────────┘
 *  (expanded group row when ▼ is open)
 *  ┌──────────────────────────────────────────────┐  ← available items bar
 *  │ [⠿ Format Painter] [⠿ Subscript] …                               │
 *  └──────────────────────────────────────────────┘
 *  [+ Separator] [+ Group ···]        [↺ Reset]  [▶ Save & Reload]
 *
 * Changes stay in local state until "Save & Reload" is clicked.
 */
import { useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { useTriliumOption } from "../../react/hooks";
import OptionsSection from "./components/OptionsSection";
import {
    DEFAULT_BLOCK_TOOLBAR,
    DEFAULT_CLASSIC_TOOLBAR,
    DEFAULT_FLOATING_TOOLBAR,
    getDefaultConfig,
    getItemLabel,
    TOOLBAR_ITEM_LABELS,
    type ToolbarCustomConfig,
    type ToolbarEntry,
    type ToolbarGroup,
    type ToolbarItem,
    type ToolbarSeparator,
} from "../text/toolbar_config";

type TabKey = "classic" | "floating" | "blockToolbar";

const DEFAULT_TABS: Record<TabKey, ToolbarEntry[]> = {
    classic: DEFAULT_CLASSIC_TOOLBAR,
    floating: DEFAULT_FLOATING_TOOLBAR,
    blockToolbar: DEFAULT_BLOCK_TOOLBAR,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseConfig(raw: string): ToolbarCustomConfig {
    if (!raw) return getDefaultConfig();
    try { return JSON.parse(raw) as ToolbarCustomConfig; }
    catch { return getDefaultConfig(); }
}

function collectItemIds(entries: ToolbarEntry[]): string[] {
    const ids: string[] = [];
    for (const e of entries) {
        if (e.kind === "item") ids.push(e.id);
        else if (e.kind === "group") {
            for (const c of e.items) if (c.kind === "item") ids.push(c.id);
        }
    }
    return ids;
}

/** All item IDs from DEFAULT_TABS[tab] that are not already in activeEntries. */
function getPool(tab: TabKey, activeEntries: ToolbarEntry[]): string[] {
    const used = new Set(collectItemIds(activeEntries));
    const allKnown = Object.keys(TOOLBAR_ITEM_LABELS);
    return allKnown.filter(id => !used.has(id));
}

function entryKey(e: ToolbarEntry, i: number): string {
    if (e.kind === "separator") return `sep-${i}`;
    if (e.kind === "group") return `grp-${e.id}-${i}`;
    return `item-${e.id}`;
}

/** Where the pointer is relative to the chip mid-point → insert index. */
function insertIdx(e: DragEvent, chipIdx: number): number {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    return e.clientX < rect.left + rect.width / 2 ? chipIdx : chipIdx + 1;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ToolbarCustomization() {
    const [savedRaw, setSavedRaw] = useTriliumOption("textNoteToolbarConfig");
    const [local, setLocal] = useState<ToolbarCustomConfig>(() => parseConfig(savedRaw));
    const [tab, setTab] = useState<TabKey>("classic");

    const isDirty = JSON.stringify(local) !== JSON.stringify(parseConfig(savedRaw));

    function updateTab(newEntries: ToolbarEntry[]) {
        setLocal(prev => ({ ...prev, [tab]: newEntries }));
    }

    function reset() {
        setLocal(getDefaultConfig());
    }

    function saveAndReload() {
        setSavedRaw(JSON.stringify(local));
        setTimeout(() => window.location.reload(), 120);
    }

    const TAB_LABEL: Record<TabKey, string> = {
        classic: t("toolbar_customization.tab_classic"),
        floating: t("toolbar_customization.tab_floating"),
        blockToolbar: t("toolbar_customization.tab_block"),
    };

    return (
        <OptionsSection title={t("toolbar_customization.title")}>
            <p className="form-text mb-2" style={{ fontSize: "0.84em" }}>
                {t("toolbar_customization.description")}
            </p>

            {/* Tabs */}
            <ul className="nav nav-tabs mb-0">
                {(["classic", "floating", "blockToolbar"] as TabKey[]).map(k => (
                    <li className="nav-item" key={k}>
                        <a
                            className={`nav-link${tab === k ? " active" : ""}`}
                            style={{ cursor: "pointer", padding: "5px 12px", fontSize: "0.88em" }}
                            onClick={() => setTab(k)}
                        >
                            {TAB_LABEL[k]}
                        </a>
                    </li>
                ))}
            </ul>

            <HorizontalEditor
                key={tab}
                tab={tab}
                entries={local[tab]}
                onChange={updateTab}
            />

            {/* Bottom action bar */}
            <div className="mt-2 d-flex justify-content-between align-items-center">
                <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={reset}
                    title={t("toolbar_customization.reset_title")}
                >
                    ↺ {t("toolbar_customization.reset")}
                </button>
                <button
                    type="button"
                    className={`btn btn-sm ${isDirty ? "btn-primary" : "btn-outline-primary"}`}
                    onClick={saveAndReload}
                    title={t("toolbar_customization.save_title")}
                >
                    ▶ {t("toolbar_customization.save")}
                </button>
            </div>
        </OptionsSection>
    );
}

// ─── Horizontal editor (two bars) ─────────────────────────────────────────────

type DragSrc =
    | { from: "pool"; id: string }
    | { from: "active"; idx: number }
    | { from: "child"; groupIdx: number; childIdx: number };

interface HorizEditorProps {
    tab: TabKey;
    entries: ToolbarEntry[];
    onChange: (e: ToolbarEntry[]) => void;
}

function HorizontalEditor({ tab, entries, onChange }: HorizEditorProps) {
    const pool = getPool(tab, entries);

    // Drag state
    const [drag, setDrag]               = useState<DragSrc | null>(null);
    const [dropIdx, setDropIdx]         = useState<number | null>(null);
    const [overPool, setOverPool]       = useState(false);
    const [expandedGroup, setExpanded]  = useState<string | null>(null);
    const [childDropIdx, setChildDrop]  = useState<number | null>(null);

    // ── Mutations ─────────────────────────────────────────────────────────────

    function commit(next: ToolbarEntry[]) {
        onChange(next.map(e => {
            if (e.kind === "item")  return { ...e, visible: true };
            if (e.kind === "group") return { ...e, visible: true, items: e.items.map(c => c.kind === "item" ? { ...c, visible: true } : c) };
            return e;
        }));
    }

    function addItemAt(id: string, at: number) {
        const next = [...entries];
        next.splice(at, 0, { kind: "item", id, visible: true } as ToolbarItem);
        commit(next);
    }

    function moveActive(from: number, to: number) {
        if (from === to) return;
        const next = [...entries];
        const [m] = next.splice(from, 1);
        next.splice(to > from ? to - 1 : to, 0, m);
        commit(next);
    }

    function removeActive(idx: number) {
        commit(entries.filter((_, i) => i !== idx));
    }

    function addSeparator() {
        commit([...entries, { kind: "separator" } as ToolbarSeparator]);
    }

    function addGroup() {
        const id = `group_${Date.now()}`;
        const g: ToolbarGroup = { kind: "group", id, label: "Group", icon: "threeVerticalDots", visible: true, items: [] };
        commit([...entries, g]);
        setExpanded(id);
    }

    function addItemToGroup(groupIdx: number, id: string) {
        const next = [...entries];
        const g = { ...(next[groupIdx] as ToolbarGroup) };
        g.items = [...g.items, { kind: "item", id, visible: true } as ToolbarItem];
        next[groupIdx] = g;
        commit(next);
    }

    function removeChildFromGroup(groupIdx: number, childIdx: number) {
        const next = [...entries];
        const g = { ...(next[groupIdx] as ToolbarGroup) };
        g.items = g.items.filter((_, i) => i !== childIdx);
        next[groupIdx] = g;
        commit(next);
    }

    function moveChild(groupIdx: number, from: number, to: number) {
        if (from === to) return;
        const next = [...entries];
        const g = { ...(next[groupIdx] as ToolbarGroup) };
        const ch = [...g.items];
        const [m] = ch.splice(from, 1);
        ch.splice(to > from ? to - 1 : to, 0, m);
        g.items = ch;
        next[groupIdx] = g;
        commit(next);
    }

    // ── Drag helpers ──────────────────────────────────────────────────────────

    function startDrag(e: DragEvent, src: DragSrc) {
        setDrag(src);
        e.dataTransfer!.effectAllowed = "move";
    }

    function clearDrag() { setDrag(null); setDropIdx(null); setOverPool(false); setChildDrop(null); }

    // Drop on active bar at position idx
    function onActiveDrop(e: DragEvent, at: number) {
        e.preventDefault();
        if (!drag) return;
        if (drag.from === "pool")   addItemAt(drag.id, at);
        else if (drag.from === "active") moveActive(drag.idx, at);
        clearDrag();
    }

    function onActiveOver(e: DragEvent, chipIdx: number) {
        e.preventDefault();
        setDropIdx(insertIdx(e, chipIdx));
        setOverPool(false);
    }

    // Drop on group chip → add item to that group
    function onGroupDrop(e: DragEvent, groupIdx: number) {
        e.preventDefault();
        e.stopPropagation();
        if (!drag) return;
        if (drag.from === "pool") addItemToGroup(groupIdx, drag.id);
        clearDrag();
    }

    // Drop on pool → remove from active
    function onPoolDrop(e: DragEvent) {
        e.preventDefault();
        if (!drag) return;
        if (drag.from === "active") removeActive(drag.idx);
        else if (drag.from === "child") removeChildFromGroup(drag.groupIdx, drag.childIdx);
        clearDrag();
    }

    // Drop on group child row at position ci
    function onChildDrop(e: DragEvent, groupIdx: number, ci: number) {
        e.preventDefault();
        e.stopPropagation();
        if (!drag) return;
        if (drag.from === "pool") {
            addItemToGroup(groupIdx, drag.id);
        } else if (drag.from === "child" && drag.groupIdx === groupIdx) {
            moveChild(groupIdx, drag.childIdx, ci);
        }
        clearDrag();
    }

    // ── Styles ────────────────────────────────────────────────────────────────

    const barStyle = (highlight?: boolean): preact.JSX.CSSProperties => ({
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "3px",
        minHeight: "44px",
        padding: "6px 8px",
        border: `2px ${highlight ? "dashed var(--bs-danger, #dc3545)" : "dashed var(--bs-border-color, #dee2e6)"}`,
        borderRadius: "5px",
        background: highlight ? "var(--bs-danger-bg-subtle, #fff3f3)" : "var(--bs-tertiary-bg, #f8f9fa)",
        transition: "border-color 0.15s, background 0.15s",
    });

    const lblStyle: preact.JSX.CSSProperties = {
        fontSize: "0.76em", fontWeight: 600,
        color: "var(--bs-secondary-color, #6c757d)",
        marginBottom: "3px", marginTop: "10px",
    };

    // ── Render ────────────────────────────────────────────────────────────────

    // Which entry is being dragged (for opacity)
    const draggingIdx = drag?.from === "active" ? drag.idx : null;

    return (
        <div style={{ border: "1px solid var(--bs-border-color, #dee2e6)", borderTop: "none", borderRadius: "0 0 5px 5px", padding: "10px" }}>

            {/* ── Active toolbar bar ──────────────────────────────────────── */}
            <div style={lblStyle}>{t("toolbar_customization.active")}</div>
            <div
                style={barStyle()}
                onDragOver={e => { e.preventDefault(); setDropIdx(entries.length); setOverPool(false); }}
                onDrop={e => onActiveDrop(e as DragEvent, entries.length)}
            >
                {entries.length === 0 && (
                    <span style={{ color: "var(--bs-secondary-color, #6c757d)", fontSize: "0.82em" }}>
                        {t("toolbar_customization.drag_here")}
                    </span>
                )}

                {entries.map((entry, i) => (
                    <span key={entryKey(entry, i)} style={{ display: "contents" }}>
                        {/* Blue drop indicator line before this chip */}
                        <DropLine active={dropIdx === i} />

                        {entry.kind === "separator" ? (
                            <SepChip
                                isDragging={draggingIdx === i}
                                onDragStart={e => startDrag(e as DragEvent, { from: "active", idx: i })}
                                onDragEnd={clearDrag}
                                onDragOver={e => onActiveOver(e as DragEvent, i)}
                                onDrop={e => onActiveDrop(e as DragEvent, insertIdx(e as DragEvent, i))}
                                onRemove={() => removeActive(i)}
                            />
                        ) : entry.kind === "group" ? (
                            <GroupChip
                                group={entry}
                                isDragging={draggingIdx === i}
                                expanded={expandedGroup === entry.id}
                                onToggle={() => setExpanded(prev => prev === entry.id ? null : entry.id)}
                                onDragStart={e => startDrag(e as DragEvent, { from: "active", idx: i })}
                                onDragEnd={clearDrag}
                                onDragOver={e => onActiveOver(e as DragEvent, i)}
                                onDrop={e => onGroupDrop(e as DragEvent, i)}
                                onRemove={() => removeActive(i)}
                            />
                        ) : (
                            <ItemChip
                                label={getItemLabel(entry.id)}
                                isDragging={draggingIdx === i}
                                onDragStart={e => startDrag(e as DragEvent, { from: "active", idx: i })}
                                onDragEnd={clearDrag}
                                onDragOver={e => onActiveOver(e as DragEvent, i)}
                                onDrop={e => onActiveDrop(e as DragEvent, insertIdx(e as DragEvent, i))}
                                onRemove={() => removeActive(i)}
                            />
                        )}
                    </span>
                ))}

                {/* Final drop indicator */}
                <DropLine active={dropIdx === entries.length} />
            </div>

            {/* ── Expanded group children row ─────────────────────────────── */}
            {expandedGroup && (() => {
                const gi = entries.findIndex(e => e.kind === "group" && (e as ToolbarGroup).id === expandedGroup);
                if (gi === -1) return null;
                const g = entries[gi] as ToolbarGroup;
                return (
                    <div style={{ marginTop: "4px", paddingLeft: "16px" }}>
                        <div style={{ ...lblStyle, marginTop: "0" }}>
                            ↳ {g.label} {t("toolbar_customization.group_contents")}
                        </div>
                        <div
                            style={{ ...barStyle(), background: "var(--bs-secondary-bg, #e9ecef)", minHeight: "38px" }}
                            onDragOver={e => { e.preventDefault(); setChildDrop(g.items.length); setOverPool(false); }}
                            onDrop={e => onChildDrop(e as DragEvent, gi, g.items.length)}
                        >
                            {g.items.length === 0 && (
                                <span style={{ color: "var(--bs-secondary-color, #6c757d)", fontSize: "0.82em" }}>
                                    {t("toolbar_customization.group_empty")}
                                </span>
                            )}
                            {g.items.map((c, ci) => (
                                <span key={c.kind === "item" ? c.id : `csep-${ci}`} style={{ display: "contents" }}>
                                    <DropLine active={childDropIdx === ci} />
                                    {c.kind === "separator" ? (
                                        <SepChip
                                            isDragging={drag?.from === "child" && drag.groupIdx === gi && drag.childIdx === ci}
                                            onDragStart={e => startDrag(e as DragEvent, { from: "child", groupIdx: gi, childIdx: ci })}
                                            onDragEnd={clearDrag}
                                            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setChildDrop(insertIdx(e as DragEvent, ci)); }}
                                            onDrop={e => onChildDrop(e as DragEvent, gi, insertIdx(e as DragEvent, ci))}
                                            onRemove={() => removeChildFromGroup(gi, ci)}
                                        />
                                    ) : (
                                        <ItemChip
                                            label={getItemLabel(c.id)}
                                            isDragging={drag?.from === "child" && drag.groupIdx === gi && drag.childIdx === ci}
                                            onDragStart={e => startDrag(e as DragEvent, { from: "child", groupIdx: gi, childIdx: ci })}
                                            onDragEnd={clearDrag}
                                            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setChildDrop(insertIdx(e as DragEvent, ci)); }}
                                            onDrop={e => onChildDrop(e as DragEvent, gi, insertIdx(e as DragEvent, ci))}
                                            onRemove={() => removeChildFromGroup(gi, ci)}
                                        />
                                    )}
                                </span>
                            ))}
                            <DropLine active={childDropIdx === g.items.length} />
                        </div>
                    </div>
                );
            })()}

            {/* ── Toolbar action buttons ──────────────────────────────────── */}
            <div className="mt-2 d-flex gap-2">
                <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={addSeparator}
                    title={t("toolbar_customization.add_separator_hint")}
                >
                    + │ {t("toolbar_customization.add_separator")}
                </button>
                <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={addGroup}
                    title={t("toolbar_customization.add_group_hint")}
                >
                    + ··· {t("toolbar_customization.add_group")}
                </button>
            </div>

            {/* ── Available items bar ─────────────────────────────────────── */}
            <div style={lblStyle}>{t("toolbar_customization.available")}</div>
            <div
                style={barStyle(overPool)}
                onDragOver={e => { e.preventDefault(); setOverPool(true); }}
                onDragLeave={() => setOverPool(false)}
                onDrop={onPoolDrop}
            >
                {pool.length === 0 ? (
                    <span style={{ color: "var(--bs-secondary-color, #6c757d)", fontSize: "0.82em" }}>
                        {t("toolbar_customization.all_active")}
                    </span>
                ) : pool.map(id => (
                    <div
                        key={id}
                        draggable
                        onDragStart={e => startDrag(e as DragEvent, { from: "pool", id })}
                        onDragEnd={clearDrag}
                        style={{
                            display: "inline-flex", alignItems: "center", gap: "4px",
                            padding: "3px 8px", borderRadius: "4px",
                            border: "1px solid var(--bs-border-color, #dee2e6)",
                            background: "var(--bs-body-bg, #fff)",
                            cursor: "grab", fontSize: "0.82em", userSelect: "none",
                        }}
                        title={t("toolbar_customization.drag_to_add")}
                    >
                        <Grip />{getItemLabel(id)}
                    </div>
                ))}
            </div>
            <div style={{ fontSize: "0.75em", color: "var(--bs-secondary-color, #6c757d)", marginTop: "3px" }}>
                ↑ {t("toolbar_customization.drag_hint_pool")} &nbsp;|&nbsp; ↓ {t("toolbar_customization.drag_hint_active")}
            </div>
        </div>
    );
}

// ─── Chip components ──────────────────────────────────────────────────────────

interface ChipBaseProps {
    isDragging: boolean;
    onDragStart: (e: Event) => void;
    onDragEnd: () => void;
    onDragOver: (e: Event) => void;
    onDrop: (e: Event) => void;
    onRemove: () => void;
}

const chipBase: preact.JSX.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "3px",
    padding: "3px 7px", borderRadius: "4px",
    border: "1px solid var(--bs-border-color, #dee2e6)",
    background: "var(--bs-body-bg, #fff)",
    cursor: "grab", fontSize: "0.82em", userSelect: "none",
    transition: "opacity 0.12s",
};

function ItemChip({ label, isDragging, onDragStart, onDragEnd, onDragOver, onDrop, onRemove }: ChipBaseProps & { label: string }) {
    return (
        <div
            draggable
            style={{ ...chipBase, opacity: isDragging ? 0.3 : 1 }}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            <Grip />{label}<Xbtn onClick={onRemove} />
        </div>
    );
}

function SepChip({ isDragging, onDragStart, onDragEnd, onDragOver, onDrop, onRemove }: ChipBaseProps) {
    return (
        <div
            draggable
            style={{ ...chipBase, padding: "3px 6px", opacity: isDragging ? 0.3 : 1, color: "var(--bs-secondary-color, #6c757d)" }}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            title={t("toolbar_customization.separator")}
        >
            <Grip />
            <span style={{ width: "1px", height: "16px", background: "currentColor", display: "inline-block" }} />
            <Xbtn onClick={onRemove} />
        </div>
    );
}

interface GroupChipProps extends ChipBaseProps {
    group: ToolbarGroup;
    expanded: boolean;
    onToggle: () => void;
}

function GroupChip({ group, expanded, isDragging, onToggle, onDragStart, onDragEnd, onDragOver, onDrop, onRemove }: GroupChipProps) {
    return (
        <div
            draggable
            style={{ ...chipBase, opacity: isDragging ? 0.3 : 1, background: "var(--bs-secondary-bg, #e9ecef)" }}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            title={t("toolbar_customization.drop_on_group")}
        >
            <Grip />
            <span>···</span>
            <span style={{ fontStyle: "italic", fontSize: "0.9em" }}>{group.label}</span>
            <span style={{ fontSize: "0.8em", color: "var(--bs-secondary-color, #6c757d)" }}>({group.items.length})</span>
            <button
                type="button"
                className="btn btn-link btn-sm p-0"
                style={{ fontSize: "0.7em", lineHeight: 1, color: "inherit" }}
                onClick={e => { e.stopPropagation(); onToggle(); }}
                title={expanded ? t("toolbar_customization.collapse") : t("toolbar_customization.expand")}
            >
                {expanded ? "▲" : "▼"}
            </button>
            <Xbtn onClick={onRemove} />
        </div>
    );
}

// ─── Micro components ─────────────────────────────────────────────────────────

function Grip() {
    return <span style={{ cursor: "grab", color: "var(--bs-secondary-color, #6c757d)", userSelect: "none", flexShrink: 0, fontSize: "0.9em" }}>⠿</span>;
}

function Xbtn({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            className="btn btn-link btn-sm p-0"
            onClick={e => { e.stopPropagation(); onClick(); }}
            style={{ color: "var(--bs-danger, #dc3545)", lineHeight: 1, flexShrink: 0, marginLeft: "2px" }}
            title={t("toolbar_customization.remove_item")}
        >×</button>
    );
}

function DropLine({ active }: { active: boolean }) {
    return (
        <div style={{
            width: active ? "3px" : "1px",
            height: "24px",
            borderRadius: "2px",
            background: active ? "var(--bs-primary, #0d6efd)" : "transparent",
            flexShrink: 0,
            transition: "width 0.08s, background 0.08s",
        }} />
    );
}
