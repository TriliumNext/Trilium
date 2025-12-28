import { MimeType, NoteType, ToggleInParentResponse } from "@triliumnext/commons";
import { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { Dispatch, StateUpdater, useCallback, useEffect, useMemo, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import branches from "../../services/branches";
import dialog from "../../services/dialog";
import { getAvailableLocales, t } from "../../services/i18n";
import mime_types from "../../services/mime_types";
import { NOTE_TYPES } from "../../services/note_types";
import protected_session from "../../services/protected_session";
import server from "../../services/server";
import sync from "../../services/sync";
import toast from "../../services/toast";
import Dropdown from "../react/Dropdown";
import FormDropdownList from "../react/FormDropdownList";
import { FormDropdownDivider, FormListBadge, FormListItem } from "../react/FormList";
import FormToggle from "../react/FormToggle";
import HelpButton from "../react/HelpButton";
import { useNoteLabel, useNoteLabelBoolean, useNoteProperty, useTriliumEvent, useTriliumOption } from "../react/hooks";
import Modal from "../react/Modal";
import { CodeMimeTypesList } from "../type_widgets/options/code_notes";
import { LocaleSelector } from "../type_widgets/options/components/LocaleSelector";
import { ContentLanguagesList } from "../type_widgets/options/i18n";
import { TabContext } from "./ribbon-interface";

export default function BasicPropertiesTab({ note }: TabContext) {
    return (
        <div className="basic-properties-widget">
            <NoteTypeWidget note={note} />
            <ProtectedNoteSwitch note={note} />
            <EditabilitySelect note={note} />
            <BookmarkSwitch note={note} />
            <SharedSwitch note={note} />
            <TemplateSwitch note={note} />
            <NoteLanguageSwitch note={note} />
        </div>
    );
}

function NoteTypeWidget({ note }: { note?: FNote | null }) {
    const notSelectableNoteTypes = useMemo(() => NOTE_TYPES.filter((nt) => nt.reserved || nt.static).map((nt) => nt.type), []);

    const currentNoteType = useNoteProperty(note, "type") ?? undefined;
    const currentNoteMime = useNoteProperty(note, "mime");
    const [ modalShown, setModalShown ] = useState(false);

    return (
        <div className="note-type-container">
            <span>{t("basic_properties.note_type")}:</span> &nbsp;
            <Dropdown
                dropdownContainerClassName="note-type-dropdown"
                text={<span className="note-type-desc">{findTypeTitle(currentNoteType, currentNoteMime)}</span>}
                disabled={notSelectableNoteTypes.includes(currentNoteType ?? "text")}
            >
                <NoteTypeDropdownContent currentNoteType={currentNoteType} currentNoteMime={currentNoteMime} note={note} setModalShown={setModalShown} />
            </Dropdown>

            {createPortal(
                <NoteTypeOptionsModal modalShown={modalShown} setModalShown={setModalShown} />,
                document.body
            )}
        </div>
    );
}

export function NoteTypeDropdownContent({ currentNoteType, currentNoteMime, note, setModalShown, noCodeNotes }: {
    currentNoteType?: NoteType;
    currentNoteMime?: string | null;
    note?: FNote | null;
    setModalShown: Dispatch<StateUpdater<boolean>>;
    noCodeNotes?: boolean;
}) {
    const mimeTypes = useMimeTypes();
    const noteTypes = useMemo(() => NOTE_TYPES.filter((nt) => !nt.reserved && !nt.static), []);
    const changeNoteType = useCallback(async (type: NoteType, mime?: string) => {
        if (!note || (type === currentNoteType && mime === currentNoteMime)) {
            return;
        }

        // Confirm change if the note already has a content.
        if (type !== currentNoteType) {
            const blob = await note.getBlob();

            if (blob?.content && blob.content.trim().length &&
                !await (dialog.confirm(t("note_types.confirm-change")))) {
                return;
            }
        }

        await server.put(`notes/${note.noteId}/type`, { type, mime });
    }, [ note, currentNoteType, currentNoteMime ]);

    return (
        <>
            {noteTypes.map(({ isNew, isBeta, type, mime, title }) => {
                const badges: FormListBadge[] = [];
                if (isNew) {
                    badges.push({
                        className: "new-note-type-badge",
                        text: t("note_types.new-feature")
                    });
                }
                if (isBeta) {
                    badges.push({
                        text: t("note_types.beta-feature")
                    });
                }

                const checked = (type === currentNoteType);
                if (noCodeNotes || type !== "code") {
                    return (
                        <FormListItem
                            checked={checked}
                            badges={badges}
                            onClick={() => changeNoteType(type, mime)}
                        >{title}</FormListItem>
                    );
                } else {
                    return (
                        <>
                            <FormDropdownDivider />
                            <FormListItem
                                checked={checked}
                                disabled
                            >
                                <strong>{title}</strong>
                            </FormListItem>
                        </>
                    );
                }
            })}

            {!noCodeNotes && <NoteTypeCodeNoteList mimeTypes={mimeTypes} changeNoteType={changeNoteType} setModalShown={setModalShown} />}
        </>
    );
}

export function NoteTypeCodeNoteList({ currentMimeType, mimeTypes, changeNoteType, setModalShown }: {
    currentMimeType?: string;
    mimeTypes: MimeType[];
    changeNoteType(type: NoteType, mime: string): void;
    setModalShown(shown: boolean): void;
}) {
    return (
        <>
            {mimeTypes.map(({ title, mime }) => (
                <FormListItem
                    key={mime}
                    checked={mime === currentMimeType}
                    onClick={() => changeNoteType("code", mime)}
                >
                    {title}
                </FormListItem>
            ))}

            <FormDropdownDivider />
            <FormListItem icon="bx bx-cog" onClick={() => setModalShown(true)}>{t("basic_properties.configure_code_notes")}</FormListItem>
        </>
    );
}

export function useMimeTypes() {
    const [ codeNotesMimeTypes ] = useTriliumOption("codeNotesMimeTypes");
    const mimeTypes = useMemo(() => {
        mime_types.loadMimeTypes();
        return mime_types.getMimeTypes().filter(mimeType => mimeType.enabled);
    }, [ codeNotesMimeTypes ]); // eslint-disable-line react-hooks/exhaustive-deps
    return mimeTypes;
}

export function NoteTypeOptionsModal({ modalShown, setModalShown }: { modalShown: boolean, setModalShown: (shown: boolean) => void }) {
    return (
        <Modal
            className="code-mime-types-modal"
            title={t("code_mime_types.title")}
            show={modalShown} onHidden={() => setModalShown(false)}
            size="xl" scrollable
        >
            <CodeMimeTypesList />
        </Modal>
    );
}

function ProtectedNoteSwitch({ note }: { note?: FNote | null }) {
    const isProtected = useNoteProperty(note, "isProtected");

    return (
        <div className="protected-note-switch-container">
            <FormToggle
                switchOnName={t("protect_note.toggle-on")} switchOnTooltip={t("protect_note.toggle-on-hint")}
                switchOffName={t("protect_note.toggle-off")} switchOffTooltip={t("protect_note.toggle-off-hint")}
                currentValue={!!isProtected}
                onChange={(shouldProtect) => note && protected_session.protectNote(note.noteId, shouldProtect, false)}
            />
        </div>
    )
}

function EditabilitySelect({ note }: { note?: FNote | null }) {
    const [ readOnly, setReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const [ autoReadOnlyDisabled, setAutoReadOnlyDisabled ] = useNoteLabelBoolean(note, "autoReadOnlyDisabled");

    const options = useMemo(() => ([
        {
            value: "auto",
            label: t("editability_select.auto"),
            description: t("editability_select.note_is_editable"),
        },
        {
            value: "readOnly",
            label: t("editability_select.read_only"),
            description: t("editability_select.note_is_read_only")
        },
        {
            value: "autoReadOnlyDisabled",
            label: t("editability_select.always_editable"),
            description: t("editability_select.note_is_always_editable")
        }
    ]), []);

    return (
        <div class="editability-select-container">
            <span>{t("basic_properties.editable")}:</span> &nbsp;

            <FormDropdownList
                dropdownContainerClassName="editability-dropdown"
                values={options}
                currentValue={ readOnly ? "readOnly" : autoReadOnlyDisabled ? "autoReadOnlyDisabled" : "auto" }
                keyProperty="value" titleProperty="label" descriptionProperty="description"
                onChange={(editability: string) => {
                    setReadOnly(editability === "readOnly");
                    setAutoReadOnlyDisabled(editability === "autoReadOnlyDisabled");
                }}
            />
        </div>
    );
}

function BookmarkSwitch({ note }: { note?: FNote | null }) {
    const [ isBookmarked, setIsBookmarked ] = useNoteBookmarkState(note);

    return (
        <div className="bookmark-switch-container">
            <FormToggle
                switchOnName={t("bookmark_switch.bookmark")} switchOnTooltip={t("bookmark_switch.bookmark_this_note")}
                switchOffName={t("bookmark_switch.bookmark")} switchOffTooltip={t("bookmark_switch.remove_bookmark")}
                currentValue={isBookmarked}
                onChange={setIsBookmarked}
                disabled={["root", "_hidden"].includes(note?.noteId ?? "")}
            />
        </div>
    );
}

export function useNoteBookmarkState(note: FNote | null | undefined) {
    const [ isBookmarked, setIsBookmarked ] = useState<boolean>(false);
    const refreshState = useCallback(() => {
        const isBookmarked = note && !!note.getParentBranches().find((b) => b.parentNoteId === "_lbBookmarks");
        setIsBookmarked(!!isBookmarked);
    }, [ note ]);

    const changeHandler = useCallback(async (shouldBookmark: boolean) => {
        if (!note) return;
        const resp = await server.put<ToggleInParentResponse>(`notes/${note.noteId}/toggle-in-parent/_lbBookmarks/${shouldBookmark}`);

        if (!resp.success && "message" in resp) {
            toast.showError(resp.message);
        }
    }, [ note ]);

    useEffect(() => refreshState(), [ refreshState ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (note && loadResults.getBranchRows().find((b) => b.noteId === note.noteId)) {
            refreshState();
        }
    });
    return [ isBookmarked, changeHandler ] as const;
}

function TemplateSwitch({ note }: { note?: FNote | null }) {
    const [ isTemplate, setIsTemplate ] = useNoteLabelBoolean(note, "template");

    return (
        <div className="template-switch-container">
            <FormToggle
                switchOnName={t("template_switch.template")} switchOnTooltip={t("template_switch.toggle-on-hint")}
                switchOffName={t("template_switch.template")} switchOffTooltip={t("template_switch.toggle-off-hint")}
                helpPage="KC1HB96bqqHX"
                disabled={note?.noteId.startsWith("_options")}
                currentValue={isTemplate} onChange={setIsTemplate}
            />
        </div>
    );
}

function SharedSwitch({ note }: { note?: FNote | null }) {
    const [ isShared, switchShareState ] = useShareState(note);

    return (
        <div className="shared-switch-container">
            <FormToggle
                currentValue={isShared}
                onChange={switchShareState}
                switchOnName={t("shared_switch.shared")} switchOnTooltip={t("shared_switch.toggle-on-title")}
                switchOffName={t("shared_switch.shared")} switchOffTooltip={t("shared_switch.toggle-off-title")}
                helpPage="R9pX4DGra2Vt"
                disabled={["root", "_share", "_hidden"].includes(note?.noteId ?? "") || note?.noteId.startsWith("_options")}
            />
        </div>
    );
}

export function useShareState(note: FNote | null | undefined) {
    const [ isShared, setIsShared ] = useState(false);
    const refreshState = useCallback(() => {
        setIsShared(!!note?.hasAncestor("_share"));
    }, [ note ]);

    useEffect(() => refreshState(), [ refreshState ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (note && loadResults.getBranchRows().find((b) => b.noteId === note.noteId)) {
            refreshState();
        }
    });

    const switchShareState = useCallback(async (shouldShare: boolean) => {
        if (!note) return;

        if (shouldShare) {
            await branches.cloneNoteToParentNote(note.noteId, "_share");
        } else {
            if (note?.getParentBranches().length === 1 && !(await dialog.confirm(t("shared_switch.shared-branch")))) {
                return;
            }

            const shareBranch = note?.getParentBranches().find((b) => b.parentNoteId === "_share");
            if (!shareBranch?.branchId) return;
            await server.remove(`branches/${shareBranch.branchId}?taskId=no-progress-reporting`);
        }

        sync.syncNow(true);
    }, [ note ]);

    return [ isShared, switchShareState ] as const;
}

function NoteLanguageSwitch({ note }: { note?: FNote | null }) {
    return (
        <div className="note-language-container">
            <span>{t("basic_properties.language")}:</span>
            &nbsp;

            <NoteLanguageSelector note={note} />
            <HelpButton helpPage="veGu4faJErEM" style={{ marginInlineStart: "4px" }} />
        </div>
    );
}

export function NoteLanguageSelector({ note }: { note: FNote | null | undefined }) {
    const [ modalShown, setModalShown ] = useState(false);
    const { locales, DEFAULT_LOCALE, currentNoteLanguage, setCurrentNoteLanguage } = useLanguageSwitcher(note);

    return (
        <>
            <LocaleSelector
                locales={locales}
                defaultLocale={DEFAULT_LOCALE}
                currentValue={currentNoteLanguage} onChange={setCurrentNoteLanguage}
                extraChildren={<>
                    <FormListItem
                        onClick={() => setModalShown(true)}
                        icon="bx bx-cog"
                    >{t("note_language.configure-languages")}</FormListItem>
                </>}
            />
            {createPortal(
                <ContentLanguagesModal modalShown={modalShown} setModalShown={setModalShown} />,
                document.body
            )}
        </>
    );
}

export function useLanguageSwitcher(note: FNote | null | undefined) {
    const [ languages ] = useTriliumOption("languages");
    const DEFAULT_LOCALE = {
        id: "",
        name: t("note_language.not_set")
    };
    const [ currentNoteLanguage, setCurrentNoteLanguage ] = useNoteLabel(note, "language");
    const locales = useMemo(() => {
        const enabledLanguages = JSON.parse(languages ?? "[]") as string[];
        const filteredLanguages = getAvailableLocales().filter((l) => typeof l !== "object" || enabledLanguages.includes(l.id));
        return filteredLanguages;
    }, [ languages ]);
    return { locales, DEFAULT_LOCALE, currentNoteLanguage, setCurrentNoteLanguage };
}

export function ContentLanguagesModal({ modalShown, setModalShown }: { modalShown: boolean, setModalShown: (shown: boolean) => void }) {
    return (
        <Modal
            className="content-languages-modal"
            title={t("content_language.title")}
            show={modalShown} onHidden={() => setModalShown(false)}
            size="lg" scrollable
        >
            <ContentLanguagesList />
        </Modal>
    );
}

function findTypeTitle(type?: NoteType, mime?: string | null) {
    if (type === "code") {
        const mimeTypes = mime_types.getMimeTypes();
        const found = mimeTypes.find((mt) => mt.mime === mime);

        return found ? found.title : mime;
    } else {
        const noteType = NOTE_TYPES.find((nt) => nt.type === type);

        return noteType ? noteType.title : type;
    }
}
