import "./ContentWidget.css";

import { JSX } from "preact/jsx-runtime";

import { t } from "../../services/i18n";
import BackendLog from "./code/BackendLog";
import ActiveContentSettings from "./options/active_content";
import AdvancedSettings from "./options/advanced";
import AppearanceSettings from "./options/appearance";
import BackupSettings from "./options/backup";
import CodeNoteSettings from "./options/code_notes";
import DatabaseSettings from "./options/database";
import DesktopSettings from "./options/desktop";
import EtapiSettings from "./options/etapi";
import InternationalizationOptions from "./options/i18n";
import LlmSettings from "./options/llm";
import MediaSettings from "./options/media";
import OtherSettings from "./options/other";
import PasswordSettings from "./options/password";
import PluginsSettings from "./options/plugins";
import SecuritySettings from "./options/security";
import ShortcutSettings from "./options/shortcuts";
import SpellcheckSettings from "./options/spellcheck";
import SyncOptions from "./options/sync";
import TextNoteSettings from "./options/text_notes";
import SpaceUsage from "./space_usage";
import { TypeWidgetProps } from "./type_widget";

export type OptionPages = "_optionsAppearance" | "_optionsShortcuts" | "_optionsTextNotes" | "_optionsCodeNotes" | "_optionsContentManager" | "_optionsMedia" | "_optionsSpellcheck" | "_optionsPassword" | "_optionsEtapi" | "_optionsBackup" | "_optionsDatabase" | "_optionsSync" | "_optionsDesktop" | "_optionsOther" | "_optionsLocalization" | "_optionsSecurity" | "_optionsAdvanced" | "_optionsLlm" | "_optionsPlugins";

/** The page behind each of these notes. Exported for the options search, which renders them all. */
export const CONTENT_WIDGETS: Record<OptionPages | "_backendLog" | "_spaceUsage", (props: TypeWidgetProps) => JSX.Element> = {
    _optionsAppearance: AppearanceSettings,
    _optionsShortcuts: ShortcutSettings,
    _optionsTextNotes: TextNoteSettings,
    _optionsCodeNotes: CodeNoteSettings,
    _optionsContentManager: ActiveContentSettings,
    _optionsMedia: MediaSettings,
    _optionsSpellcheck: SpellcheckSettings,
    _optionsPassword: PasswordSettings,
    _optionsEtapi: EtapiSettings,
    _optionsBackup: BackupSettings,
    _optionsDatabase: DatabaseSettings,
    _optionsSync: SyncOptions,
    _optionsDesktop: DesktopSettings,
    _optionsOther: OtherSettings,
    _optionsLocalization: InternationalizationOptions,
    _optionsSecurity: SecuritySettings,
    _optionsAdvanced: AdvancedSettings,
    _optionsLlm: LlmSettings,
    _optionsPlugins: PluginsSettings,
    _backendLog: BackendLog,
    _spaceUsage: SpaceUsage
};

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
    );
}
