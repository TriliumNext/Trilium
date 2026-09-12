import "./other.css";

import { SANITIZER_DEFAULT_ALLOWED_TAGS } from "@triliumnext/commons";

import { t } from "../../../services/i18n";
import search from "../../../services/search";
import server from "../../../services/server";
import toast from "../../../services/toast";
import Button from "../../react/Button";
import { Card, CardSection, OptionCardSection } from "../../react/Card";
import { FormTextBoxWithUnit } from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import { useTriliumOption, useTriliumOptionBool, useTriliumOptionJson } from "../../react/hooks";
import OptionsPageHeader from "./components/OptionsPageHeader";
import TimeSelector from "./components/TimeSelector";

export default function OtherSettings() {
    return (
        <>
            <OptionsPageHeader />
            <SearchSettings />
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
        <Card heading={t("search.title")}>
            <OptionCardSection
                name="search-fuzzy-matching"
                label={t("search.fuzzy_matching_label")}
                description={t("search.fuzzy_matching_description")}
            >
                <FormToggle currentValue={fuzzyEnabled} onChange={setFuzzyEnabled} />
            </OptionCardSection>

            <OptionCardSection
                name="search-autocomplete-fuzzy"
                label={t("search.autocomplete_fuzzy_label")}
                description={t("search.autocomplete_fuzzy_description")}
            >
                <FormToggle currentValue={autocompleteFuzzy} onChange={setAutocompleteFuzzy} />
            </OptionCardSection>
        </Card>
    );
}

function NoteErasureTimeout() {
    return (
        <Card
            heading={t("note_erasure_timeout.note_erasure_timeout_title")}
            description={t("note_erasure_timeout.description")}
        >
            <OptionCardSection

                name="erase-entities-after"
                label={t("note_erasure_timeout.erase_notes_after")}
                description={t("note_erasure_timeout.erase_notes_after_description")}
            >
                <TimeSelector
                    name="erase-entities-after"
                    optionValueId="eraseEntitiesAfterTimeInSeconds" optionTimeScaleId="eraseEntitiesAfterTimeScale"
                />
            </OptionCardSection>

            <OptionCardSection
                label={t("note_erasure_timeout.erase_deleted_notes_now")}
                description={t("note_erasure_timeout.manual_erasing_description")}
            >
                <Button
                    name="erase-deleted-notes-now-button"
                    text={t("note_erasure_timeout.erase_now_button")}
                    size="micro"
                    onClick={() => {
                        server.post("notes/erase-deleted-notes-now").then(() => {
                            toast.showMessage(t("note_erasure_timeout.deleted_notes_erased"));
                        });
                    }}
                />
            </OptionCardSection>
        </Card>
    );
}

function AttachmentErasureTimeout() {
    return (
        <Card
            heading={t("attachment_erasure_timeout.attachment_erasure_timeout")}
            description={t("attachment_erasure_timeout.description")}
        >
            <OptionCardSection

                name="erase-unused-attachments-after"
                label={t("attachment_erasure_timeout.erase_attachments_after")}
                description={t("attachment_erasure_timeout.erase_attachments_after_description")}
            >
                <TimeSelector
                    name="erase-unused-attachments-after"
                    optionValueId="eraseUnusedAttachmentsAfterSeconds" optionTimeScaleId="eraseUnusedAttachmentsAfterTimeScale"
                />
            </OptionCardSection>

            <OptionCardSection
                label={t("attachment_erasure_timeout.erase_unused_attachments_now")}
                description={t("attachment_erasure_timeout.manual_erasing_description")}
            >
                <Button
                    name="erase-unused-attachments-now-button"
                    text={t("attachment_erasure_timeout.erase_now_button")}
                    size="micro"
                    onClick={() => {
                        server.post("notes/erase-unused-attachments-now").then(() => {
                            toast.showMessage(t("attachment_erasure_timeout.unused_attachments_erased"));
                        });
                    }}
                />
            </OptionCardSection>
        </Card>
    );
}

