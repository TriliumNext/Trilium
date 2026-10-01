import "./NoteBadges.css";

import {
    isOfficeMimeType,
    nextSelfReificationTitle,
    parseReificationDefinition,
    REIFICATION_INSTANCE,
    REIFICATION_OF,
    REIFICATION_OF_PREDICATE,
    REIFICATION_PATTERN,
    SELF_REIFICATION_OF
} from "@triliumnext/commons";
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import { copyTextWithToast } from "../../services/clipboard_ext";
import { chooseNote, prompt } from "../../services/dialog";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { goToLinkExt } from "../../services/link";
import { openSelfReification } from "../../services/self_reification";
import server from "../../services/server";
import { Badge, BadgeWithDropdown } from "../react/Badge";
import Button from "../react/Button";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import Modal from "../react/Modal";
import { useGetContextDataFrom, useIsNoteReadOnly, useNoteContext, useNoteLabel, useNoteLabelBoolean, useNoteProperty } from "../react/hooks";
import { useShareState } from "../ribbon/BasicPropertiesTab";
import { type ShareScope, useShareInfo } from "../shared_info";
import { ActiveContentBadges } from "./ActiveContentBadges";
import { SnippetBadge } from "./SnippetBadge";

export default function NoteBadges() {
    return (
        <div className="note-badges">
            <SaveStatusBadge />
            <ReadOnlyBadge />
            <OfficePreviewBadge />
            <ShareBadge />
            <ClippedNoteBadge />
            <ExecuteBadge />
            <SnippetBadge />
            <ActiveContentBadges />
            <SelfReificationBadge />
            <PatternBadge />
            <PlaceBadge />
        </div>
    );
}

/** The next level up, shown once this note is already a statement, a relation name, or a level of one. */
function SelfReificationBadge() {
    const { note } = useNoteContext();
    const [ reificationOf ] = useNoteLabel(note, REIFICATION_OF);
    const [ predicate ] = useNoteLabel(note, REIFICATION_OF_PREDICATE);
    const [ selfOf ] = useNoteLabel(note, SELF_REIFICATION_OF);
    const title = useNoteProperty(note, "title") ?? "";
    if (!reificationOf && !predicate && !selfOf) {
        return;
    }

    const next = nextSelfReificationTitle(title);
    return (
        <Badge
            outline
            className="self-reification-badge"
            icon="bx bx-chevrons-up"
            text={next}
            tooltip={t("self_reification.hint", { title: next })}
            onClick={() => {
                if (note) {
                    void openSelfReification(note.noteId);
                }
            }}
        />
    );
}

interface ReificationPlace {
    name: string;
    noteId: string | null;
    title: string | null;
}

/** The formula of this concept, and the action that fills it with notes. */
function PatternBadge() {
    const { note } = useNoteContext();
    const [ predicate ] = useNoteLabel(note, REIFICATION_OF_PREDICATE);
    const [ pattern ] = useNoteLabel(note, REIFICATION_PATTERN);
    const [ mapping, setMapping ] = useState<string[] | null>(null);
    if (!predicate) {
        return;
    }
    const places = mapping;
    return (
        <>
            {!pattern
                ? <Badge
                    outline
                    className="pattern-badge"
                    icon="bx bx-sitemap"
                    text={t("reification_pattern.define", { name: predicate })}
                    tooltip={t("reification_pattern.hint")}
                    onClick={() => void editFormula(predicate, pattern)}
                />
                : <BadgeWithDropdown
                    outline
                    className="pattern-badge"
                    icon="bx bx-sitemap"
                    text={pattern}
                    tooltip={t("reification_pattern.hint")}
                >
                    <FormListItem icon="bx bx-plus" onClick={() => beginFill(pattern, setMapping)}>
                        {t("reification_pattern.fill", { name: predicate })}
                    </FormListItem>
                    <FormListItem icon="bx bx-edit" onClick={() => void editFormula(predicate, pattern)}>
                        {t("reification_pattern.edit")}
                    </FormListItem>
                </BadgeWithDropdown>}
            {places && <PlaceMappingDialog
                name={predicate}
                params={places}
                onDone={(notes) => {
                    setMapping(null);
                    if (notes) {
                        void createInstance(predicate, notes);
                    }
                }}
            />}
        </>
    );
}

