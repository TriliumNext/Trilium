import type { MenuItem } from "../menus/context_menu.js";
import type { TreeCommandNames } from "../menus/tree_context_menu.js";
import { setLabel } from "./attributes.js";
import { t } from "./i18n.js";
import type { CreateNoteOpts } from "./note_create.js";
import server from "./server.js";

/**
 * Code notes made ready for a scripting role: the language, the label that gives the role and, for
 * a widget, a skeleton to start from. The note owns the label, so removing it turns the role off.
 *
 * Titles and content are resolved when used, as `note_create.ts` imports this module before the
 * translations are loaded.
 */
const NOTE_PRESETS = {
    appCss: {
        titleKey: "active_content_badges.type_app_css",
        icon: "bx bxs-file-css",
        mime: "text/css",
        label: "appCss"
    },
    widget: {
        titleKey: "active_content_badges.type_widget",
        icon: "bx bxs-widget",
        mime: "text/jsx",
        label: "widget",
        content: () => [
            `import { defineWidget } from "trilium:preact";`,
            "",
            "export default defineWidget({",
            `    parent: "center-pane",`,
            `    render: () => <span>${t("note_types.widget-preset-sample")}</span>`,
            "});",
            ""
        ].join("\n")
    },
    backendScript: {
        titleKey: "active_content_badges.type_backend_script",
        icon: "bx bx-server",
        mime: "application/javascript;env=backend"
    }
} satisfies Record<string, NotePreset>;

export type NotePresetId = keyof typeof NOTE_PRESETS;

interface NotePreset {
    titleKey: string;
    /** The icon class, `bx` prefix included. */
    icon: string;
    mime: string;
    label?: string;
    content?: () => string;
}

/** What `createNote` is given to make a note of the preset, or nothing without one. */
export function notePresetOptions(
    id: NotePresetId | undefined
): Pick<CreateNoteOpts, "type" | "mime" | "content" | "attributes"> {
    if (!id) return {};
    const preset: NotePreset = NOTE_PRESETS[id];
    return {
        type: "code",
        mime: preset.mime,
        content: preset.content?.() ?? "",
        attributes: preset.label ? [ { type: "label", name: preset.label, value: "" } ] : []
    };
}

/** Turns an existing, empty note into one of the preset. */
export async function applyNotePreset(noteId: string, id: NotePresetId) {
    const { mime, content, attributes } = notePresetOptions(id);
    await server.put(`notes/${noteId}/type`, { type: "code", mime });
    if (content) await server.put(`notes/${noteId}/data`, { content });
    for (const { name, value } of attributes ?? []) {
        await setLabel(noteId, name, value);
    }
}

/** The note type menu's rows, one per preset. */
export function getNotePresetItems(command?: TreeCommandNames): MenuItem<TreeCommandNames>[] {
    return (Object.keys(NOTE_PRESETS) as NotePresetId[]).map((id) => {
        const preset: NotePreset = NOTE_PRESETS[id];
        return {
            title: t(preset.titleKey),
            uiIcon: preset.icon,
            command,
            type: "code",
            mime: preset.mime,
            notePreset: id
        };
    });
}
