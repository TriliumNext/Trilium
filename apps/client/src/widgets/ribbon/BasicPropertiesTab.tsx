import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import Dropdown from "../react/Dropdown";
import { NOTE_TYPES } from "../../services/note_types";
import { FormDropdownDivider, FormListBadge, FormListItem } from "../react/FormList";
import { getAvailableLocales, t } from "../../services/i18n";
import { useNoteLabel, useNoteLabelBoolean, useNoteProperty, useTriliumEvent, useTriliumOption } from "../react/hooks";
import mime_types from "../../services/mime_types";
import { Locale, NoteType, ToggleInParentResponse } from "@triliumnext/commons";
import server from "../../services/server";
import dialog from "../../services/dialog";
import FormToggle from "../react/FormToggle";
import FNote from "../../entities/fnote";
import protected_session from "../../services/protected_session";
import FormDropdownList from "../react/FormDropdownList";
import toast from "../../services/toast";
import branches from "../../services/branches";
import sync from "../../services/sync";
import appContext from "../../components/app_context";
import HelpButton from "../react/HelpButton";
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
    const noteTypes = useMemo(() => NOTE_TYPES.filter((nt) => !nt.reserved && !nt.static), []);
    const [ codeNotesMimeTypes ] = useTriliumOption("codeNotesMimeTypes");
    const mimeTypes = useMemo(() => mime_types.getMimeTypes().filter(mimeType => mimeType.enabled), [ codeNotesMimeTypes ]);
    const notSelectableNoteTypes = useMemo(() => NOTE_TYPES.filter((nt) => nt.reserved || nt.static).map((nt) => nt.type), []);
    
    const currentNoteType = useNoteProperty(note, "type") ?? undefined;
    const currentNoteMime = useNoteProperty(note, "mime");

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
        <div className="note-type-container">
            <span>{t("basic_properties.note_type")}:</span> &nbsp;
            <Dropdown
                dropdownContainerClassName="note-type-dropdown"
                text={<span className="note-type-desc">{findTypeTitle(currentNoteType, currentNoteMime)}</span>}
                disabled={notSelectableNoteTypes.includes(currentNoteType ?? "text")}
            >
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
                    if (type !== "code") {
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
                        )
                    }
                })}

                {mimeTypes.map(({ title, mime }) => (
                    <FormListItem onClick={() => changeNoteType("code", mime)}>
                        {title}
                    </FormListItem>
                ))}
            </Dropdown>
        </div>
    )   
}

function ProtectedNoteSwitch({ note }: { note?: FNote | null }) {
    const isProtected = useNoteProperty(note, "isProtected");

    return (
        <div className="protected-note-switch-container">
            <FormToggle
                switchOnName={t("protect_note.toggle-on")} switchOnTooltip={t("protect_note.toggle-on-hint")}
                switchOffName={t("protect_note.toggle-off")} switchOffTooltip={t("protect_note.toggle-off-hint")}
                currentValue={isProtected}
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
    )
}

function BookmarkSwitch({ note }: { note?: FNote | null }) {
    const [ isBookmarked, setIsBookmarked ] = useState<boolean>(false);
    const refreshState = useCallback(() => {
        const isBookmarked = note && !!note.getParentBranches().find((b) => b.parentNoteId === "_lbBookmarks");
        setIsBookmarked(!!isBookmarked);
    }, [ note ]);

    useEffect(() => refreshState(), [ note ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (note && loadResults.getBranchRows().find((b) => b.noteId === note.noteId)) {
            refreshState();
        }
    });

    return (
        <div className="bookmark-switch-container">
            <FormToggle
                switchOnName={t("bookmark_switch.bookmark")} switchOnTooltip={t("bookmark_switch.bookmark_this_note")}
                switchOffName={t("bookmark_switch.bookmark")} switchOffTooltip={t("bookmark_switch.remove_bookmark")}
                currentValue={isBookmarked}                
                onChange={async (shouldBookmark) => {
                    if (!note) return;
                    const resp = await server.put<ToggleInParentResponse>(`notes/${note.noteId}/toggle-in-parent/_lbBookmarks/${shouldBookmark}`);

                    if (!resp.success && "message" in resp) {
                        toast.showError(resp.message);
                    }
                }}
                disabled={["root", "_hidden"].includes(note?.noteId ?? "")}
            />
        </div>
    )
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
    )
}

function SharedSwitch({ note }: { note?: FNote | null }) {
    const [ isShared, setIsShared ] = useState(false);
    const refreshState = useCallback(() => {
        setIsShared(!!note?.hasAncestor("_share"));
    }, [ note ]);

    useEffect(() => refreshState(), [ note ]);
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
    )
}

function NoteLanguageSwitch({ note }: { note?: FNote | null }) {
    const [ languages ] = useTriliumOption("languages");
    const DEFAULT_LOCALE = {
        id: "",
        name: t("note_language.not_set")
    };

    const [ currentNoteLanguage, setCurrentNoteLanguage ] = useNoteLabel(note, "language");

    const locales = useMemo(() => {
        const enabledLanguages = JSON.parse(languages ?? "[]") as string[];
        const filteredLanguages = getAvailableLocales().filter((l) => typeof l !== "object" || enabledLanguages.includes(l.id));
        const leftToRightLanguages = filteredLanguages.filter((l) => !l.rtl);
        const rightToLeftLanguages = filteredLanguages.filter((l) => l.rtl);

        let locales: ("---" | Locale)[] = [
            DEFAULT_LOCALE
        ];

        if (leftToRightLanguages.length > 0) {
            locales = [
                ...locales,
                "---",
                ...leftToRightLanguages
            ];
        }

        if (rightToLeftLanguages.length > 0) {
            locales = [
                ...locales,
                "---",
                ...rightToLeftLanguages
            ];
        }

        // This will separate the list of languages from the "Configure languages" button.
        // If there is at least one language.
        locales.push("---");
        return locales;
    }, [ languages ]);

    const currentLocale = useMemo(() => {
        return locales.find(locale => typeof locale === "object" && locale.id === currentNoteLanguage) as Locale | undefined;
    }, [ currentNoteLanguage ]);

    return (        
        <div className="note-language-container">
            <span>{t("basic_properties.language")}:</span>
            &nbsp;
            <Dropdown text={currentLocale?.name ?? DEFAULT_LOCALE.name}>
                {locales.map(locale => {
                    if (typeof locale === "object") {
                        const checked = locale.id === (currentNoteLanguage ?? "");
                        return <FormListItem
                            rtl={locale.rtl}
                            checked={checked}
                            onClick={() => setCurrentNoteLanguage(locale.id)}
                        >{locale.name}</FormListItem>
                    } else {
                        return <FormDropdownDivider />
                    }
                })}

                <FormListItem
                    onClick={(e) => {
                        e.stopPropagation();
                        appContext.tabManager.openContextWithNote("_optionsLocalization", { activate: true });
                    }}
                >{t("note_language.configure-languages")}</FormListItem>           
            </Dropdown>

            <HelpButton helpPage="B0lcI9xz1r8K" style={{ marginLeft: "4px" }} />
        </div>
    )
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