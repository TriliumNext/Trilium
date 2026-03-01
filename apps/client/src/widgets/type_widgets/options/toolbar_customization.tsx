/**
 * Toolbar customization – compact icon-based horizontal editor.
 *
 * Each chip shows the icon (or styled abbreviation) of the toolbar item
 * with the full label as a tooltip.  This mirrors how the real CKEditor
 * toolbar looks, keeping the settings UI compact and clear.
 *
 * Layout (two horizontal bars):
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ [B×] [I×] [U×] [S×]  │  [Aa×] [🎨×] [🎨×]  │  [≡×] [#×] │  ← active toolbar
 *   └─────────────────────────────────────────────────────────────┘
 *   [+ │ Separator]  [+ ··· Group]
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ [x²] [x₂] [⌨] [∑] …                                       │  ← available pool
 *   └─────────────────────────────────────────────────────────────┘
 *                                     [↺ Reset]  [▶ Save & Reload]
 *
 * Changes stay in local state until "Save & Reload" is clicked.
 */
import { useState } from "preact/hooks";

// Four alignment icons – confirmed to work from @ckeditor/ckeditor5-icons
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

// ─── Icon map ─────────────────────────────────────────────────────────────────

/**
 * Boxicons CSS class (without "bx ") for items that have a good match.
 * All class names confirmed to exist in the Trilium codebase.
 */
const BX_ICON: Record<string, string> = {
    "kbd":                  "bx-chip",
    "formatPainter":        "bx-copy-alt",
    "fontColor":            "bx-palette",
    "fontBackgroundColor":  "bx-palette",        // same icon, distinguished by tooltip
    "removeFormat":         "bx-reset",
    "bulletedList":         "bx-list-ul",
    "numberedList":         "bx-list-ol",
    "todoList":             "bx-list-check",
    "admonition":           "bx-info-circle",
    "insertTable":          "bx-table",
    "code":                 "bx-code",
    "codeBlock":            "bx-code-curly",
    "footnote":             "bx-note",
    "imageUpload":          "bx-image",
    "link":                 "bx-link",
    "bookmark":             "bx-bookmark",
    "internallink":         "bx-link-external",
    "includeNote":          "bx-file",
    "mermaid":              "bx-network-chart",
    "horizontalLine":       "bx-minus",
    "dateTime":             "bx-calendar",
    "outdent":              "bx-chevrons-left",
    "indent":               "bx-chevrons-right",
    "markdownImport":       "bx-import",
    "insertTemplate":       "bx-columns",
    "cuttonote":            "bx-transfer",
    "specialCharacters":    "bx-font",
};

/**
 * Inline SVG strings for items that have confirmed CKEditor icon imports.
 */
const SVG_ICON: Record<string, string> = {
    "alignment:left":    IconAlignLeft,
    "alignment:center":  IconAlignCenter,
    "alignment:right":   IconAlignRight,
    "alignment:justify": IconAlignJustify,
    "pageBreak":         IconPageBreak,
};

/**
 * Styled abbreviation fallback for items without an icon.
 * Returns { char, css } where css is inline style text applied to a <span>.
 */
