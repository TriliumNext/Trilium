/**
 * Toolbar customization – vertical single-column editor.
 *
 * The active toolbar is shown as a full-width vertical list where
 * top → bottom corresponds to left → right in the real editor.
 * Available items appear below as compact chips (click or drag to add).
 *
 * Changes are kept in local state; only "Save & Reload" persists them.
 */
import { useState } from "preact/hooks";

import IconAlignLeft    from "@ckeditor/ckeditor5-icons/theme/icons/align-left.svg?raw";
import IconAlignCenter  from "@ckeditor/ckeditor5-icons/theme/icons/align-center.svg?raw";
import IconAlignRight   from "@ckeditor/ckeditor5-icons/theme/icons/align-right.svg?raw";
import IconAlignJustify from "@ckeditor/ckeditor5-icons/theme/icons/align-justify.svg?raw";
import IconPageBreak    from "@ckeditor/ckeditor5-icons/theme/icons/page-break.svg?raw";

import { t } from "../../../services/i18n";
import { useTriliumOption } from "../../react/hooks";
import OptionsSection from "./components/OptionsSection";
import {
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

// Only Classic and Floating — Block toolbar is an internal CKEditor detail
type TabKey = "classic" | "floating";

const DEFAULT_TABS: Record<TabKey, ToolbarEntry[]> = {
    classic:  DEFAULT_CLASSIC_TOOLBAR,
    floating: DEFAULT_FLOATING_TOOLBAR,
};

// ─── Icon maps ────────────────────────────────────────────────────────────────

const BX_ICON: Record<string, string> = {
    "kbd":                "bx-chip",
    "formatPainter":      "bx-copy-alt",
    "fontColor":          "bx-palette",
    "fontBackgroundColor":"bx-palette",
    "removeFormat":       "bx-reset",
    "bulletedList":       "bx-list-ul",
    "numberedList":       "bx-list-ol",
    "todoList":           "bx-list-check",
    "admonition":         "bx-info-circle",
    "insertTable":        "bx-table",
    "code":               "bx-code",
    "codeBlock":          "bx-code-curly",
    "footnote":           "bx-note",
    "imageUpload":        "bx-image",
    "link":               "bx-link",
    "bookmark":           "bx-bookmark",
    "internallink":       "bx-link-external",
    "includeNote":        "bx-file",
    "mermaid":            "bx-network-chart",
    "horizontalLine":     "bx-minus",
    "dateTime":           "bx-calendar",
    "outdent":            "bx-chevrons-left",
    "indent":             "bx-chevrons-right",
    "markdownImport":     "bx-import",
    "insertTemplate":     "bx-columns",
    "cuttonote":          "bx-transfer",
    "specialCharacters":  "bx-font",
};

const SVG_ICON: Record<string, string> = {
    "alignment:left":    IconAlignLeft,
    "alignment:center":  IconAlignCenter,
    "alignment:right":   IconAlignRight,
    "alignment:justify": IconAlignJustify,
    "pageBreak":         IconPageBreak,
};

function textFallback(id: string): { char: string; css: preact.JSX.CSSProperties } {
    switch (id) {
        case "bold":          return { char: "B", css: { fontWeight: "bold" } };
        case "italic":        return { char: "I", css: { fontStyle: "italic" } };
        case "underline":     return { char: "U", css: { textDecoration: "underline" } };
        case "strikethrough": return { char: "S", css: { textDecoration: "line-through" } };
        case "superscript":   return { char: "x²", css: {} };
        case "subscript":     return { char: "x₂", css: {} };
        case "heading":       return { char: "H",  css: { fontWeight: "bold" } };
        case "fontSize":      return { char: "Aa", css: {} };
        case "blockQuote":    return { char: "❝",  css: {} };
        case "emoji":         return { char: "☺",  css: {} };
        case "math":          return { char: "∑",  css: {} };
        default:              return { char: getItemLabel(id).slice(0, 2).toUpperCase(), css: {} };
    }
}

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

function getPool(entries: ToolbarEntry[]): string[] {
    const used = new Set(collectItemIds(entries));
    return Object.keys(TOOLBAR_ITEM_LABELS).filter(id => !used.has(id));
}

function rowInsertIdx(e: DragEvent, rowIdx: number): number {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? rowIdx : rowIdx + 1;
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

    function saveAndReload() {
        setSavedRaw(JSON.stringify(local));
        setTimeout(() => window.location.reload(), 120);
    }

    const TAB_LABEL: Record<TabKey, string> = {
        classic:  t("toolbar_customization.tab_classic"),
        floating: t("toolbar_customization.tab_floating"),
    };

    return (
        <OptionsSection title={t("toolbar_customization.title")}>
            <p className="form-text mb-2" style={{ fontSize: "0.85em" }}>
                {t("toolbar_customization.description")}
            </p>

            {/* Tab bar */}
            <ul className="nav nav-tabs mb-0">
                {(["classic", "floating"] as TabKey[]).map(k => (
                    <li className="nav-item" key={k}>
                        <a
                            className={`nav-link${tab === k ? " active" : ""}`}
                            style={{ cursor: "pointer", padding: "6px 14px", fontSize: "0.88em" }}
                            onClick={() => setTab(k)}
                        >
                            {TAB_LABEL[k]}
                        </a>
                    </li>
                ))}
            </ul>

            <VerticalEditor key={tab} entries={local[tab]} onChange={updateTab} />

            {/* Bottom actions */}
            <div className="mt-2 d-flex justify-content-between align-items-center">
                <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => setLocal(getDefaultConfig())}
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

// ─── Vertical editor ──────────────────────────────────────────────────────────

type DragSrc =
    | { from: "pool";   id: string }
    | { from: "active"; idx: number }
    | { from: "child";  groupIdx: number; childIdx: number };

interface VerticalEditorProps {
    entries: ToolbarEntry[];
    onChange: (e: ToolbarEntry[]) => void;
}

function VerticalEditor({ entries, onChange }: VerticalEditorProps) {
    const pool = getPool(entries);

    const [drag, setDrag]               = useState<DragSrc | null>(null);
    const [activeDropIdx, setActiveDrop] = useState<number | null>(null);
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

    function appendItem(id: string) {
        commit([...entries, { kind: "item", id, visible: true } as ToolbarItem]);
    }

    function insertAt(id: string, at: number) {
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

    function removeAt(idx: number) { commit(entries.filter((_, i) => i !== idx)); }

    function addSeparator() { commit([...entries, { kind: "separator" } as ToolbarSeparator]); }

    function addGroup() {
        const id = `group_${Date.now()}`;
        const g: ToolbarGroup = { kind: "group", id, label: "Group", icon: "threeVerticalDots", visible: true, items: [] };
        commit([...entries, g]);
        setExpanded(id);
    }

    function addToGroup(groupIdx: number, id: string) {
        const next = [...entries];
        const g = { ...(next[groupIdx] as ToolbarGroup) };
        g.items = [...g.items, { kind: "item", id, visible: true } as ToolbarItem];
        next[groupIdx] = g;
        commit(next);
    }

    function removeFromGroup(groupIdx: number, childIdx: number) {
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

    function clearDrag() {
        setDrag(null); setActiveDrop(null); setChildDrop(null);
    }

    function onActiveRowOver(e: DragEvent, rowIdx: number) {
        e.preventDefault();
        setActiveDrop(rowInsertIdx(e, rowIdx));
    }

    function onActiveDrop(e: DragEvent, at: number) {
        e.preventDefault();
        if (!drag) return;
        if (drag.from === "pool")   insertAt(drag.id, at);
        else if (drag.from === "active") moveActive(drag.idx, at);
        clearDrag();
    }

    function onGroupRowDrop(e: DragEvent, groupIdx: number) {
        e.preventDefault(); e.stopPropagation();
        if (!drag || drag.from !== "pool") return;
        addToGroup(groupIdx, drag.id);
        clearDrag();
    }

    function onChildRowOver(e: DragEvent, groupIdx: number, ci: number) {
        e.preventDefault(); e.stopPropagation();
        setChildDrop(rowInsertIdx(e, ci));
    }

    function onChildDrop(e: DragEvent, groupIdx: number, at: number) {
        e.preventDefault(); e.stopPropagation();
        if (!drag) return;
        if (drag.from === "pool") addToGroup(groupIdx, drag.id);
        else if (drag.from === "child" && drag.groupIdx === groupIdx) moveChild(groupIdx, drag.childIdx, at);
        clearDrag();
    }

    const draggingIdx = drag?.from === "active" ? drag.idx : null;

    // ── Styles ────────────────────────────────────────────────────────────────

    const sectionLabel: preact.JSX.CSSProperties = {
        fontSize: "0.72em",
        fontWeight: 700,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        color: "var(--bs-secondary-color, #6c757d)",
        marginBottom: "5px",
    };

    const activeBox: preact.JSX.CSSProperties = {
        border: "1px solid var(--bs-border-color, #dee2e6)",
        borderRadius: "5px",
        minHeight: "60px",
        maxHeight: "380px",
        overflowY: "auto",
        background: "var(--bs-body-bg, #fff)",
    };

    const poolBox: preact.JSX.CSSProperties = {
        display: "flex",
        flexWrap: "wrap",
        gap: "5px",
        padding: "8px",
        border: "1px dashed var(--bs-border-color, #dee2e6)",
        borderRadius: "5px",
        minHeight: "40px",
        background: "var(--bs-tertiary-bg, #f8f9fa)",
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div style={{
            border: "1px solid var(--bs-border-color, #dee2e6)",
            borderTop: "none",
            borderRadius: "0 0 5px 5px",
            padding: "10px 12px",
        }}>

            {/* ── Active toolbar ── */}
            <div style={sectionLabel}>
                {t("toolbar_customization.active_section")}
            </div>

            <div
                style={activeBox}
                onDragOver={e => { e.preventDefault(); setActiveDrop(entries.length); }}
                onDrop={e => onActiveDrop(e as DragEvent, entries.length)}
            >
                {entries.length === 0 && (
                    <div style={{ padding: "16px", textAlign: "center", fontSize: "0.82em", color: "var(--bs-secondary-color, #6c757d)" }}>
                        {t("toolbar_customization.drag_here")}
                    </div>
                )}

                {entries.map((entry, i) => (
                    <div key={entry.kind === "group" ? entry.id : `e-${i}`}>
                        <HLine active={activeDropIdx === i} />

                        {entry.kind === "separator" ? (
                            <SepRow
                                faded={draggingIdx === i}
                                onDragStart={e => startDrag(e as DragEvent, { from: "active", idx: i })}
                                onDragEnd={clearDrag}
                                onDragOver={e => onActiveRowOver(e as DragEvent, i)}
                                onDrop={e => onActiveDrop(e as DragEvent, rowInsertIdx(e as DragEvent, i))}
                                onRemove={() => removeAt(i)}
                            />
                        ) : entry.kind === "group" ? (
                            <>
                                <GroupRow
                                    group={entry}
                                    faded={draggingIdx === i}
                                    expanded={expandedGroup === entry.id}
                                    onToggle={() => setExpanded(v => v === entry.id ? null : entry.id)}
                                    onDragStart={e => startDrag(e as DragEvent, { from: "active", idx: i })}
                                    onDragEnd={clearDrag}
                                    onDragOver={e => onActiveRowOver(e as DragEvent, i)}
                                    onDrop={e => onGroupRowDrop(e as DragEvent, i)}
                                    onRemove={() => removeAt(i)}
                                />
                                {expandedGroup === entry.id && (
                                    <div style={{ borderLeft: "3px solid var(--bs-primary, #0d6efd)", marginLeft: "18px" }}>
                                        {entry.items.map((c, ci) => (
                                            <div key={c.kind === "item" ? c.id : `csep-${ci}`}>
                                                <HLine active={childDropIdx === ci} />
                                                {c.kind === "separator" ? (
                                                    <SepRow
                                                        indent
                                                        faded={drag?.from === "child" && drag.groupIdx === i && drag.childIdx === ci}
                                                        onDragStart={e => startDrag(e as DragEvent, { from: "child", groupIdx: i, childIdx: ci })}
                                                        onDragEnd={clearDrag}
                                                        onDragOver={e => onChildRowOver(e as DragEvent, i, ci)}
                                                        onDrop={e => onChildDrop(e as DragEvent, i, rowInsertIdx(e as DragEvent, ci))}
                                                        onRemove={() => removeFromGroup(i, ci)}
                                                    />
                                                ) : (
                                                    <ItemRow
                                                        id={c.id}
                                                        indent
                                                        faded={drag?.from === "child" && drag.groupIdx === i && drag.childIdx === ci}
                                                        onDragStart={e => startDrag(e as DragEvent, { from: "child", groupIdx: i, childIdx: ci })}
                                                        onDragEnd={clearDrag}
                                                        onDragOver={e => onChildRowOver(e as DragEvent, i, ci)}
                                                        onDrop={e => onChildDrop(e as DragEvent, i, rowInsertIdx(e as DragEvent, ci))}
                                                        onRemove={() => removeFromGroup(i, ci)}
                                                    />
                                                )}
                                            </div>
                                        ))}
                                        <HLine active={childDropIdx === entry.items.length} />
                                        {entry.items.length === 0 && (
                                            <div style={{ padding: "6px 8px", fontSize: "0.78em", color: "var(--bs-secondary-color, #6c757d)", fontStyle: "italic" }}>
                                                {t("toolbar_customization.group_empty")}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        ) : (
                            <ItemRow
                                id={entry.id}
                                faded={draggingIdx === i}
                                onDragStart={e => startDrag(e as DragEvent, { from: "active", idx: i })}
                                onDragEnd={clearDrag}
                                onDragOver={e => onActiveRowOver(e as DragEvent, i)}
                                onDrop={e => onActiveDrop(e as DragEvent, rowInsertIdx(e as DragEvent, i))}
                                onRemove={() => removeAt(i)}
                            />
                        )}
                    </div>
                ))}
                <HLine active={activeDropIdx === entries.length} />
            </div>

            {/* Add buttons */}
            <div className="d-flex gap-2 mt-2 mb-3">
                <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    style={{ fontSize: "0.78em" }}
                    onClick={addSeparator}
                    title={t("toolbar_customization.add_separator_hint")}
                >
                    + │ {t("toolbar_customization.add_separator")}
                </button>
                <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    style={{ fontSize: "0.78em" }}
                    onClick={addGroup}
                    title={t("toolbar_customization.add_group_hint")}
                >
                    + ··· {t("toolbar_customization.add_group")}
                </button>
            </div>

            {/* ── Available items ── */}
            <div style={sectionLabel}>
                {t("toolbar_customization.available_section")}
            </div>

            {pool.length === 0 ? (
                <div style={{ fontSize: "0.82em", color: "var(--bs-secondary-color, #6c757d)", padding: "6px 0" }}>
                    {t("toolbar_customization.all_active")}
                </div>
            ) : (
                <div style={poolBox}>
                    {pool.map(id => (
                        <PoolChip
                            key={id}
                            id={id}
                            onAdd={() => appendItem(id)}
                            onDragStart={e => startDrag(e as DragEvent, { from: "pool", id })}
                            onDragEnd={clearDrag}
                        />
                    ))}
                </div>
            )}

            {pool.length > 0 && (
                <div style={{ fontSize: "0.72em", color: "var(--bs-secondary-color, #6c757d)", marginTop: "4px" }}>
                    {t("toolbar_customization.pool_hint")}
                </div>
            )}
        </div>
    );
}

// ─── Row components ───────────────────────────────────────────────────────────

const ROW_H = "30px";

interface RowBase {
    faded: boolean;
    indent?: boolean;
    onDragStart: (e: Event) => void;
    onDragEnd: () => void;
    onDragOver: (e: Event) => void;
    onDrop: (e: Event) => void;
    onRemove: () => void;
}

const rowStyle = (faded: boolean, indent?: boolean): preact.JSX.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    height: ROW_H,
    paddingLeft: indent ? "10px" : "6px",
    paddingRight: "6px",
    cursor: "grab",
    opacity: faded ? 0.3 : 1,
    transition: "opacity .1s, background .1s",
    userSelect: "none",
});

function ItemRow({ id, faded, indent, onDragStart, onDragEnd, onDragOver, onDrop, onRemove }: RowBase & { id: string }) {
    return (
        <div
            draggable
            style={rowStyle(faded, indent)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bs-tertiary-bg, #f8f9fa)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
        >
            <Grip />
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "18px", flexShrink: 0 }}>
                <ToolbarIcon id={id} size={14} />
            </span>
            <span style={{ marginLeft: "7px", flex: 1, fontSize: "0.85em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {getItemLabel(id)}
            </span>
            <Xbtn onClick={onRemove} />
        </div>
    );
}

function SepRow({ faded, indent, onDragStart, onDragEnd, onDragOver, onDrop, onRemove }: RowBase) {
    return (
        <div
            draggable
            style={rowStyle(faded, indent)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bs-tertiary-bg, #f8f9fa)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
        >
            <Grip />
            <span style={{ flex: 1, display: "flex", alignItems: "center", gap: "6px", color: "var(--bs-secondary-color, #6c757d)" }}>
                <span style={{ flex: 1, borderTop: "1px dashed currentColor", opacity: 0.5 }} />
                <span style={{ fontSize: "0.75em", letterSpacing: ".02em" }}>│ {t("toolbar_customization.separator")}</span>
                <span style={{ flex: 1, borderTop: "1px dashed currentColor", opacity: 0.5 }} />
            </span>
            <Xbtn onClick={onRemove} />
        </div>
    );
}

interface GroupRowProps extends RowBase {
    group: ToolbarGroup;
    expanded: boolean;
    onToggle: () => void;
}

function GroupRow({ group, faded, expanded, onToggle, onDragStart, onDragEnd, onDragOver, onDrop, onRemove }: GroupRowProps) {
    return (
        <div
            draggable
            style={{
                ...rowStyle(faded),
                background: "var(--bs-secondary-bg, #e9ecef)",
                borderLeft: "3px solid var(--bs-primary, #0d6efd)",
            }}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            title={t("toolbar_customization.drop_on_group")}
        >
            <Grip />
            <span style={{ fontSize: "12px", flexShrink: 0, marginRight: "5px", color: "var(--bs-secondary-color, #6c757d)" }}>···</span>
            <span style={{ flex: 1, fontSize: "0.85em", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {group.label}
            </span>
            <span style={{ fontSize: "0.75em", color: "var(--bs-secondary-color, #6c757d)", marginRight: "4px", flexShrink: 0 }}>
                ({group.items.length})
            </span>
            <button
                type="button"
                className="btn btn-link btn-sm p-0"
                style={{ fontSize: "0.72em", lineHeight: 1, color: "var(--bs-body-color)", flexShrink: 0, opacity: 0.7 }}
                onClick={e => { e.stopPropagation(); onToggle(); }}
                title={expanded ? t("toolbar_customization.collapse") : t("toolbar_customization.expand")}
            >
                {expanded ? "▲" : "▼"}
            </button>
            <Xbtn onClick={onRemove} />
        </div>
    );
}

function PoolChip({ id, onAdd, onDragStart, onDragEnd }: {
    id: string;
    onAdd: () => void;
    onDragStart: (e: Event) => void;
    onDragEnd: () => void;
}) {
    return (
        <button
            type="button"
            draggable
            className="btn btn-sm btn-outline-secondary"
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "0.78em",
                padding: "2px 8px",
                height: "26px",
                cursor: "grab",
                userSelect: "none",
                whiteSpace: "nowrap",
            }}
            onClick={onAdd}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            title={`${getItemLabel(id)} – click to add`}
        >
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "13px", flexShrink: 0 }}>
                <ToolbarIcon id={id} size={12} />
            </span>
            {getItemLabel(id)}
        </button>
    );
}

// ─── Icon renderer ────────────────────────────────────────────────────────────

function ToolbarIcon({ id, size }: { id: string; size: number }) {
    const svg = SVG_ICON[id];
    if (svg) return (
        <span
            style={{ display: "inline-flex", width: size, height: size, flexShrink: 0 }}
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
    const bx = BX_ICON[id];
    if (bx) return <i class={`bx ${bx}`} style={{ fontSize: `${size}px`, lineHeight: 1, flexShrink: 0 }} />;
    const { char, css } = textFallback(id);
    return (
        <span style={{ fontSize: `${size - 2}px`, lineHeight: 1, flexShrink: 0, minWidth: `${size}px`, textAlign: "center", ...css }}>
            {char}
        </span>
    );
}

// ─── Micro helpers ────────────────────────────────────────────────────────────

function Grip() {
    return (
        <span style={{
            color: "var(--bs-secondary-color, #6c757d)",
            marginRight: "5px",
            flexShrink: 0,
            fontSize: "11px",
            cursor: "grab",
            opacity: 0.45,
        }}>⠿</span>
    );
}

function Xbtn({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            className="btn btn-link btn-sm p-0"
            onClick={e => { e.stopPropagation(); onClick(); }}
            style={{
                color: "var(--bs-secondary-color, #aaa)",
                lineHeight: 1,
                flexShrink: 0,
                fontSize: "11px",
                marginLeft: "4px",
                opacity: 0.4,
                transition: "opacity .15s, color .15s",
            }}
            onMouseEnter={e => {
                const b = e.currentTarget as HTMLElement;
                b.style.opacity = "1";
                b.style.color = "var(--bs-danger, #dc3545)";
            }}
            onMouseLeave={e => {
                const b = e.currentTarget as HTMLElement;
                b.style.opacity = "0.4";
                b.style.color = "var(--bs-secondary-color, #aaa)";
            }}
            title={t("toolbar_customization.remove_item")}
        >✕</button>
    );
}

/** Horizontal blue line shown between rows as a drag-drop indicator. */
function HLine({ active }: { active: boolean }) {
    return (
        <div style={{
            height: "2px",
            background: active ? "var(--bs-primary, #0d6efd)" : "transparent",
            transition: "background .08s",
        }} />
    );
}
