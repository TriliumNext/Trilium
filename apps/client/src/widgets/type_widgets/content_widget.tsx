import TypeWidget from "./type_widget.js";
import type FNote from "../../entities/fnote.js";
import type NoteContextAwareWidget from "../note_context_aware_widget.js";
import { t } from "../../services/i18n.js";
import type { JSX } from "preact/jsx-runtime";
import AppearanceSettings from "./options/appearance.jsx";
import { disposeReactWidget, renderReactWidgetAtElement } from "../react/react_utils.jsx";
import ImageSettings from "./options/images.jsx";
import AdvancedSettings from "./options/advanced.jsx";
import InternationalizationOptions from "./options/i18n.jsx";
import SyncOptions from "./options/sync.jsx";
import EtapiSettings from "./options/etapi.js";
import BackupSettings from "./options/backup.js";
import SpellcheckSettings from "./options/spellcheck.js";
import PasswordSettings from "./options/password.jsx";
import ShortcutSettings from "./options/shortcuts.js";
import TextNoteSettings from "./options/text_notes.jsx";
import CodeNoteSettings from "./options/code_notes.jsx";
import OtherSettings from "./options/other.jsx";
import BackendLogWidget from "./content/backend_log.js";
import MultiFactorAuthenticationSettings from "./options/multi_factor_authentication.js";
import AiSettings from "./options/ai_settings.jsx";
import { unmountComponentAtNode } from "preact/compat";

const TPL = /*html*/`<div class="note-detail-content-widget note-detail-printable">
    <style>
        .type-contentWidget .note-detail {
            height: 100%;
        }

        .note-detail-content-widget {
            height: 100%;
        }

        .note-detail-content-widget-content {
            padding: 15px;
            height: 100%;
        }

        .note-detail.full-height .note-detail-content-widget-content {
            padding: 0;
        }
    </style>

    <div class="note-detail-content-widget-content"></div>
</div>`;

export type OptionPages = "_optionsAppearance" | "_optionsShortcuts" | "_optionsTextNotes" | "_optionsCodeNotes" | "_optionsImages" | "_optionsSpellcheck" | "_optionsPassword" | "_optionsMFA" | "_optionsEtapi" | "_optionsBackup" | "_optionsSync" | "_optionsAi" | "_optionsOther" | "_optionsLocalization" | "_optionsAdvanced";

const CONTENT_WIDGETS: Record<OptionPages | "_backendLog", ((typeof NoteContextAwareWidget)[] | JSX.Element)> = {
    _optionsAppearance: <AppearanceSettings />,
    _optionsShortcuts: <ShortcutSettings />,
    _optionsTextNotes: <TextNoteSettings />,
    _optionsCodeNotes: <CodeNoteSettings />,
    _optionsImages: <ImageSettings />,
    _optionsSpellcheck: <SpellcheckSettings />,
    _optionsPassword: <PasswordSettings />,
    _optionsMFA: <MultiFactorAuthenticationSettings />,
    _optionsEtapi: <EtapiSettings />,
    _optionsBackup: <BackupSettings />,
    _optionsSync: <SyncOptions />,
    _optionsAi: <AiSettings />,
    _optionsOther: <OtherSettings />,
    _optionsLocalization: <InternationalizationOptions />,
    _optionsAdvanced: <AdvancedSettings />,
    _backendLog: [
        BackendLogWidget
    ]
};

/**
 * Type widget that displays one or more widgets based on the type of note, generally used for options and other interactive notes such as the backend log.
 *
 * One important aspect is that, like its parent {@link TypeWidget}, the content widgets don't receive all events by default and they must be manually added
 * to the propagation list in {@link TypeWidget.handleEventInChildren}.
 */
export default class ContentWidgetTypeWidget extends TypeWidget {
    private $content!: JQuery<HTMLElement>;

    static getType() {
        return "contentWidget";
    }

    doRender() {
        this.$widget = $(TPL);
        this.$content = this.$widget.find(".note-detail-content-widget-content");

        super.doRender();
    }

    async doRefresh(note: FNote) {
        unmountComponentAtNode(this.$content[0]);
        this.$content.empty();
        this.children = [];

        const contentWidgets = (CONTENT_WIDGETS as Record<string, (typeof NoteContextAwareWidget[] | JSX.Element)>)[note.noteId];
        this.$content.toggleClass("options", note.noteId.startsWith("_options"));

        // Unknown widget.
        if (!contentWidgets) {
            this.$content.append(t("content_widget.unknown_widget", { id: note.noteId }));
            return;
        }

        // Legacy widget.
        if (Array.isArray(contentWidgets)) {
            for (const clazz of contentWidgets) {
                const widget = new clazz();

                if (this.noteContext) {
                    await widget.handleEvent("setNoteContext", { noteContext: this.noteContext });
                }
                this.child(widget);

                this.$content.append(widget.render());
                await widget.refresh();
            }
            return;
        }

        // React widget.
        renderReactWidgetAtElement(this, contentWidgets, this.$content[0]);
    }

    cleanup(): void {
        if (this.noteId) {
            const contentWidgets = (CONTENT_WIDGETS as Record<string, (typeof NoteContextAwareWidget[] | JSX.Element)>)[this.noteId];
            if (contentWidgets && !Array.isArray(contentWidgets)) {
                disposeReactWidget(this.$content[0]);
            }
        }

        super.cleanup();
    }

}
