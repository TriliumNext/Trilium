/**
 * Two-column drag-and-drop toolbar editor.
 *
 * Left  column  – available items (not currently in the toolbar)
 * Right column  – active toolbar (ordered; drag to reorder)
 *
 * Drag from left  → right : adds item
 * Drag from right → left  : removes item
 * Drag within right        : reorders
 *
 * Changes are saved immediately without a page reload.
 * A small notice asks the user to reopen the note to see the effect.
 */
import { useMemo, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { useTriliumOption } from "../../react/hooks";
import OptionsSection from "./components/OptionsSection";
import {
    DEFAULT_BLOCK_TOOLBAR,
    DEFAULT_CLASSIC_TOOLBAR,
    DEFAULT_FLOATING_TOOLBAR,
    getDefaultConfig,
    getItemLabel,
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

// ─── Utility ──────────────────────────────────────────────────────────────────

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

function parseConfig(raw: string): ToolbarCustomConfig {
    if (!raw) return getDefaultConfig();
    try { return JSON.parse(raw) as ToolbarCustomConfig; }
    catch { return getDefaultConfig(); }
}

/** Items visible in the active column (visible=true + separators + groups). */
function activeOnly(entries: ToolbarEntry[]): ToolbarEntry[] {
    return entries.filter(e =>
        e.kind === "separator" ||
        (e as ToolbarItem | ToolbarGroup).visible !== false
    );
}

/** Item IDs from allKnownIds that are NOT present in active entries. */
function availablePool(active: ToolbarEntry[], allKnown: string[]): string[] {
    const used = new Set(collectItemIds(active));
    return allKnown.filter(id => !used.has(id));
}

function entryKey(e: ToolbarEntry, i: number) {
    if (e.kind === "separator") return `sep-${i}`;
    if (e.kind === "group") return `grp-${e.id}`;
    return `item-${e.id}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ToolbarCustomization() {
    // No needsRefresh – we handle the "reload note" notice ourselves
    const [rawConfig, setRawConfig] = useTriliumOption("textNoteToolbarConfig");
    const [tab, setTab] = useState<TabKey>("classic");
    const [dirty, setDirty] = useState(false);

    const config = useMemo(() => parseConfig(rawConfig), [rawConfig]);

    function save(newEntries: ToolbarEntry[]) {
        setRawConfig(JSON.stringify({ ...config, [tab]: newEntries }));
        setDirty(true);
    }

    function reset() {
        setRawConfig("");
        setDirty(true);
    }

    const TAB_LABEL: Record<TabKey, string> = {
        classic: t("toolbar_customization.tab_classic"),
        floating: t("toolbar_customization.tab_floating"),
        blockToolbar: t("toolbar_customization.tab_block"),
    };

    return (
        <OptionsSection title={t("toolbar_customization.title")}>
            <p className="form-text mb-2" style={{ fontSize: "0.85em" }}>
                {t("toolbar_customization.description")}
            </p>

            {dirty && (
                <div className="alert alert-info py-1 px-2 mb-2" style={{ fontSize: "0.82em" }}>
                    {t("toolbar_customization.reload_note")}
                </div>
            )}

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

            {/* Two-column editor */}
            <ToolbarEditor
                key={tab}
                tabKey={tab}
                entries={config[tab]}
                onChange={save}
            />

            <div className="mt-2">
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={reset}>
                    ↺ {t("toolbar_customization.reset")}
                </button>
            </div>
        </OptionsSection>
    );
}

// ─── Two-column editor ────────────────────────────────────────────────────────

type DragPayload =
    | { src: "pool"; id: string }
    | { src: "active"; idx: number };

const COL_H = "300px";

interface EditorProps {
    tabKey: TabKey;
    entries: ToolbarEntry[];
    onChange: (e: ToolbarEntry[]) => void;
}

function ToolbarEditor({ tabKey, entries, onChange }: EditorProps) {
    const allKnown = useMemo(() => collectItemIds(DEFAULT_TABS[tabKey]), [tabKey]);
    const active   = useMemo(() => activeOnly(entries), [entries]);
    const pool     = useMemo(() => availablePool(active, allKnown), [active, allKnown]);

    // Drag state
    const [drag, setDrag]           = useState<DragPayload | null>(null);
    const [dropIdx, setDropIdx]     = useState<number | null>(null);
    const [overPool, setOverPool]   = useState(false);

    // ── Mutations ─────────────────────────────────────────────────────────────

    function commitActive(next: ToolbarEntry[]) {
        onChange(next.map(e => {
            if (e.kind === "item")  return { ...e, visible: true };
            if (e.kind === "group") return { ...e, visible: true, items: e.items.map(c => c.kind === "item" ? { ...c, visible: true } : c) };
            return e;
        }));
    }

    function addItem(id: string, atIdx: number) {
        const next = [...active];
        next.splice(atIdx, 0, { kind: "item", id, visible: true } as ToolbarItem);
        commitActive(next);
    }

    function moveItem(from: number, to: number) {
        if (from === to) return;
        const next = [...active];
        const [moved] = next.splice(from, 1);
        next.splice(to > from ? to - 1 : to, 0, moved);
        commitActive(next);
    }

    function removeIdx(idx: number) {
        commitActive(active.filter((_, i) => i !== idx));
    }

    function addSeparator() {
        commitActive([...active, { kind: "separator" } as ToolbarSeparator]);
    }

    function reorderChild(groupIdx: number, from: number, to: number) {
        if (from === to) return;
        const next = [...active];
        const g = { ...(next[groupIdx] as ToolbarGroup) };
        const ch = [...g.items];
        const [m] = ch.splice(from, 1);
        ch.splice(to > from ? to - 1 : to, 0, m);
        g.items = ch;
        next[groupIdx] = g;
        commitActive(next);
    }

    // ── Generic drag handlers ─────────────────────────────────────────────────

    function startDrag(e: DragEvent, payload: DragPayload) {
        setDrag(payload);
        e.dataTransfer!.effectAllowed = "move";
        e.dataTransfer!.setData("text/plain", JSON.stringify(payload));
    }

    function getPayload(e: DragEvent): DragPayload {
        return drag ?? JSON.parse(e.dataTransfer!.getData("text/plain"));
    }

    function clearDrag() { setDrag(null); setDropIdx(null); setOverPool(false); }

    // ── Drop into active column at position idx ───────────────────────────────

    function onActiveDrop(e: DragEvent, idx: number) {
        e.preventDefault();
        const p = getPayload(e);
        if (p.src === "pool") addItem(p.id, idx);
        else moveItem(p.idx, idx);
        clearDrag();
    }

    function onActiveOver(e: DragEvent, idx: number) {
        e.preventDefault();
        setDropIdx(idx);
        setOverPool(false);
    }

    // ── Drop into pool column (= remove from active) ──────────────────────────

    function onPoolDrop(e: DragEvent) {
        e.preventDefault();
        const p = getPayload(e);
        if (p.src === "active") removeIdx(p.idx);
        clearDrag();
    }

    // ── Render ────────────────────────────────────────────────────────────────

    const colStyle = (highlight?: boolean): preact.JSX.CSSProperties => ({
        height: COL_H,
        overflowY: "auto",
        border: `1px solid ${highlight ? "var(--bs-danger, #dc3545)" : "var(--bs-border-color, #dee2e6)"}`,
        borderRadius: "4px",
        background: highlight ? "var(--bs-danger-bg-subtle, #fff3f3)" : "var(--bs-body-bg, #fff)",
        padding: "4px 0",
        transition: "border-color 0.15s, background 0.15s",
    });

    const headerStyle: preact.JSX.CSSProperties = {
        fontSize: "0.78em",
        fontWeight: 600,
        color: "var(--bs-secondary-color, #6c757d)",
        marginBottom: "3px",
    };

    return (
        <div style={{ border: "1px solid var(--bs-border-color, #dee2e6)", borderTop: "none", borderRadius: "0 0 4px 4px", padding: "10px", display: "flex", gap: "10px" }}>
            {/* ── Left: pool ────────────────────────────────────────────── */}
            <div style={{ flex: "0 0 180px" }}>
                <div style={headerStyle}>{t("toolbar_customization.available")}</div>
                <div
                    style={colStyle(overPool)}
                    onDragOver={e => { e.preventDefault(); setOverPool(true); }}
                    onDragLeave={() => setOverPool(false)}
                    onDrop={onPoolDrop}
                >
                    {pool.length === 0 ? (
                        <EmptyMsg>{t("toolbar_customization.all_active")}</EmptyMsg>
                    ) : pool.map(id => (
                        <div
                            key={id}
                            draggable
                            onDragStart={e => startDrag(e as DragEvent, { src: "pool", id })}
                            onDragEnd={clearDrag}
                            style={{ padding: "3px 8px", cursor: "grab", fontSize: "0.83em", display: "flex", gap: "5px", userSelect: "none" }}
                        >
                            <Grip />{getItemLabel(id)}
                        </div>
                    ))}
                </div>
                <Hint>↔ {t("toolbar_customization.drag_hint_pool")}</Hint>
            </div>

            {/* ── Right: active ─────────────────────────────────────────── */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={headerStyle}>{t("toolbar_customization.active")}</div>
                <div style={colStyle()}>
                    {active.length === 0 && <EmptyMsg>{t("toolbar_customization.drag_here")}</EmptyMsg>}

                    {active.map((entry, i) => (
                        <div key={entryKey(entry, i)}>
                            {/* Drop zone BEFORE each entry */}
                            <DropZone
                                active={dropIdx === i && drag?.src !== "active" || (dropIdx === i && drag?.src === "active" && (drag as any).idx !== i)}
                                onDragOver={e => onActiveOver(e as DragEvent, i)}
                                onDrop={e => onActiveDrop(e as DragEvent, i)}
                            />
                            <ActiveRow
                                entry={entry}
                                index={i}
                                isDragging={drag?.src === "active" && (drag as any).idx === i}
                                onDragStart={e => startDrag(e as DragEvent, { src: "active", idx: i })}
                                onDragEnd={clearDrag}
                                onDragOver={e => onActiveOver(e as DragEvent, i)}
                                onDrop={e => onActiveDrop(e as DragEvent, i)}
                                onRemove={() => removeIdx(i)}
                                onChildReorder={(f, t2) => reorderChild(i, f, t2)}
                            />
                        </div>
                    ))}

                    {/* Drop zone at the very end */}
                    <DropZone
                        active={dropIdx === active.length}
                        onDragOver={e => onActiveOver(e as DragEvent, active.length)}
                        onDrop={e => onActiveDrop(e as DragEvent, active.length)}
                    />
                </div>
                <div style={{ display: "flex", gap: "8px", marginTop: "4px", alignItems: "center" }}>
                    <button type="button" className="btn btn-sm btn-outline-secondary" style={{ fontSize: "0.78em" }} onClick={addSeparator}>
                        + {t("toolbar_customization.add_separator")}
                    </button>
                    <Hint>{t("toolbar_customization.drag_hint_active")}</Hint>
                </div>
            </div>
        </div>
    );
}

// ─── Row rendered inside the active column ────────────────────────────────────

interface RowProps {
    entry: ToolbarEntry;
    index: number;
    isDragging: boolean;
    onDragStart: (e: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onRemove: () => void;
    onChildReorder: (from: number, to: number) => void;
}

function ActiveRow({ entry, index, isDragging, onDragStart, onDragEnd, onDragOver, onDrop, onRemove, onChildReorder }: RowProps) {
    const [expanded, setExpanded] = useState(false);
    const [childDrag, setChildDrag] = useState<number | null>(null);
    const [childDrop, setChildDrop] = useState<number | null>(null);

    const base: preact.JSX.CSSProperties = {
        opacity: isDragging ? 0.35 : 1,
        transition: "opacity 0.12s",
    };

    const dragHandlers = {
        draggable: true as true,
        onDragStart: onDragStart as any,
        onDragEnd: onDragEnd,
        onDragOver: onDragOver as any,
        onDrop: onDrop as any,
    };

    if (entry.kind === "separator") {
        return (
            <div style={base} {...dragHandlers}>
                <div style={{ display: "flex", alignItems: "center", padding: "2px 6px", gap: "4px" }}>
                    <Grip />
                    <span style={{ flex: 1, borderTop: "1px solid var(--bs-border-color, #dee2e6)" }} />
                    <Xbtn onClick={onRemove} />
                </div>
            </div>
        );
    }

    if (entry.kind === "group") {
        return (
            <div style={base} {...dragHandlers}>
                <div style={{ display: "flex", alignItems: "center", padding: "2px 6px", gap: "4px" }}>
                    <Grip />
                    <button type="button" className="btn btn-link btn-sm p-0" style={{ fontSize: "0.7em", lineHeight: 1 }} onClick={() => setExpanded(v => !v)}>
                        {expanded ? "▲" : "▼"}
                    </button>
                    <span style={{ flex: 1, fontWeight: 500, fontSize: "0.83em" }}>
                        {entry.label}
                        <span style={{ fontWeight: 400, color: "var(--bs-secondary-color, #6c757d)", marginLeft: "4px" }}>(···)</span>
                    </span>
                    <Xbtn onClick={onRemove} />
                </div>
                {expanded && (
                    <div style={{ paddingLeft: "18px", borderLeft: "2px solid var(--bs-border-color, #dee2e6)", marginLeft: "10px", marginBottom: "2px" }}>
                        {entry.items.map((c, ci) => (
                            <div
                                key={c.kind === "item" ? c.id : `sep-${ci}`}
                                draggable
                                style={{
                                    display: "flex", alignItems: "center", gap: "4px",
                                    padding: "2px 4px", fontSize: "0.8em", cursor: "grab",
                                    borderTop: childDrop === ci && childDrag !== null && childDrag !== ci ? "2px solid var(--bs-primary, #0d6efd)" : "2px solid transparent",
                                    opacity: childDrag === ci ? 0.35 : 1,
                                }}
                                onDragStart={e => { e.stopPropagation(); setChildDrag(ci); }}
                                onDragOver={e => { e.preventDefault(); e.stopPropagation(); setChildDrop(ci); }}
                                onDrop={e => { e.preventDefault(); e.stopPropagation(); if (childDrag !== null) onChildReorder(childDrag, ci); setChildDrag(null); setChildDrop(null); }}
                                onDragEnd={() => { setChildDrag(null); setChildDrop(null); }}
                            >
                                <Grip />
                                {c.kind === "separator"
                                    ? <span style={{ flex: 1, borderTop: "1px solid var(--bs-border-color, #dee2e6)" }} />
                                    : <span style={{ flex: 1 }}>{getItemLabel(c.id)}</span>
                                }
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // Plain item
    return (
        <div style={base} {...dragHandlers}>
            <div style={{ display: "flex", alignItems: "center", padding: "2px 6px", gap: "4px" }}>
                <Grip />
                <span style={{ flex: 1, fontSize: "0.83em" }}>{getItemLabel(entry.id)}</span>
                <Xbtn onClick={onRemove} />
            </div>
        </div>
    );
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function Grip() {
    return <span style={{ cursor: "grab", color: "var(--bs-secondary-color, #6c757d)", userSelect: "none", flexShrink: 0 }}>⠿</span>;
}

function Xbtn({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            className="btn btn-link btn-sm p-0"
            onClick={onClick}
            style={{ color: "var(--bs-danger, #dc3545)", lineHeight: 1, flexShrink: 0 }}
            title={t("toolbar_customization.remove_item")}
        >×</button>
    );
}

function DropZone({ active, onDragOver, onDrop }: { active: boolean; onDragOver: (e: Event) => void; onDrop: (e: Event) => void }) {
    return (
        <div
            style={{ height: "5px", margin: "0 4px", borderRadius: "2px", background: active ? "var(--bs-primary, #0d6efd)" : "transparent", transition: "background 0.1s" }}
            onDragOver={onDragOver}
            onDrop={onDrop}
        />
    );
}

function EmptyMsg({ children }: { children: preact.ComponentChildren }) {
    return <div style={{ padding: "10px", textAlign: "center", fontSize: "0.8em", color: "var(--bs-secondary-color, #6c757d)" }}>{children}</div>;
}

function Hint({ children }: { children: preact.ComponentChildren }) {
    return <span style={{ fontSize: "0.74em", color: "var(--bs-secondary-color, #6c757d)" }}>{children}</span>;
}
