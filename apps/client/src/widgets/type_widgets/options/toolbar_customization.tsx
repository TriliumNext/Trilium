/**
 * Toolbar customization – two-column list editor.
 *
 * LEFT  column : active toolbar entries (drag to reorder, drag to right to remove)
 * RIGHT column : available items (drag to left to add)
 *
 * Each row shows [⠿ drag handle] [icon] [label]  (plus [×] on the left side).
 * Separators and groups are rendered as special rows.
 * Groups expand inline to let you reorder their children.
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

// ─── Icon maps (same as before) ───────────────────────────────────────────────

const BX_ICON: Record<string, string> = {
    "kbd":               "bx-chip",
    "formatPainter":     "bx-copy-alt",
    "fontColor":         "bx-palette",
    "fontBackgroundColor":"bx-palette",
    "removeFormat":      "bx-reset",
    "bulletedList":      "bx-list-ul",
    "numberedList":      "bx-list-ol",
    "todoList":          "bx-list-check",
    "admonition":        "bx-info-circle",
    "insertTable":       "bx-table",
    "code":              "bx-code",
    "codeBlock":         "bx-code-curly",
    "footnote":          "bx-note",
    "imageUpload":       "bx-image",
    "link":              "bx-link",
    "bookmark":          "bx-bookmark",
    "internallink":      "bx-link-external",
    "includeNote":       "bx-file",
    "mermaid":           "bx-network-chart",
    "horizontalLine":    "bx-minus",
    "dateTime":          "bx-calendar",
    "outdent":           "bx-chevrons-left",
    "indent":            "bx-chevrons-right",
    "markdownImport":    "bx-import",
    "insertTemplate":    "bx-columns",
    "cuttonote":         "bx-transfer",
    "specialCharacters": "bx-font",
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

function getPool(tab: TabKey, entries: ToolbarEntry[]): string[] {
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
        classic:      t("toolbar_customization.tab_classic"),
        floating:     t("toolbar_customization.tab_floating"),
        blockToolbar: t("toolbar_customization.tab_block"),
    };

    return (
        <OptionsSection title={t("toolbar_customization.title")}>
            <p className="form-text mb-2" style={{ fontSize: "0.83em" }}>
                {t("toolbar_customization.description")}
            </p>

            {/* Tab bar */}
            <ul className="nav nav-tabs mb-0">
                {(["classic", "floating", "blockToolbar"] as TabKey[]).map(k => (
                    <li className="nav-item" key={k}>
                        <a className={`nav-link${tab === k ? " active" : ""}`}
                            style={{ cursor: "pointer", padding: "5px 12px", fontSize: "0.87em" }}
                            onClick={() => setTab(k)}>
                            {TAB_LABEL[k]}
                        </a>
                    </li>
                ))}
            </ul>

            <TwoColumnEditor key={tab} tab={tab} entries={local[tab]} onChange={updateTab} />

            {/* Bottom actions */}
            <div className="mt-2 d-flex justify-content-between align-items-center">
                <button type="button" className="btn btn-sm btn-outline-secondary"
                    onClick={() => setLocal(getDefaultConfig())}
                    title={t("toolbar_customization.reset_title")}>
                    ↺ {t("toolbar_customization.reset")}
                </button>
                <button type="button"
                    className={`btn btn-sm ${isDirty ? "btn-primary" : "btn-outline-primary"}`}
                    onClick={saveAndReload}
                    title={t("toolbar_customization.save_title")}>
                    ▶ {t("toolbar_customization.save")}
                </button>
            </div>
        </OptionsSection>
    );
}

// ─── Two-column list editor ───────────────────────────────────────────────────

type DragSrc =
    | { from: "pool";  id: string }
    | { from: "active"; idx: number }
    | { from: "child"; groupIdx: number; childIdx: number };

interface ColEditorProps {
    tab: TabKey;
    entries: ToolbarEntry[];
    onChange: (e: ToolbarEntry[]) => void;
}

