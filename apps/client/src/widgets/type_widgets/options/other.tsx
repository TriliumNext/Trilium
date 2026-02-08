import { SANITIZER_DEFAULT_ALLOWED_TAGS } from "@triliumnext/commons";
import { useMemo } from "preact/hooks";
import type React from "react";
import { Trans } from "react-i18next";

import { t } from "../../../services/i18n";
import search from "../../../services/search";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { isElectron } from "../../../services/utils";
import Button from "../../react/Button";
import FormCheckbox from "../../react/FormCheckbox";
import FormGroup from "../../react/FormGroup";
import FormSelect from "../../react/FormSelect";
import FormText from "../../react/FormText";
import FormTextBox, { FormTextBoxWithUnit } from "../../react/FormTextBox";
import { useTriliumOption, useTriliumOptionBool, useTriliumOptionJson } from "../../react/hooks";
import OptionsSection from "./components/OptionsSection";
import TimeSelector from "./components/TimeSelector";

export default function OtherSettings() {
    return (
        <>
            {isElectron() && <>
                <SearchEngineSettings />
                <TrayOptionsSettings />
            </>}
            <NoteErasureTimeout />
            <AttachmentErasureTimeout />
            <RevisionSnapshotInterval />
            <RevisionSnapshotLimit />
            <HtmlImportTags />
            <ShareSettings />
            <NetworkSettings />
        </>
    );
}

function SearchEngineSettings() {
    const [ customSearchEngineName, setCustomSearchEngineName ] = useTriliumOption("customSearchEngineName");
    const [ customSearchEngineUrl, setCustomSearchEngineUrl ] = useTriliumOption("customSearchEngineUrl");

    const searchEngines = useMemo(() => {
        return [
            { url: "https://www.bing.com/search?q={keyword}", name: t("search_engine.bing") },
            { url: "https://www.baidu.com/s?wd={keyword}", name: t("search_engine.baidu") },
            { url: "https://duckduckgo.com/?q={keyword}", name: t("search_engine.duckduckgo") },
            { url: "https://www.google.com/search?q={keyword}", name: t("search_engine.google") }
        ];
    }, []);

    return (
        <OptionsSection title={t("search_engine.title")}>
            <FormText>{t("search_engine.custom_search_engine_info")}</FormText>

            <FormGroup name="predefined-search-engine" label={t("search_engine.predefined_templates_label")}>
                <FormSelect
                    values={searchEngines}
                    currentValue={customSearchEngineUrl}
                    keyProperty="url" titleProperty="name"
                    onChange={newValue => {
                        const searchEngine = searchEngines.find(e => e.url === newValue);
                        if (!searchEngine) {
                            return;
                        }

                        setCustomSearchEngineName(searchEngine.name);
                        setCustomSearchEngineUrl(searchEngine.url);
                    }}
                />
            </FormGroup>

            <FormGroup name="custom-name" label={t("search_engine.custom_name_label")}>
                <FormTextBox
                    currentValue={customSearchEngineName} onChange={setCustomSearchEngineName}
                    placeholder={t("search_engine.custom_name_placeholder")}
                />
            </FormGroup>

            <FormGroup name="custom-url" label={t("search_engine.custom_url_label")}>
                <FormTextBox
                    currentValue={customSearchEngineUrl} onChange={setCustomSearchEngineUrl}
                    placeholder={t("search_engine.custom_url_placeholder")}
                />
            </FormGroup>
        </OptionsSection>
    );
}

function TrayOptionsSettings() {
    const [ disableTray, setDisableTray ] = useTriliumOptionBool("disableTray");

    return (
        <OptionsSection title={t("tray.title")}>
            <FormCheckbox
                name="tray-enabled"
                label={t("tray.enable_tray")}
                currentValue={!disableTray}
                onChange={trayEnabled => setDisableTray(!trayEnabled)}
            />
        </OptionsSection>
    );
}

