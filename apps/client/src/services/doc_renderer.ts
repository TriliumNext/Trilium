import type FNote from "../entities/fnote.js";
import { applyReferenceLinks } from "../widgets/type_widgets/text/read_only_helper.js";
import { t } from "./i18n.js";
import { formatCodeBlocks } from "./syntax_highlight.js";

/**
 * The pages that ship with the application, named by the `docName` label that selects one. Their
 * text lives in the translation catalog under `doc_notes`, so a name is only ever a key into this
 * closed set — a label carrying anything else resolves to nothing at all.
 */
const DOC_NAMES = [
    "hidden",
    "launchbar_command_launcher",
    "launchbar_history_navigation",
    "launchbar_intro",
    "launchbar_note_launcher",
    "launchbar_quick_search",
    "launchbar_script_launcher",
    "launchbar_spacer",
    "launchbar_widget_launcher",
    "share",
    "system_state",
    "task_state",
    "task_states",
    "user_hidden"
] as const;

export type DocName = (typeof DOC_NAMES)[number];

export function isDocName(value: string): value is DocName {
    return (DOC_NAMES as readonly string[]).includes(value);
}

export default async function renderDoc(note: FNote) {
    const $content = $("<div>");
    const docName = note.getLabelValue("docName");

    if (!docName) {
        return $content;
    }

    if (!isDocName(docName)) {
        console.error(`Unknown docName: ${docName}`);
        return $content;
    }

    $content.html(t(`doc_notes.${docName}`, { sample: SAMPLES[docName] }));

    formatCodeBlocks($content);

    // Apply reference links.
    await applyReferenceLinks($content[0]);

    return $content;
}

/**
 * Code examples are not prose and have no business in the catalog, so the pages that carry one
 * leave a `sample` placeholder for it. i18next escapes what it interpolates, which is what keeps
 * the markup in the examples from being parsed as markup.
 */
const SAMPLES: Partial<Record<DocName, string>> = {
    launchbar_script_launcher: `api.showMessage("Current note is " + api.getActiveContextNote().title);`,
    launchbar_widget_launcher: `const TPL = \`<div style="height: 53px; width: 53px;"></div>\`;

class ExampleLaunchbarWidget extends api.NoteContextAwareWidget {
    doRender() {
        this.$widget = $(TPL);
    }

    async refreshWithNote(note) {
        this.$widget.css("background-color", this.stringToColor(note.title));
    }

    stringToColor(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }

        let color = '#';
        for (let i = 0; i < 3; i++) {
            const value = (hash >> (i * 8)) & 0xFF;
            color += ('00' + value.toString(16)).substr(-2);
        }

        return color;
    }
}

module.exports = new ExampleLaunchbarWidget();`
};
