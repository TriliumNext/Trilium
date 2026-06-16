import "./code_mime_types_list.css";

import { default as codeNoteMimeTypes } from "@triliumnext/codemirror/src/syntax_highlighting";
import { MimeType } from "@triliumnext/commons";
import { byMimeType as codeBlockMimeTypes } from "@triliumnext/highlightjs/src/syntax_highlighting";
import type { Tooltip } from "bootstrap";
import { useMemo, useRef } from "preact/hooks";

import { t } from "../../../services/i18n";
import mime_types from "../../../services/mime_types";
import { useStaticTooltip, useTriliumOptionJson } from "../../react/hooks";
import CheckboxList from "./components/CheckboxList";

type MimeTypeWithDisabled = MimeType & { disabled?: boolean };

/**
 * Lives in its own module (rather than in `code_notes.tsx`) because it is also rendered by the
 * always-loaded basic properties tab, while the rest of the code note options pull in the full
 * CodeMirror bundle. Only the lightweight syntax highlighting tables are imported here.
 */
export function CodeMimeTypesList() {
    const containerRef = useRef<HTMLUListElement>(null);
    // The config must keep a stable reference: `useStaticTooltip` re-runs (tearing down and
    // recreating the delegated tooltip) whenever the config identity changes. Toggling a checkbox
    // re-renders this component, so an inline config would recreate the tooltip on every toggle and
    // leave a stale, disposed delegated instance on the label that was just clicked — that label
    // then loses its tooltip until the page is reopened. The callback only reads static syntax
    // tables, so the memo has no dependencies.
    const tooltipConfig = useMemo<Partial<Tooltip.Options>>(() => ({
        title() {
            const mime = this.querySelector("input")?.value;
            if (!mime || mime === "text/plain") return "";

            const hasCodeBlockSyntax = !!codeBlockMimeTypes[mime];
            const hasCodeNoteSyntax = !!codeNoteMimeTypes[mime];

            return `
                <strong>${t("code_mime_types.tooltip_syntax_highlighting")}</strong>
                ${hasCodeBlockSyntax ? "✅" : "❌"} ${t("code_mime_types.tooltip_code_block_syntax")}
                ${hasCodeNoteSyntax ? "✅" : "❌"} ${t("code_mime_types.tooltip_code_note_syntax")}
            `;
        },
        selector: "label",
        customClass: "tooltip-top",
        placement: "left",
        fallbackPlacements: [ "left", "right" ],
        animation: false,
        html: true,
        // Hover only: clicking a label focuses the wrapped checkbox, and the default "hover focus"
        // trigger would keep the tooltip pinned via that focus after the mouse leaves, causing it to
        // overlap the next hovered label's tooltip.
        trigger: "hover"
    }), []);
    useStaticTooltip(containerRef, tooltipConfig);
    const [ codeNotesMimeTypes, setCodeNotesMimeTypes ] = useTriliumOptionJson<string[]>("codeNotesMimeTypes");
    const groupedMimeTypes: Record<string, MimeType[]> = useMemo(() => {
        mime_types.loadMimeTypes();

        const ungroupedMimeTypes = Array.from(mime_types.getMimeTypes()) as MimeTypeWithDisabled[];
        const plainTextMimeType = ungroupedMimeTypes.shift();
        const result: Record<string, MimeType[]> = {};
        ungroupedMimeTypes.sort((a, b) => a.title.localeCompare(b.title));

        if (plainTextMimeType) {
            result[""] = [ plainTextMimeType ];
            plainTextMimeType.enabled = true;
            plainTextMimeType.disabled = true;
        }

        for (const mimeType of ungroupedMimeTypes) {
            const initial = mimeType.title.charAt(0).toUpperCase();
            if (!result[initial]) {
                result[initial] = [];
            }
            result[initial].push(mimeType);
        }
        return result;
        // The available mime types are static; the memo does not read the user's selection
        // (`codeNotesMimeTypes`), so it must not re-group on every checkbox toggle.
    }, []);

    return (
        <ul class="options-mime-types" ref={containerRef}>
            {Object.entries(groupedMimeTypes).map(([ initial, mimeTypes ]) => (
                <section>
                    { initial && <h5>{initial}</h5> }
                    <CheckboxList
                        values={mimeTypes as MimeTypeWithDisabled[]}
                        keyProperty="mime" titleProperty="title" disabledProperty="disabled"
                        currentValue={codeNotesMimeTypes} onChange={setCodeNotesMimeTypes}
                        columnWidth="inherit"
                    />
                </section>
            ))}
        </ul>
    );
}