function textFallback(id: string): { char: string; css: preact.JSX.CSSProperties } {
    switch (id) {
        case "bold":        return { char: "B", css: { fontWeight: "bold" } };
        case "italic":      return { char: "I", css: { fontStyle: "italic" } };
        case "underline":   return { char: "U", css: { textDecoration: "underline" } };
        case "strikethrough": return { char: "S", css: { textDecoration: "line-through" } };
        case "superscript": return { char: "x²", css: {} };
        case "subscript":   return { char: "x₂", css: {} };
        case "heading":     return { char: "H",  css: { fontWeight: "bold" } };
        case "fontSize":    return { char: "Aa", css: {} };
        case "blockQuote":  return { char: "❝",  css: {} };
        case "emoji":       return { char: "☺",  css: {} };
        case "math":        return { char: "∑",  css: {} };
        default:
            return { char: getItemLabel(id).slice(0, 2).toUpperCase(), css: {} };
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

function getPool(tab: TabKey, activeEntries: ToolbarEntry[]): string[] {
    const used = new Set(collectItemIds(activeEntries));
    return Object.keys(TOOLBAR_ITEM_LABELS).filter(id => !used.has(id));
}

function entryKey(e: ToolbarEntry, i: number): string {
    if (e.kind === "separator") return `sep-${i}`;
    if (e.kind === "group") return `grp-${e.id}-${i}`;
    return `item-${e.id}`;
}

function insertIdxFn(e: DragEvent, chipIdx: number): number {
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

    function reset() { setLocal(getDefaultConfig()); }

    function saveAndReload() {
        setSavedRaw(JSON.stringify(local));
        setTimeout(() => window.location.reload(), 120);
    }

    const TAB_LABEL: Record<TabKey, string> = {
        classic:     t("toolbar_customization.tab_classic"),
        floating:    t("toolbar_customization.tab_floating"),
        blockToolbar:t("toolbar_customization.tab_block"),
    };

    return (
        <OptionsSection title={t("toolbar_customization.title")}>
            <p className="form-text mb-2" style={{ fontSize: "0.84em" }}>
                {t("toolbar_customization.description")}
            </p>

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

            <HorizontalEditor key={tab} tab={tab} entries={local[tab]} onChange={updateTab} />

            <div className="mt-2 d-flex justify-content-between align-items-center">
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={reset}
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

// ─── Horizontal two-bar editor ────────────────────────────────────────────────

type DragSrc =
    | { from: "pool";  id: string }
    | { from: "active"; idx: number }
    | { from: "child"; groupIdx: number; childIdx: number };

interface HorizEditorProps {
    tab: TabKey;
    entries: ToolbarEntry[];
    onChange: (e: ToolbarEntry[]) => void;
}

function HorizontalEditor({ tab, entries, onChange }: HorizEditorProps) {
    const pool = getPool(tab, entries);

    const [drag, setDrag]             = useState<DragSrc | null>(null);
    const [dropIdx, setDropIdx]       = useState<number | null>(null);
    const [overPool, setOverPool]     = useState(false);
    const [expandedGroup, setExpanded]= useState<string | null>(null);
    const [childDropIdx, setChildDrop]= useState<number | null>(null);

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

    function removeActive(idx: number) { commit(entries.filter((_, i) => i !== idx)); }

    function addSeparator() { commit([...entries, { kind: "separator" } as ToolbarSeparator]); }

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

    function onActiveDrop(e: DragEvent, at: number) {
        e.preventDefault();
        if (!drag) return;
        if (drag.from === "pool")   addItemAt(drag.id, at);
        else if (drag.from === "active") moveActive(drag.idx, at);
        clearDrag();
    }

    function onActiveOver(e: DragEvent, chipIdx: number) {
        e.preventDefault();
        setDropIdx(insertIdxFn(e, chipIdx));
        setOverPool(false);
    }

    function onGroupDrop(e: DragEvent, groupIdx: number) {
        e.preventDefault(); e.stopPropagation();
        if (!drag) return;
        if (drag.from === "pool") addItemToGroup(groupIdx, drag.id);
        clearDrag();
    }

    function onPoolDrop(e: DragEvent) {
        e.preventDefault();
        if (!drag) return;
        if (drag.from === "active") removeActive(drag.idx);
        else if (drag.from === "child") removeChildFromGroup(drag.groupIdx, drag.childIdx);
        clearDrag();
    }

    function onChildDrop(e: DragEvent, groupIdx: number, ci: number) {
        e.preventDefault(); e.stopPropagation();
        if (!drag) return;
        if (drag.from === "pool") addItemToGroup(groupIdx, drag.id);
        else if (drag.from === "child" && drag.groupIdx === groupIdx) moveChild(groupIdx, drag.childIdx, ci);
        clearDrag();
    }

    // ── Render ────────────────────────────────────────────────────────────────

    const draggingIdx = drag?.from === "active" ? drag.idx : null;

    const barStyle = (danger?: boolean): preact.JSX.CSSProperties => ({
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px",
        minHeight: "40px", padding: "5px 6px",
        border: `2px dashed ${danger ? "var(--bs-danger, #dc3545)" : "var(--bs-border-color, #dee2e6)"}`,
        borderRadius: "5px",
        background: danger ? "var(--bs-danger-bg-subtle, #fff3f3)" : "var(--bs-tertiary-bg, #f8f9fa)",
        transition: "border-color .15s, background .15s",
    });

    const lbl: preact.JSX.CSSProperties = {
        fontSize: "0.74em", fontWeight: 600, letterSpacing: ".04em",
        color: "var(--bs-secondary-color, #6c757d)", marginBottom: "3px", marginTop: "8px",
    };

    return (
        <div style={{ border: "1px solid var(--bs-border-color, #dee2e6)", borderTop: "none", borderRadius: "0 0 5px 5px", padding: "8px 10px" }}>

            {/* ── Active toolbar bar ── */}
            <div style={lbl}>{t("toolbar_customization.active")}</div>
            <div
                style={barStyle()}
                onDragOver={e => { e.preventDefault(); setDropIdx(entries.length); setOverPool(false); }}
                onDrop={e => onActiveDrop(e as DragEvent, entries.length)}
            >
                {entries.length === 0 && (
                    <span style={{ color: "var(--bs-secondary-color, #6c757d)", fontSize: "0.8em" }}>
                        {t("toolbar_customization.drag_here")}
                    </span>
                )}

                {entries.map((entry, i) => (
                    <span key={entryKey(entry, i)} style={{ display: "contents" }}>
                        <DropLine active={dropIdx === i} />

                        {entry.kind === "separator" ? (
                            <SepChip
                                isDragging={draggingIdx === i}
                                onDragStart={e => startDrag(e as DragEvent, { from: "active", idx: i })}
                                onDragEnd={clearDrag}
                                onDragOver={e => onActiveOver(e as DragEvent, i)}
                                onDrop={e => onActiveDrop(e as DragEvent, insertIdxFn(e as DragEvent, i))}
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
                                id={entry.id}
                                isDragging={draggingIdx === i}
                                onDragStart={e => startDrag(e as DragEvent, { from: "active", idx: i })}
                                onDragEnd={clearDrag}
                                onDragOver={e => onActiveOver(e as DragEvent, i)}
                                onDrop={e => onActiveDrop(e as DragEvent, insertIdxFn(e as DragEvent, i))}
                                onRemove={() => removeActive(i)}
                            />
                        )}
                    </span>
                ))}
                <DropLine active={dropIdx === entries.length} />
            </div>

            {/* ── Expanded group children ── */}
            {expandedGroup && (() => {
                const gi = entries.findIndex(e => e.kind === "group" && (e as ToolbarGroup).id === expandedGroup);
                if (gi === -1) return null;
                const g = entries[gi] as ToolbarGroup;
                return (
                    <div style={{ paddingLeft: "14px", marginTop: "3px" }}>
                        <div style={{ ...lbl, marginTop: 0 }}>↳ {g.label}</div>
                        <div
                            style={{ ...barStyle(), background: "var(--bs-secondary-bg, #e9ecef)", minHeight: "34px" }}
                            onDragOver={e => { e.preventDefault(); setChildDrop(g.items.length); }}
                            onDrop={e => onChildDrop(e as DragEvent, gi, g.items.length)}
                        >
                            {g.items.length === 0 && (
                                <span style={{ color: "var(--bs-secondary-color, #6c757d)", fontSize: "0.78em" }}>
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
                                            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setChildDrop(insertIdxFn(e as DragEvent, ci)); }}
                                            onDrop={e => onChildDrop(e as DragEvent, gi, insertIdxFn(e as DragEvent, ci))}
                                            onRemove={() => removeChildFromGroup(gi, ci)}
                                        />
                                    ) : (
                                        <ItemChip
                                            id={c.id}
                                            isDragging={drag?.from === "child" && drag.groupIdx === gi && drag.childIdx === ci}
                                            onDragStart={e => startDrag(e as DragEvent, { from: "child", groupIdx: gi, childIdx: ci })}
                                            onDragEnd={clearDrag}
                                            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setChildDrop(insertIdxFn(e as DragEvent, ci)); }}
                                            onDrop={e => onChildDrop(e as DragEvent, gi, insertIdxFn(e as DragEvent, ci))}
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

            {/* ── Toolbar actions ── */}
            <div className="d-flex gap-2 mt-2">
                <button type="button" className="btn btn-sm btn-outline-secondary" style={{ fontSize: "0.78em" }}
                    onClick={addSeparator} title={t("toolbar_customization.add_separator_hint")}>
                    + │ {t("toolbar_customization.add_separator")}
                </button>
                <button type="button" className="btn btn-sm btn-outline-secondary" style={{ fontSize: "0.78em" }}
                    onClick={addGroup} title={t("toolbar_customization.add_group_hint")}>
                    + ··· {t("toolbar_customization.add_group")}
                </button>
            </div>

            {/* ── Available pool ── */}
            <div style={lbl}>{t("toolbar_customization.available")}</div>
            <div
                style={barStyle(overPool)}
                onDragOver={e => { e.preventDefault(); setOverPool(true); }}
                onDragLeave={() => setOverPool(false)}
                onDrop={onPoolDrop}
            >
                {pool.length === 0 ? (
                    <span style={{ color: "var(--bs-secondary-color, #6c757d)", fontSize: "0.8em" }}>
                        {t("toolbar_customization.all_active")}
                    </span>
                ) : pool.map(id => (
                    <div
                        key={id}
                        draggable
                        onDragStart={e => startDrag(e as DragEvent, { from: "pool", id })}
                        onDragEnd={clearDrag}
                        title={getItemLabel(id)}
                        style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: "30px", height: "28px", cursor: "grab",
                            borderRadius: "4px", border: "1px solid var(--bs-border-color, #dee2e6)",
                            background: "var(--bs-body-bg, #fff)",
                            color: "var(--bs-body-color, #212529)",
                            userSelect: "none",
                        }}
                    >
                        <ToolbarIcon id={id} size={16} />
                    </div>
                ))}
            </div>
            <div style={{ fontSize: "0.73em", color: "var(--bs-secondary-color, #6c757d)", marginTop: "3px" }}>
                ↑ {t("toolbar_customization.drag_hint_pool")} &nbsp;│&nbsp; ↓ {t("toolbar_customization.drag_hint_active")}
            </div>
        </div>
    );
}

// ─── Chip components ──────────────────────────────────────────────────────────

interface ChipProps {
    isDragging: boolean;
    onDragStart: (e: Event) => void;
    onDragEnd: () => void;
    onDragOver: (e: Event) => void;
    onDrop: (e: Event) => void;
    onRemove: () => void;
}

const chipBase: preact.JSX.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "2px",
    height: "28px", padding: "0 4px", borderRadius: "4px",
    border: "1px solid var(--bs-border-color, #dee2e6)",
    background: "var(--bs-body-bg, #fff)",
    color: "var(--bs-body-color, #212529)",
    cursor: "grab", userSelect: "none",
    transition: "opacity .12s",
};

function ItemChip({ id, isDragging, onDragStart, onDragEnd, onDragOver, onDrop, onRemove }: ChipProps & { id: string }) {
    return (
        <div
            draggable
            title={getItemLabel(id)}
            style={{ ...chipBase, opacity: isDragging ? 0.3 : 1 }}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            <ToolbarIcon id={id} size={16} />
            <Xbtn onClick={onRemove} />
        </div>
    );
}

function SepChip({ isDragging, onDragStart, onDragEnd, onDragOver, onDrop, onRemove }: ChipProps) {
    return (
        <div
            draggable
            title={t("toolbar_customization.separator")}
            style={{ ...chipBase, opacity: isDragging ? 0.3 : 1, padding: "0 3px", color: "var(--bs-secondary-color, #6c757d)" }}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            <span style={{ width: "1px", height: "16px", background: "currentColor", display: "inline-block" }} />
            <Xbtn onClick={onRemove} />
        </div>
    );
}

interface GroupChipProps extends ChipProps {
    group: ToolbarGroup;
    expanded: boolean;
    onToggle: () => void;
}

function GroupChip({ group, expanded, isDragging, onToggle, onDragStart, onDragEnd, onDragOver, onDrop, onRemove }: GroupChipProps) {
    return (
        <div
            draggable
            title={`${group.label} (${t("toolbar_customization.drop_on_group")})`}
            style={{ ...chipBase, opacity: isDragging ? 0.3 : 1, padding: "0 5px", background: "var(--bs-secondary-bg, #e9ecef)", gap: "3px" }}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            <span style={{ fontSize: "0.75em" }}>···</span>
            <span style={{ fontSize: "0.72em", color: "var(--bs-secondary-color, #6c757d)" }}>({group.items.length})</span>
            <button
                type="button" className="btn btn-link btn-sm p-0"
                style={{ fontSize: "0.65em", lineHeight: 1, color: "inherit" }}
                onClick={e => { e.stopPropagation(); onToggle(); }}
                title={expanded ? t("toolbar_customization.collapse") : t("toolbar_customization.expand")}
            >{expanded ? "▲" : "▼"}</button>
            <Xbtn onClick={onRemove} />
        </div>
    );
}

// ─── Icon renderer ────────────────────────────────────────────────────────────

/** Renders the appropriate icon for a given toolbar item id. */
function ToolbarIcon({ id, size }: { id: string; size: number }) {
    // 1. Inline SVG (CKEditor icons)
    const svg = SVG_ICON[id];
    if (svg) {
        return (
            <span
                style={{ display: "inline-flex", width: size, height: size, flexShrink: 0 }}
                dangerouslySetInnerHTML={{ __html: svg }}
            />
        );
    }

    // 2. Boxicons font class
    const bx = BX_ICON[id];
    if (bx) {
        return <i class={`bx ${bx}`} style={{ fontSize: `${size}px`, lineHeight: 1, flexShrink: 0 }} />;
    }

    // 3. Styled character fallback
    const { char, css } = textFallback(id);
    return (
        <span style={{ fontSize: `${size - 2}px`, lineHeight: 1, flexShrink: 0, minWidth: `${size}px`, textAlign: "center", ...css }}>
            {char}
        </span>
    );
}

// ─── Micro helpers ────────────────────────────────────────────────────────────

function Xbtn({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button" className="btn btn-link btn-sm p-0"
            onClick={e => { e.stopPropagation(); onClick(); }}
            style={{ color: "var(--bs-danger, #dc3545)", lineHeight: 1, flexShrink: 0, fontSize: "11px", marginLeft: "1px" }}
            title={t("toolbar_customization.remove_item")}
        >×</button>
    );
}

function DropLine({ active }: { active: boolean }) {
    return (
        <div style={{
            width: active ? "3px" : "0px", height: "20px", borderRadius: "2px",
            background: "var(--bs-primary, #0d6efd)",
            flexShrink: 0, transition: "width .08s",
        }} />
    );
}
