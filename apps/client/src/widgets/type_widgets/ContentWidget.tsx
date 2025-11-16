import { TypeWidgetProps } from "./type_widget";
import { JSX } from "preact/jsx-runtime";
import AppearanceSettings from "./options/appearance";
import ShortcutSettings from "./options/shortcuts";
import TextNoteSettings from "./options/text_notes";
import CodeNoteSettings from "./options/code_notes";
import ImageSettings from "./options/images";
import SpellcheckSettings from "./options/spellcheck";
import PasswordSettings from "./options/password";
import MultiFactorAuthenticationSettings from "./options/multi_factor_authentication";
import EtapiSettings from "./options/etapi";
import BackupSettings from "./options/backup";
import SyncOptions from "./options/sync";
import AiSettings from "./options/ai_settings";
import OtherSettings from "./options/other";
import InternationalizationOptions from "./options/i18n";
import AdvancedSettings from "./options/advanced";
import "./ContentWidget.css";
import { t } from "../../services/i18n";
import BackendLog from "./code/BackendLog";

export type OptionPages = "_optionsAppearance" | "_optionsShortcuts" | "_optionsTextNotes" | "_optionsCodeNotes" | "_optionsImages" | "_optionsSpellcheck" | "_optionsPassword" | "_optionsMFA" | "_optionsEtapi" | "_optionsBackup" | "_optionsSync" | "_optionsAi" | "_optionsOther" | "_optionsLocalization" | "_optionsAdvanced";

const CONTENT_WIDGETS: Record<OptionPages | "_backendLog", (props: TypeWidgetProps) => JSX.Element> = {
    _optionsAppearance: AppearanceSettings,
    _optionsShortcuts: ShortcutSettings,
    _optionsTextNotes: TextNoteSettings,
    _optionsCodeNotes: CodeNoteSettings,
    _optionsImages: ImageSettings,
    _optionsSpellcheck: SpellcheckSettings,
    _optionsPassword: PasswordSettings,
    _optionsMFA: MultiFactorAuthenticationSettings,
    _optionsEtapi: EtapiSettings,
    _optionsBackup: BackupSettings,
    _optionsSync: SyncOptions,
    _optionsAi: AiSettings,
    _optionsOther: OtherSettings,
    _optionsLocalization: InternationalizationOptions,
    _optionsAdvanced: AdvancedSettings,
    _backendLog: BackendLog
}

/**
 * Type widget that displays one or more widgets based on the type of note, generally used for options and other interactive notes such as the backend log.
 *
 * @param param0
 * @returns
 */
export default function ContentWidget({ note, ...restProps }: TypeWidgetProps) {
    const Content = CONTENT_WIDGETS[note.noteId];
    return (
        <div className={`note-detail-content-widget-content ${note.noteId.startsWith("_options") ? "options" : ""}`}>
            {Content
                ? <Content note={note} {...restProps} />
                : (t("content_widget.unknown_widget", { id: note.noteId }))}
        </div>
    )
}