/**
 * On a note a formula made, the places still left empty.
 * Opening the note reads the formula again, so a definition changed since then shows up here.
 */
function PlaceBadge() {
    const { note } = useNoteContext();
    const noteId = note?.noteId;
    const [ instance ] = useNoteLabel(note, REIFICATION_INSTANCE);
    const [ places, setPlaces ] = useState<ReificationPlace[] | null>(null);

    useEffect(() => {
        if (!noteId || !instance) {
            setPlaces(null);
            return;
        }
        let cancelled = false;
        void server.post<{ places: ReificationPlace[] }>(`notes/${noteId}/reification-places`)
            .then((result) => {
                if (!cancelled) {
                    setPlaces(result.places);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setPlaces(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [ noteId, instance ]);

    const unbound = places?.filter((place) => !place.noteId) ?? [];
    const only = unbound.length === 1 ? unbound[0] : undefined;
    if (!note || !instance || unbound.length === 0) {
        return;
    }

    const specify = (name: string) => {
        void specifyPlace(note.noteId, name).then((next) => {
            if (next) {
                setPlaces(next);
            }
        });
    };
    if (only) {
        return (
            <Badge
                outline
                className="places-badge"
                icon="bx bx-link"
                text={t("reification_pattern.specify", { name: only.name })}
                tooltip={t("reification_pattern.places_hint")}
                onClick={() => specify(only.name)}
            />
        );
    }
    return (
        <BadgeWithDropdown
            outline
            className="places-badge"
            icon="bx bx-link"
            text={t("reification_pattern.places")}
            tooltip={t("reification_pattern.places_hint")}
        >
            {unbound.map((place) => (
                <FormListItem
                    key={place.name}
                    icon="bx bx-link"
                    onClick={() => specify(place.name)}
                >
                    {t("reification_pattern.specify", { name: place.name })}
                </FormListItem>
            ))}
        </BadgeWithDropdown>
    );
}

function beginFill(pattern: string, setMapping: (params: string[] | null) => void) {
    const definition = parseReificationDefinition(pattern);
    if (!definition) {
        return;
    }
    setMapping(definition.params);
}

async function editFormula(predicate: string, current: string | null | undefined) {
    const value = await prompt({
        title: t("reification_pattern.edit_title"),
        message: t("reification_pattern.edit_message", { name: predicate }),
        defaultValue: current || `${predicate}(A, B) = R(A, B); B'`,
        multiline: true
    });
    if (!value) {
        return;
    }
    await server.put(`reification-concepts/${encodeURIComponent(predicate)}/pattern`, { pattern: value });
}

async function createInstance(predicate: string, notes: Record<string, string>) {
    const result = await server.post<{ noteId: string }>(
        `reification-concepts/${encodeURIComponent(predicate)}/instance`,
        { notes }
    );
    appContext.tabManager.openContextWithNote(result.noteId, { placement: "afterCurrent" });
}

async function specifyPlace(instanceId: string, name: string): Promise<ReificationPlace[] | null> {
    const chosen = await chooseNote({ title: t("reification_pattern.specify", { name }) });
    if (!chosen) {
        return null;
    }
    const result = await server.post<{ places: ReificationPlace[] }>(
        `notes/${instanceId}/reification-places/${encodeURIComponent(name)}`,
        { noteId: chosen }
    );
    return result.places;
}

/** Asks which note fills each place of a formula. An empty place is kept empty. */
function PlaceMappingDialog({ name, params, onDone }: {
    name: string;
    params: string[];
    onDone: (notes: Record<string, string> | null) => void;
}) {
    const [ shown, setShown ] = useState(true);
    const [ rows, setRows ] = useState<{ name: string; noteId: string | null; title: string | null }[]>(
        params.map((param) => ({ name: param, noteId: null, title: null }))
    );
    const result = useRef<Record<string, string> | null>(null);

    return (
        <Modal
            className="formula-places-dialog"
            title={t("reification_pattern.map_title", { name })}
            show={shown}
            stackable
            size="lg"
            onSubmit={() => {
                const notes: Record<string, string> = {};
                for (const row of rows) {
                    if (row.noteId) {
                        notes[row.name] = row.noteId;
                    }
                }
                result.current = notes;
                setShown(false);
            }}
            onHidden={() => onDone(result.current)}
            footer={<>
                <Button text={t("modal.cancel")} onClick={() => setShown(false)} />
                <Button text={t("prompt.ok")} kind="primary" />
            </>}
        >
            <p className="formula-places-hint">{t("reification_pattern.map_message")}</p>
            {rows.map((row) => (
                <div className="formula-place" key={row.name}>
                    <span className="formula-place-name">{row.name}</span>
                    <span className="formula-place-value">
                        {row.title ?? t("reification_pattern.unspecified")}
                    </span>
                    <Button
                        size="small"
                        text={t("note_picker.title")}
                        onClick={() => void pickPlace(row.name, rows, setRows)}
                    />
                </div>
            ))}
        </Modal>
    );
}

async function pickPlace(
    name: string,
    rows: { name: string; noteId: string | null; title: string | null }[],
    setRows: (rows: { name: string; noteId: string | null; title: string | null }[]) => void
) {
    const chosen = await chooseNote({ title: t("reification_pattern.specify", { name }) });
    if (!chosen) {
        return;
    }
    const note = await froca.getNote(chosen);
    const next: ReificationPlace[] = [];
    for (const row of rows) {
        next.push(row.name === name
            ? { name, noteId: chosen, title: note?.title ?? chosen }
            : row);
    }
    setRows(next);
}

function ReadOnlyBadge() {
    const { note, noteContext } = useNoteContext();
    const { isReadOnly, enableEditing, temporarilyEditable } = useIsNoteReadOnly(note, noteContext);
    const isExplicitReadOnly = note?.isLabelTruthy("readOnly");

    if (temporarilyEditable) {
        return <Badge
            icon="bx bx-lock-open-alt"
            text={t("breadcrumb_badges.read_only_temporarily_disabled")}
            tooltip={t("breadcrumb_badges.read_only_temporarily_disabled_description")}
            className="temporarily-editable-badge"
            onClick={() => enableEditing(false)}
        />;
    } else if (isReadOnly) {
        return <Badge
            icon="bx bx-lock-alt"
            text={isExplicitReadOnly ? t("breadcrumb_badges.read_only_explicit") : t("breadcrumb_badges.read_only_auto")}
            tooltip={isExplicitReadOnly ? t("breadcrumb_badges.read_only_explicit_description") : t("breadcrumb_badges.read_only_auto_description")}
            className="read-only-badge"
            onClick={() => enableEditing()}
        />;
    }
}

/**
 * Marks a file note that `OfficePreview` renders as HTML (DOCX/XLSX/PPTX, ODT/ODS/ODP, RTF and
 * EPUB). The preview is a rendering of the document, not an editor, so the badge tells the reader
 * why nothing can be typed into it. Unlike `ReadOnlyBadge` there is nothing to unlock.
 */
export function OfficePreviewBadge() {
    const { note, viewScope } = useNoteContext();
    const type = useNoteProperty(note, "type");
    const mime = useNoteProperty(note, "mime");

    const isPreviewShown = !viewScope?.viewMode || viewScope.viewMode === "default";
    if (type !== "file" || !isOfficeMimeType(mime) || !isPreviewShown) {
        return;
    }

    return (
        <Badge
            className="office-preview-badge"
            icon="bx bx-show"
            text={t("breadcrumb_badges.office_preview")}
            tooltip={t("breadcrumb_badges.office_preview_description")}
        />
    );
}

function ShareBadge() {
    const { note } = useNoteContext();
    const [ , switchShareState ] = useShareState(note);
    const { scope, linkHref } = useShareInfo(note);
    const badge = SHARE_BADGES[scope];

    return (linkHref &&
        <BadgeWithDropdown
            icon={badge.icon}
            text={t(badge.text)}
            tooltip={badge.tooltip && t(badge.tooltip, { format: t("export.format_share_name") })}
            className="share-badge"
        >
            {scope !== "export-only" && <>
                <FormListItem
                    icon="bx bx-copy"
                    onClick={() => copyTextWithToast(linkHref)}
                >{t("breadcrumb_badges.shared_copy_to_clipboard")}</FormListItem>
                <FormListItem
                    icon="bx bx-link-external"
                    onClick={(e) => goToLinkExt(e, linkHref)}
                >{t("breadcrumb_badges.shared_open_in_browser")}</FormListItem>
                <FormDropdownDivider />
            </>}
            <FormListItem
                icon="bx bx-unlink"
                onClick={() => switchShareState(false)}
            >{t("breadcrumb_badges.shared_unshare")}</FormListItem>
        </BadgeWithDropdown>
    );
}

const SHARE_BADGES: Record<ShareScope, { icon: string; text: string; tooltip?: string }> = {
    public: { icon: "bx bx-world", text: "breadcrumb_badges.shared_publicly" },
    local: { icon: "bx bx-share-alt", text: "breadcrumb_badges.shared_locally" },
    preview: {
        icon: "bx bx-show",
        text: "breadcrumb_badges.shared_preview",
        tooltip: "breadcrumb_badges.shared_preview_description"
    },
    "export-only": {
        icon: "bx bx-export",
        text: "breadcrumb_badges.shared_export_only",
        tooltip: "breadcrumb_badges.shared_export_only_description"
    }
};

function ClippedNoteBadge() {
    const { note } = useNoteContext();
    const isHelpNote = !!note?.noteId.startsWith("_help");
    const [ url ] = useNoteLabel(note, isHelpNote ? "docUrl" : "pageUrl");

    if (!url) return;

    if (isHelpNote) {
        return (
            <Badge
                className="doc-url-badge"
                icon="bx bx-file-find"
                text={t("breadcrumb_badges.doc_url")}
                tooltip={t("breadcrumb_badges.doc_url_description")}
                href={url}
            />
        );
    }

    return (
        <Badge
            className="clipped-note-badge"
            icon="bx bx-globe"
            text={t("breadcrumb_badges.clipped_note")}
            tooltip={t("breadcrumb_badges.clipped_note_description", { url })}
            href={url}
        />
    );
}

function ExecuteBadge() {
    const { note, parentComponent } = useNoteContext();
    const isScript = note?.isTriliumScript();
    const isSql = note?.isTriliumSqlite();
    const isExecutable = isScript || isSql;
    const [ executeDescription ] = useNoteLabel(note, "executeDescription");
    const [ executeButton ] = useNoteLabelBoolean(note, "executeButton");

    return (note && isExecutable && (executeDescription || executeButton) &&
        <Badge
            className="execute-badge"
            icon="bx bx-play"
            text={isScript ? t("breadcrumb_badges.execute_script") : t("breadcrumb_badges.execute_sql")}
            tooltip={executeDescription || (isScript ? t("breadcrumb_badges.execute_script_description") : t("breadcrumb_badges.execute_sql_description"))}
            onClick={() => parentComponent.triggerCommand("runActiveNote")}
        />
    );
}

const SAVE_STATE_DEBOUNCE_MS = 200;

export function SaveStatusBadge() {
    const { noteContext} = useNoteContext();
    const saveState = useGetContextDataFrom(noteContext, "saveState");
    const [debouncedState, setDebouncedState] = useState(saveState);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedState(saveState), SAVE_STATE_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [saveState]);

    if (!debouncedState) return;

    const stateConfig = {
        saved: {
            icon: "bx bx-check",
            title: t("breadcrumb_badges.save_status_saved"),
            tooltip: undefined
        },
        saving: {
            icon: "bx bx-loader bx-spin",
            title: t("breadcrumb_badges.save_status_saving"),
            tooltip: t("breadcrumb_badges.save_status_saving_tooltip")
        },
        unsaved: {
            icon: "bx bx-pencil",
            title: t("breadcrumb_badges.save_status_unsaved"),
            tooltip: t("breadcrumb_badges.save_status_unsaved_tooltip")
        },
        error: {
            icon: "bx bxs-error",
            title: t("breadcrumb_badges.save_status_error"),
            tooltip: t("breadcrumb_badges.save_status_error_tooltip")
        }
    };

    const { icon, title, tooltip } = stateConfig[debouncedState.state];

    return (
        <Badge
            className={clsx("save-status-badge", debouncedState.state)}
            icon={icon}
            text={title}
            tooltip={tooltip}
        />
    );
}