function RevisionSettings() {
    const [ revisionSnapshotNumberLimit, setRevisionSnapshotNumberLimit ] = useTriliumOption("revisionSnapshotNumberLimit");
    const [ revisionIgnoreNamedSnapshots, setRevisionIgnoreNamedSnapshots ] = useTriliumOptionBool("revisionIgnoreNamedSnapshots");

    return (
        <Card heading={t("revisions_snapshot.title")}>
            <OptionCardSection

                name="revision-snapshot-time-interval"
                label={t("revisions_snapshot_interval.snapshot_time_interval_label")}
                description={t("revisions_snapshot_interval.note_revisions_snapshot_description_short")}
            >
                <TimeSelector
                    name="revision-snapshot-time-interval"
                    optionValueId="revisionSnapshotTimeInterval" optionTimeScaleId="revisionSnapshotTimeIntervalTimeScale"
                    minimumSeconds={10}
                />
            </OptionCardSection>

            <OptionCardSection

                name="revision-snapshot-number-limit"
                label={t("revisions_snapshot_limit.snapshot_number_limit_label")}
                description={t("revisions_snapshot_limit.note_revisions_snapshot_limit_description_short")}
            >
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
            </OptionCardSection>

            <OptionCardSection
                name="revision-keep-named-snapshots"
                label={t("revisions_snapshot_limit.keep_named_revisions_label")}
                description={t("revisions_snapshot_limit.keep_named_revisions_description")}
            >
                <FormToggle currentValue={revisionIgnoreNamedSnapshots} onChange={setRevisionIgnoreNamedSnapshots} />
            </OptionCardSection>

            <OptionCardSection
                label={t("revisions_snapshot_limit.erase_excess_revision_snapshots")}
                description={t("revisions_snapshot_limit.erase_excess_revision_snapshots_description")}
            >
                <Button
                    name="erase-excess-revisions-button"
                    text={t("revisions_snapshot_limit.erase_now_button")}
                    size="micro"
                    // A negative limit keeps every snapshot, so nothing is excess and the erasure
                    // would report success having dropped nothing. Offered again as soon as a
                    // limit is set.
                    disabled={parseInt(revisionSnapshotNumberLimit, 10) < 0}
                    onClick={async () => {
                        await server.post("revisions/erase-all-excess-revisions");
                        toast.showMessage(t("revisions_snapshot_limit.erase_excess_revision_snapshots_prompt"));
                    }}
                />
            </OptionCardSection>
        </Card>
    );
}

function HtmlImportTags() {
    const [ allowedHtmlTags, setAllowedHtmlTags ] = useTriliumOptionJson<readonly string[]>("allowedHtmlTags");
    const parsedValue = allowedHtmlTags.join(" ");

    return (
        <Card
            heading={t("import.html_import_tags.title")}
            description={t("import.html_import_tags.description")}
        >
            <CardSection className="other-html-tags">
                <textarea
                    className="allowed-html-tags"
                    spellcheck={false}
                    placeholder={t("import.html_import_tags.placeholder")}
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
                    name="reset-allowed-html-tags-button"
                    text={t("import.html_import_tags.reset_button")}
                    size="micro"
                    onClick={() => setAllowedHtmlTags(SANITIZER_DEFAULT_ALLOWED_TAGS)}
                />
            </CardSection>
        </Card>
    );
}

function ShareSettings() {
    const [ redirectBareDomain, setRedirectBareDomain ] = useTriliumOptionBool("redirectBareDomain");
    const [ showLogInShareTheme, setShowLogInShareTheme ] = useTriliumOptionBool("showLoginInShareTheme");

    return (
        <Card heading={t("share.title")}>
            <OptionCardSection
                name="redirect-bare-domain"
                label={t("share.redirect_bare_domain")}
                description={t("share.redirect_bare_domain_description")}
            >
                <FormToggle
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
            </OptionCardSection>

            <OptionCardSection
                name="show-login-in-share-theme"
                label={t("share.show_login_link")}
                description={t("share.show_login_link_description")}
            >
                <FormToggle currentValue={showLogInShareTheme} onChange={setShowLogInShareTheme} />
            </OptionCardSection>
        </Card>
    );
}

function NetworkSettings() {
    const [ checkForUpdates, setCheckForUpdates ] = useTriliumOptionBool("checkForUpdates");

    return (
        <Card heading={t("network_connections.network_connections_title")}>
            <OptionCardSection
                name="check-for-updates"
                label={t("network_connections.check_for_updates")}
                description={t("network_connections.check_for_updates_description")}
            >
                <FormToggle currentValue={checkForUpdates} onChange={setCheckForUpdates} />
            </OptionCardSection>
        </Card>
    );
}
