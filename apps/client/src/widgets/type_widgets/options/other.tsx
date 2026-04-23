import { SANITIZER_DEFAULT_ALLOWED_TAGS } from "@triliumnext/commons";
import { useMemo } from "preact/hooks";

import { t } from "../../../services/i18n";
import search from "../../../services/search";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { isElectron } from "../../../services/utils";
import { Badge } from "../../react/Badge";
import Button from "../../react/Button";
import FormText from "../../react/FormText";
import FormTextBox, { FormTextBoxWithUnit } from "../../react/FormTextBox";
import { useTriliumOption, useTriliumOptionBool, useTriliumOptionJson } from "../../react/hooks";
import OptionsRow, { OptionsRowWithButton, OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import TimeSelector from "./components/TimeSelector";

export default function OtherSettings() {
    return (
        <>
            <SearchSettings />
            {isElectron() && <>
                <SearchEngineSettings />
                <TrayOptionsSettings />
            </>}
            <NoteErasureTimeout />
            <AttachmentErasureTimeout />
            <RevisionSettings />
            <HtmlImportTags />
            <ShareSettings />
            <NetworkSettings />
        </>
    );
}

function SearchSettings() {
    const [ fuzzyEnabled, setFuzzyEnabled ] = useTriliumOptionBool("searchEnableFuzzyMatching");
    const [ autocompleteFuzzy, setAutocompleteFuzzy ] = useTriliumOptionBool("searchAutocompleteFuzzy");

    return (
        <OptionsSection title={t("search.title")}>
            <OptionsRowWithToggle
                name="search-fuzzy-matching"
                label={t("search.fuzzy_matching_label")}
                description={t("search.fuzzy_matching_description")}
                currentValue={fuzzyEnabled}
                onChange={setFuzzyEnabled}
            />

            <OptionsRowWithToggle
                name="search-autocomplete-fuzzy"
                label={t("search.autocomplete_fuzzy_label")}
                description={t("search.autocomplete_fuzzy_description")}
                currentValue={autocompleteFuzzy}
                onChange={setAutocompleteFuzzy}
            />
        </OptionsSection>
    );
}

function SearchEngineSettings() {
    const [ customSearchEngineName, setCustomSearchEngineName ] = useTriliumOption("customSearchEngineName");
    const [ customSearchEngineUrl, setCustomSearchEngineUrl ] = useTriliumOption("customSearchEngineUrl");

    const searchEngines = useMemo(() => {
        return [
            { url: "https://duckduckgo.com/?q={keyword}", name: t("search_engine.duckduckgo") },
            { url: "https://www.bing.com/search?q={keyword}", name: t("search_engine.bing"), icon: "bx bxl-bing" },
            { url: "https://www.baidu.com/s?wd={keyword}", name: t("search_engine.baidu"), icon: "bx bxl-baidu" },
            { url: "https://www.google.com/search?q={keyword}", name: t("search_engine.google"), icon: "bx bxl-google" }
        ];
    }, []);

    return (
        <OptionsSection title={t("search_engine.title")} description={t("search_engine.custom_search_engine_info")}>
            <OptionsRow name="predefined-templates" label={t("search_engine.predefined_templates_label")}>
                <div className="search-engine-templates">
                    {searchEngines.map(engine => (
                        <Badge
                            key={engine.url}
                            icon={engine.icon}
                            text={engine.name}
                            className={customSearchEngineUrl === engine.url ? "selected" : ""}
                            onClick={() => {
                                setCustomSearchEngineName(engine.name);
                                setCustomSearchEngineUrl(engine.url);
                            }}
                        />
                    ))}
                </div>
            </OptionsRow>

            <OptionsRow name="custom-name" label={t("search_engine.custom_name_label")}>
                <FormTextBox
                    currentValue={customSearchEngineName} onBlur={setCustomSearchEngineName}
                    placeholder={t("search_engine.custom_name_placeholder")}
                />
            </OptionsRow>

            <OptionsRow name="custom-url" label={t("search_engine.custom_url_label")} description={t("search_engine.custom_url_description")} stacked>
                <FormTextBox
                    currentValue={customSearchEngineUrl} onBlur={setCustomSearchEngineUrl}
                    placeholder={t("search_engine.custom_url_placeholder")}
                />
            </OptionsRow>
        </OptionsSection>
    );
}

function TrayOptionsSettings() {
    const [ disableTray, setDisableTray ] = useTriliumOptionBool("disableTray");

    return (
        <OptionsSection title={t("tray.title")}>
            <OptionsRowWithToggle
                name="tray-enabled"
                label={t("tray.enable_tray")}
                description={t("tray.enable_tray_description")}
                currentValue={!disableTray}
                onChange={trayEnabled => setDisableTray(!trayEnabled)}
            />
        </OptionsSection>
    );
}

function NoteErasureTimeout() {
    return (
        <OptionsSection title={t("note_erasure_timeout.note_erasure_timeout_title")}>
            <FormText>{t("note_erasure_timeout.description")}</FormText>

            <OptionsRow name="erase-entities-after" label={t("note_erasure_timeout.erase_notes_after")} description={t("note_erasure_timeout.erase_notes_after_description")}>
                <TimeSelector
                    name="erase-entities-after"
                    optionValueId="eraseEntitiesAfterTimeInSeconds" optionTimeScaleId="eraseEntitiesAfterTimeScale"
                />
            </OptionsRow>

            <OptionsRowWithButton
                label={t("note_erasure_timeout.erase_deleted_notes_now")}
                description={t("note_erasure_timeout.manual_erasing_description")}
                onClick={() => {
                    server.post("notes/erase-deleted-notes-now").then(() => {
                        toast.showMessage(t("note_erasure_timeout.deleted_notes_erased"));
                    });
                }}
            />
        </OptionsSection>
    );
}

function AttachmentErasureTimeout() {
    return (
        <OptionsSection title={t("attachment_erasure_timeout.attachment_erasure_timeout")}>
            <FormText>{t("attachment_erasure_timeout.description")}</FormText>

            <OptionsRow name="erase-unused-attachments-after" label={t("attachment_erasure_timeout.erase_attachments_after")} description={t("attachment_erasure_timeout.erase_attachments_after_description")}>
                <TimeSelector
                    name="erase-unused-attachments-after"
                    optionValueId="eraseUnusedAttachmentsAfterSeconds" optionTimeScaleId="eraseUnusedAttachmentsAfterTimeScale"
                />
            </OptionsRow>

            <OptionsRowWithButton
                label={t("attachment_erasure_timeout.erase_unused_attachments_now")}
                description={t("attachment_erasure_timeout.manual_erasing_description")}
                onClick={() => {
                    server.post("notes/erase-unused-attachments-now").then(() => {
                        toast.showMessage(t("attachment_erasure_timeout.unused_attachments_erased"));
                    });
                }}
            />
        </OptionsSection>
    );
}

function RevisionSettings() {
    const [ revisionSnapshotNumberLimit, setRevisionSnapshotNumberLimit ] = useTriliumOption("revisionSnapshotNumberLimit");

    return (
        <OptionsSection title={t("revisions_snapshot.title")}>
            <OptionsRow name="revision-snapshot-time-interval" label={t("revisions_snapshot_interval.snapshot_time_interval_label")} description={t("revisions_snapshot_interval.note_revisions_snapshot_description_short")}>
                <TimeSelector
                    name="revision-snapshot-time-interval"
                    optionValueId="revisionSnapshotTimeInterval" optionTimeScaleId="revisionSnapshotTimeIntervalTimeScale"
                    minimumSeconds={10}
                />
            </OptionsRow>

            <OptionsRow name="revision-snapshot-number-limit" label={t("revisions_snapshot_limit.snapshot_number_limit_label")} description={t("revisions_snapshot_limit.note_revisions_snapshot_limit_description_short")}>
                <FormTextBoxWithUnit
                    type="number" min={-1}
                    currentValue={revisionSnapshotNumberLimit}
                    unit={t("revisions_snapshot_limit.snapshot_number_limit_unit")}
                    onBlur={value => {
                        const newValue = parseInt(value, 10);
                        if (!isNaN(newValue) && newValue >= -1) {
                            setRevisionSnapshotNumberLimit(newValue);
                        }
                    }}
                />
            </OptionsRow>

            <OptionsRowWithButton
                label={t("revisions_snapshot_limit.erase_excess_revision_snapshots")}
                description={t("revisions_snapshot_limit.erase_excess_revision_snapshots_description")}
                onClick={async () => {
                    await server.post("revisions/erase-all-excess-revisions");
                    toast.showMessage(t("revisions_snapshot_limit.erase_excess_revision_snapshots_prompt"));
                }}
            />
        </OptionsSection>
    );
}

function HtmlImportTags() {
    const [ allowedHtmlTags, setAllowedHtmlTags ] = useTriliumOptionJson<readonly string[]>("allowedHtmlTags");

    const parsedValue = useMemo(() => {
        return allowedHtmlTags.join(" ");
    }, allowedHtmlTags);

    return (
        <OptionsSection title={t("import.html_import_tags.title")}>
            <FormText>{t("import.html_import_tags.description")}</FormText>

            <textarea
                className="allowed-html-tags"
                spellcheck={false}
                placeholder={t("import.html_import_tags.placeholder")}
                style={useMemo(() => ({
                    width: "100%",
                    height: "150px",
                    marginBottom: "12px",
                    fontFamily: "var(--monospace-font-family)"
                }), [])}
                value={parsedValue}
                onBlur={e => {
                    const tags = e.currentTarget.value
                        .split(/[\n,\s]+/) // Split on newlines, commas, or spaces
                        .map((tag) => tag.trim())
                        .filter((tag) => tag.length > 0);
                    setAllowedHtmlTags(tags);
                }}
            />

            <Button
                text={t("import.html_import_tags.reset_button")}
                onClick={() => setAllowedHtmlTags(SANITIZER_DEFAULT_ALLOWED_TAGS)}
            />
        </OptionsSection>
    );
}

function ShareSettings() {
    const [ redirectBareDomain, setRedirectBareDomain ] = useTriliumOptionBool("redirectBareDomain");
    const [ showLogInShareTheme, setShowLogInShareTheme ] = useTriliumOptionBool("showLoginInShareTheme");

    return (
        <OptionsSection title={t("share.title")}>
            <OptionsRowWithToggle
                name="redirect-bare-domain"
                label={t("share.redirect_bare_domain")}
                description={t("share.redirect_bare_domain_description")}
                currentValue={redirectBareDomain}
                onChange={async value => {
                    if (value) {
                        const shareRootNotes = await search.searchForNotes("#shareRoot");
                        const sharedShareRootNote = shareRootNotes.find((note) => note.isShared());

                        if (sharedShareRootNote) {
                            toast.showMessage(t("share.share_root_found", { noteTitle: sharedShareRootNote.title }));
                        } else if (shareRootNotes.length > 0) {
                            toast.showError(t("share.share_root_not_shared", { noteTitle: shareRootNotes[0].title }));
                        } else {
                            toast.showError(t("share.share_root_not_found"));
                        }
                    }
                    setRedirectBareDomain(value);
                }}
            />

            <OptionsRowWithToggle
                name="show-login-in-share-theme"
                label={t("share.show_login_link")}
                description={t("share.show_login_link_description")}
                currentValue={showLogInShareTheme}
                onChange={setShowLogInShareTheme}
            />
        </OptionsSection>
    );
}

function NetworkSettings() {
    const [ checkForUpdates, setCheckForUpdates ] = useTriliumOptionBool("checkForUpdates");

    return (
        <OptionsSection title={t("network_connections.network_connections_title")}>
            <OptionsRowWithToggle
                name="check-for-updates"
                label={t("network_connections.check_for_updates")}
                description={t("network_connections.check_for_updates_description")}
                currentValue={checkForUpdates}
                onChange={setCheckForUpdates}
            />
        </OptionsSection>
    );
}