const LIST_H = "290px";

function TwoColumnEditor({ tab, entries, onChange }: ColEditorProps) {
    const pool = getPool(tab, entries);

    const [drag, setDrag]              = useState<DragSrc | null>(null);
    const [activeDropIdx, setActiveDrop] = useState<number | null>(null);
    const [poolOver, setPoolOver]      = useState(false);
    const [expandedGroup, setExpanded] = useState<string | null>(null);
    const [childDropIdx, setChildDrop] = useState<number | null>(null);

    // ── Mutations ─────────────────────────────────────────────────────────────

    function commit(next: ToolbarEntry[]) {
        onChange(next.map(e => {
            if (e.kind === "item")  return { ...e, visible: true };
            if (e.kind === "group") return { ...e, visible: true, items: e.items.map(c => c.kind === "item" ? { ...c, visible: true } : c) };
            return e;
        }));
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
        setDrag(null); setActiveDrop(null); setPoolOver(false); setChildDrop(null);
    }

    function onActiveRowOver(e: DragEvent, rowIdx: number) {
        e.preventDefault();
        setActiveDrop(rowInsertIdx(e, rowIdx));
        setPoolOver(false);
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

    function onPoolDrop(e: DragEvent) {
        e.preventDefault();
        if (!drag) return;
        if (drag.from === "active") removeAt(drag.idx);
        else if (drag.from === "child") removeFromGroup(drag.groupIdx, drag.childIdx);
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

    // ── Shared styles ─────────────────────────────────────────────────────────

    const colBox = (danger?: boolean): preact.JSX.CSSProperties => ({
        height: LIST_H, overflowY: "auto",
        border: `1px solid ${danger ? "var(--bs-danger, #dc3545)" : "var(--bs-border-color, #dee2e6)"}`,
        borderRadius: "4px",
        background: danger ? "var(--bs-danger-bg-subtle, #fff3f3)" : "var(--bs-body-bg, #fff)",
        transition: "border-color .15s, background .15s",
    });

    const colHdr: preact.JSX.CSSProperties = {
        fontSize: "0.74em", fontWeight: 600, letterSpacing: ".04em",
        color: "var(--bs-secondary-color, #6c757d)", marginBottom: "3px",
    };

    const draggingIdx = drag?.from === "active" ? drag.idx : null;

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div style={{ border: "1px solid var(--bs-border-color, #dee2e6)", borderTop: "none", borderRadius: "0 0 5px 5px", padding: "8px 10px" }}>
            <div style={{ display: "flex", gap: "10px" }}>

                {/* ── LEFT: Active list ── */}
                <div style={{ flex: "0 0 55%" }}>
                    <div style={colHdr}>{t("toolbar_customization.active")}</div>
                    <div
                        style={colBox()}
                        onDragOver={e => { e.preventDefault(); setActiveDrop(entries.length); setPoolOver(false); }}
                        onDrop={e => onActiveDrop(e as DragEvent, entries.length)}
                    >
                        {entries.length === 0 && (
                            <div style={{ padding: "12px 8px", textAlign: "center", fontSize: "0.8em", color: "var(--bs-secondary-color, #6c757d)" }}>
                                {t("toolbar_customization.drag_here")}
                            </div>
                        )}

                        {entries.map((entry, i) => (
                            <div key={i === 0 ? "first" : `e-${i}`}>
                                {/* Horizontal drop indicator before this row */}
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
                                        {expandedGroup === entry.id && entry.items.map((c, ci) => (
                                            <div key={c.kind === "item" ? c.id : `csep-${ci}`}>
                                                <HLine active={childDropIdx === ci} indent />
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
                                        {expandedGroup === entry.id && (
                                            <HLine active={childDropIdx === entry.items.length} indent />
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
                    <div className="d-flex gap-2 mt-1">
                        <button type="button" className="btn btn-sm btn-outline-secondary" style={{ fontSize: "0.76em" }}
                            onClick={addSeparator} title={t("toolbar_customization.add_separator_hint")}>
                            + │ {t("toolbar_customization.add_separator")}
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-secondary" style={{ fontSize: "0.76em" }}
                            onClick={addGroup} title={t("toolbar_customization.add_group_hint")}>
                            + ··· {t("toolbar_customization.add_group")}
                        </button>
                    </div>
                </div>

                {/* ── RIGHT: Pool list ── */}
                <div style={{ flex: 1 }}>
                    <div style={colHdr}>{t("toolbar_customization.available")}</div>
                    <div
                        style={colBox(poolOver)}
                        onDragOver={e => { e.preventDefault(); setPoolOver(true); }}
                        onDragLeave={() => setPoolOver(false)}
                        onDrop={onPoolDrop}
                    >
                        {pool.length === 0 ? (
                            <div style={{ padding: "12px 8px", textAlign: "center", fontSize: "0.8em", color: "var(--bs-secondary-color, #6c757d)" }}>
                                {t("toolbar_customization.all_active")}
                            </div>
                        ) : pool.map(id => (
                            <PoolRow
                                key={id}
                                id={id}
                                onDragStart={e => startDrag(e as DragEvent, { from: "pool", id })}
                                onDragEnd={clearDrag}
                            />
                        ))}
                    </div>
                    <div style={{ fontSize: "0.72em", color: "var(--bs-secondary-color, #6c757d)", marginTop: "3px" }}>
                        ← {t("toolbar_customization.drag_to_add")} &nbsp;│&nbsp; {t("toolbar_customization.drag_hint_pool")} →
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Row components ───────────────────────────────────────────────────────────

const ROW_H = "28px";

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
    display: "flex", alignItems: "center",
    height: ROW_H, paddingLeft: indent ? "22px" : "4px", paddingRight: "4px",
    cursor: "grab", opacity: faded ? 0.3 : 1,
    transition: "opacity .1s, background .1s",
    userSelect: "none",
});

function ItemRow({ id, faded, indent, onDragStart, onDragEnd, onDragOver, onDrop, onRemove }: RowBase & { id: string }) {
    return (
        <div
            draggable style={rowStyle(faded, indent)}
            onDragStart={onDragStart} onDragEnd={onDragEnd}
            onDragOver={onDragOver} onDrop={onDrop}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bs-tertiary-bg, #f8f9fa)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
        >
            <Grip />
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "20px", flexShrink: 0 }}>
                <ToolbarIcon id={id} size={14} />
            </span>
            <span style={{ marginLeft: "6px", flex: 1, fontSize: "0.83em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {getItemLabel(id)}
            </span>
            <Xbtn onClick={onRemove} />
        </div>
    );
}

function SepRow({ faded, indent, onDragStart, onDragEnd, onDragOver, onDrop, onRemove }: RowBase) {
    return (
        <div
            draggable style={rowStyle(faded, indent)}
            onDragStart={onDragStart} onDragEnd={onDragEnd}
            onDragOver={onDragOver} onDrop={onDrop}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bs-tertiary-bg, #f8f9fa)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
        >
            <Grip />
            <span style={{ flex: 1, display: "flex", alignItems: "center", gap: "6px", color: "var(--bs-secondary-color, #6c757d)" }}>
                <span style={{ flex: 1, borderTop: "1px solid currentColor", opacity: .4 }} />
                <span style={{ fontSize: "0.72em" }}>│ separator</span>
                <span style={{ flex: 1, borderTop: "1px solid currentColor", opacity: .4 }} />
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
            draggable style={{ ...rowStyle(faded), background: "var(--bs-tertiary-bg, #f8f9fa)" }}
            onDragStart={onDragStart} onDragEnd={onDragEnd}
            onDragOver={onDragOver} onDrop={onDrop}
            title={t("toolbar_customization.drop_on_group")}
        >
            <Grip />
            <span style={{ fontSize: "13px", flexShrink: 0, marginRight: "2px" }}>···</span>
            <span style={{ flex: 1, fontSize: "0.83em", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {group.label}
            </span>
            <span style={{ fontSize: "0.72em", color: "var(--bs-secondary-color, #6c757d)", marginRight: "2px", flexShrink: 0 }}>
                ({group.items.length})
            </span>
            <button type="button" className="btn btn-link btn-sm p-0"
                style={{ fontSize: "0.68em", lineHeight: 1, color: "inherit", flexShrink: 0 }}
                onClick={e => { e.stopPropagation(); onToggle(); }}>
                {expanded ? "▲" : "▼"}
            </button>
            <Xbtn onClick={onRemove} />
        </div>
    );
}

function PoolRow({ id, onDragStart, onDragEnd }: { id: string; onDragStart: (e: Event) => void; onDragEnd: () => void }) {
    return (
        <div
            draggable
            style={{ display: "flex", alignItems: "center", height: ROW_H, paddingLeft: "4px", paddingRight: "4px", cursor: "grab", userSelect: "none", transition: "background .1s" }}
            onDragStart={onDragStart} onDragEnd={onDragEnd}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bs-tertiary-bg, #f8f9fa)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
        >
            <Grip />
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "20px", flexShrink: 0 }}>
                <ToolbarIcon id={id} size={14} />
            </span>
            <span style={{ marginLeft: "6px", flex: 1, fontSize: "0.83em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {getItemLabel(id)}
            </span>
        </div>
    );
}

// ─── Icon renderer ────────────────────────────────────────────────────────────

function ToolbarIcon({ id, size }: { id: string; size: number }) {
    const svg = SVG_ICON[id];
    if (svg) return (
        <span style={{ display: "inline-flex", width: size, height: size, flexShrink: 0 }}
            dangerouslySetInnerHTML={{ __html: svg }} />
    );
    const bx = BX_ICON[id];
    if (bx) return <i class={`bx ${bx}`} style={{ fontSize: `${size}px`, lineHeight: 1, flexShrink: 0 }} />;
    const { char, css } = textFallback(id);
    return (
        <span style={{ fontSize: `${size - 1}px`, lineHeight: 1, flexShrink: 0, minWidth: `${size}px`, textAlign: "center", ...css }}>
            {char}
        </span>
    );
}

// ─── Micro helpers ────────────────────────────────────────────────────────────

function Grip() {
    return <span style={{ color: "var(--bs-secondary-color, #6c757d)", marginRight: "4px", flexShrink: 0, fontSize: "10px", cursor: "grab", opacity: 0.5 }}>⠿</span>;
}

function Xbtn({ onClick }: { onClick: () => void }) {
    return (
        <button type="button" className="btn btn-link btn-sm p-0 toolbar-remove-btn"
            onClick={e => { e.stopPropagation(); onClick(); }}
            style={{ color: "var(--bs-secondary-color, #aaa)", lineHeight: 1, flexShrink: 0, fontSize: "10px", marginLeft: "3px", opacity: 0.4, transition: "opacity .15s, color .15s" }}
            onMouseEnter={e => { const b = e.currentTarget as HTMLElement; b.style.opacity = "1"; b.style.color = "var(--bs-danger, #dc3545)"; }}
            onMouseLeave={e => { const b = e.currentTarget as HTMLElement; b.style.opacity = "0.4"; b.style.color = "var(--bs-secondary-color, #aaa)"; }}
            title={t("toolbar_customization.remove_item")}>✕</button>
    );
}

/** Horizontal blue line shown between rows as a drag-drop indicator. */
function HLine({ active, indent }: { active: boolean; indent?: boolean }) {
    return (
        <div style={{
            height: "2px", marginLeft: indent ? "22px" : "0", marginRight: "0",
            background: active ? "var(--bs-primary, #0d6efd)" : "transparent",
            transition: "background .08s",
        }} />
    );
}