function NoteErasureTimeout() {
    return (
        <OptionsSection title={t("note_erasure_timeout.note_erasure_timeout_title")}>
            <FormText>{t("note_erasure_timeout.note_erasure_description")}</FormText>
            <FormGroup name="erase-entities-after" label={t("note_erasure_timeout.erase_notes_after")}>
                <TimeSelector
                    name="erase-entities-after"
                    optionValueId="eraseEntitiesAfterTimeInSeconds" optionTimeScaleId="eraseEntitiesAfterTimeScale"
                />
            </FormGroup>
            <FormText>{t("note_erasure_timeout.manual_erasing_description")}</FormText>

            <Button
                text={t("note_erasure_timeout.erase_deleted_notes_now")}
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
            <FormText>{t("attachment_erasure_timeout.attachment_auto_deletion_description")}</FormText>
            <FormGroup name="erase-unused-attachments-after" label={t("attachment_erasure_timeout.erase_attachments_after")}>
                <TimeSelector
                    name="erase-unused-attachments-after"
                    optionValueId="eraseUnusedAttachmentsAfterSeconds" optionTimeScaleId="eraseUnusedAttachmentsAfterTimeScale"
                />
            </FormGroup>
            <FormText>{t("attachment_erasure_timeout.manual_erasing_description")}</FormText>

            <Button
                text={t("attachment_erasure_timeout.erase_unused_attachments_now")}
                onClick={() => {
                    server.post("notes/erase-unused-attachments-now").then(() => {
                        toast.showMessage(t("attachment_erasure_timeout.unused_attachments_erased"));
                    });
                }}
            />
        </OptionsSection>
    );
}

function RevisionSnapshotInterval() {
    return (
        <OptionsSection title={t("revisions_snapshot_interval.note_revisions_snapshot_interval_title")}>
            <FormText>
                <Trans
                    i18nKey="revisions_snapshot_interval.note_revisions_snapshot_description"
                    components={{ doc: <a href="https://triliumnext.github.io/Docs/Wiki/note-revisions.html" class="external" /> as React.ReactElement }}
                />
            </FormText>
            <FormGroup name="revision-snapshot-time-interval" label={t("revisions_snapshot_interval.snapshot_time_interval_label")}>
                <TimeSelector
                    name="revision-snapshot-time-interval"
                    optionValueId="revisionSnapshotTimeInterval" optionTimeScaleId="revisionSnapshotTimeIntervalTimeScale"
                    minimumSeconds={10}
                />
            </FormGroup>
        </OptionsSection>
    );
}

function RevisionSnapshotLimit() {
    const [ revisionSnapshotNumberLimit, setRevisionSnapshotNumberLimit ] = useTriliumOption("revisionSnapshotNumberLimit");

    return (
        <OptionsSection title={t("revisions_snapshot_limit.note_revisions_snapshot_limit_title")}>
            <FormText>{t("revisions_snapshot_limit.note_revisions_snapshot_limit_description")}</FormText>

            <FormGroup name="revision-snapshot-number-limit">
                <FormTextBoxWithUnit
                    type="number" min={-1}
                    currentValue={revisionSnapshotNumberLimit}
                    unit={t("revisions_snapshot_limit.snapshot_number_limit_unit")}
                    onChange={value => {
                        const newValue = parseInt(value, 10);
                        if (!isNaN(newValue) && newValue >= -1) {
                            setRevisionSnapshotNumberLimit(newValue);
                        }
                    }}
                />
            </FormGroup>

            <Button
                text={t("revisions_snapshot_limit.erase_excess_revision_snapshots")}
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
            <FormGroup name="redirectBareDomain" description={t("share.redirect_bare_domain_description")}>
                <FormCheckbox
                    label={t(t("share.redirect_bare_domain"))}
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
            </FormGroup>

            <FormGroup name="showLoginInShareTheme" description={t("share.show_login_link_description")}>
                <FormCheckbox
                    label={t("share.show_login_link")}
                    currentValue={showLogInShareTheme} onChange={setShowLogInShareTheme}
                />
            </FormGroup>
        </OptionsSection>
    );
}

function NetworkSettings() {
    const [ checkForUpdates, setCheckForUpdates ] = useTriliumOptionBool("checkForUpdates");

    return (
        <OptionsSection title={t("network_connections.network_connections_title")}>
            <FormCheckbox
                name="check-for-updates"
                label={t("network_connections.check_for_updates")}
                currentValue={checkForUpdates} onChange={setCheckForUpdates}
            />
        </OptionsSection>
    );
}
