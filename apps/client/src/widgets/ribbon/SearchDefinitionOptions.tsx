import { AttributeType } from "@triliumnext/commons";
import { ComponentChildren, VNode } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";

import appContext from "../../components/app_context";
import FNote from "../../entities/fnote";
import { removeOwnedAttributesByNameOrType } from "../../services/attributes";
import { t } from "../../services/i18n";
import server from "../../services/server";
import FormSelect from "../react/FormSelect";
import FormTextArea from "../react/FormTextArea";
import FormTextBox from "../react/FormTextBox";
import HelpRemoveButtons from "../react/HelpRemoveButtons";
import { useNoteLabel, useNoteRelation, useSpacedUpdate, useTooltip } from "../react/hooks";
import Icon from "../react/Icon";
import NoteAutocomplete from "../react/NoteAutocomplete";

export interface SearchOption {
    attributeName: string;
    attributeType: "label" | "relation";
    icon: string;
    label: string;
    tooltip?: string;
    component: (props: SearchOptionProps) => VNode;
    defaultValue?: string;
    additionalAttributesToDelete?: { type: "label" | "relation", name: string }[];
}

interface SearchOptionProps {
    note: FNote;
    refreshResults: () => void;
    attributeName: string;
    attributeType: "label" | "relation";
    additionalAttributesToDelete?: { type: "label" | "relation", name: string }[];
    defaultValue?: string;
    error?: { message: string };
}

export const SEARCH_OPTIONS: SearchOption[] = [
    {
        attributeName: "searchString",
        attributeType: "label",
        icon: "bx bx-text",
        label: t("search_definition.search_string"),
        component: SearchStringOption
    },
    {
        attributeName: "searchScript",
        attributeType: "relation",
        defaultValue: "root",
        icon: "bx bx-code",
        label: t("search_definition.search_script"),
        component: SearchScriptOption
    },
    {
        attributeName: "ancestor",
        attributeType: "relation",
        defaultValue: "root",
        icon: "bx bx-filter-alt",
        label: t("search_definition.ancestor"),
        component: AncestorOption,
        additionalAttributesToDelete: [ { type: "label", name: "ancestorDepth" } ]
    },
    {
        attributeName: "fastSearch",
        attributeType: "label",
        icon: "bx bx-run",
        label: t("search_definition.fast_search"),
        tooltip: t("search_definition.fast_search_description"),
        component: FastSearchOption
    },
    {
        attributeName: "includeArchivedNotes",
        attributeType: "label",
        icon: "bx bx-archive",
        label: t("search_definition.include_archived"),
        tooltip: t("search_definition.include_archived_notes_description"),
        component: IncludeArchivedNotesOption
    },
    {
        attributeName: "orderBy",
        attributeType: "label",
        defaultValue: "relevancy",
        icon: "bx bx-arrow-from-top",
        label: t("search_definition.order_by"),
        component: OrderByOption,
        additionalAttributesToDelete: [ { type: "label", name: "orderDirection" } ]
    },
    {
        attributeName: "limit",
        attributeType: "label",
        defaultValue: "10",
        icon: "bx bx-stop",
        label: t("search_definition.limit"),
        tooltip: t("search_definition.limit_description"),
        component: LimitOption
    },
    {
        attributeName: "debug",
        attributeType: "label",
        icon: "bx bx-bug",
        label: t("search_definition.debug"),
        tooltip: t("search_definition.debug_description"),
        component: DebugOption
    }
];

function SearchOption({ note, title, titleIcon, children, help, attributeName, attributeType, additionalAttributesToDelete }: {
    note: FNote;
    title: string,
    titleIcon?: string,
    children?: ComponentChildren,
    help?: ComponentChildren,
    attributeName: string,
    attributeType: AttributeType,
    additionalAttributesToDelete?: { type: "label" | "relation", name: string }[]
}) {
    return (
        <tr className={attributeName}>
            <td className="title-column">
                {titleIcon && <><Icon icon={titleIcon} />{" "}</>}
                {title}
            </td>
            <td>{children}</td>
            <HelpRemoveButtons
                help={help}
                removeText={t("abstract_search_option.remove_this_search_option")}
                onRemove={() => {
                    removeOwnedAttributesByNameOrType(note, attributeType, attributeName);
                    if (additionalAttributesToDelete) {
                        for (const { type, name } of additionalAttributesToDelete) {
                            removeOwnedAttributesByNameOrType(note, type, name);
                        }
                    }
                }}
            />
        </tr>
    );
}

function SearchStringOption({ note, refreshResults, error, ...restProps }: SearchOptionProps) {
    const [ searchString, setSearchString ] = useNoteLabel(note, "searchString");
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const currentValue = useRef(searchString ?? "");
    const spacedUpdate = useSpacedUpdate(async () => {
        const searchString = currentValue.current;
        appContext.lastSearchString = searchString;
        setSearchString(searchString);

        if (note.title.startsWith(t("search_string.search_prefix"))) {
            await server.put(`notes/${note.noteId}/title`, {
                title: `${t("search_string.search_prefix")} ${searchString.length < 30 ? searchString : `${searchString.substr(0, 30)}…`}`
            });
        }
    }, 1000);

    // React to errors
    const { showTooltip, hideTooltip } = useTooltip(inputRef, {
        trigger: "manual",
        title: `${t("search_string.error", { error: error?.message })}`,
        html: true,
        placement: "bottom"
    });

    // Auto-focus.
    useEffect(() => inputRef.current?.focus(), []);

    useEffect(() => {
        if (error) {
            showTooltip();
            setTimeout(() => hideTooltip(), 4000);
        } else {
            hideTooltip();
        }
    }, [ error ]);

    return <SearchOption
        title={t("search_string.title_column")}
        help={<>
            <strong>{t("search_string.search_syntax")}</strong> - {t("search_string.also_see")} <a href="#" data-help-page="search.html">{t("search_string.complete_help")}</a>
            <ul style="marigin-bottom: 0;">
                <li>{t("search_string.full_text_search")}</li>
                <li><code>#abc</code> - {t("search_string.label_abc")}</li>
                <li><code>#year = 2019</code> - {t("search_string.label_year")}</li>
                <li><code>#rock #pop</code> - {t("search_string.label_rock_pop")}</li>
                <li><code>#rock or #pop</code> - {t("search_string.label_rock_or_pop")}</li>
                <li><code>#year &lt;= 2000</code> - {t("search_string.label_year_comparison")}</li>
                <li><code>note.dateCreated &gt;= MONTH-1</code> - {t("search_string.label_date_created")}</li>
            </ul>
        </>}
        note={note} {...restProps}
    >
        <FormTextArea
            inputRef={inputRef}
            className="search-string"
            placeholder={t("search_string.placeholder")}
            currentValue={searchString ?? ""}
            onChange={text => {
                currentValue.current = text;
                spacedUpdate.scheduleUpdate();
            }}
            onKeyDown={async (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();

                    // this also in effect disallows new lines in query string.
                    // on one hand, this makes sense since search string is a label
                    // on the other hand, it could be nice for structuring long search string. It's probably a niche case though.
                    await spacedUpdate.updateNowIfNecessary();
                    refreshResults();
                }
            }}
        />
    </SearchOption>;
}

function SearchScriptOption({ note, ...restProps }: SearchOptionProps) {
    const [ searchScript, setSearchScript ] = useNoteRelation(note, "searchScript");

    return <SearchOption
        title={t("search_script.title")}
        help={<>
            <p>{t("search_script.description1")}</p>
            <p>{t("search_script.description2")}</p>
            <p>{t("search_script.example_title")}</p>
            <pre>{t("search_script.example_code")}</pre>
            {t("search_script.note")}
        </>}
        note={note} {...restProps}
    >
        <NoteAutocomplete
            noteId={searchScript !== "root" ? searchScript ?? undefined : undefined}
            noteIdChanged={noteId => setSearchScript(noteId ?? "root")}
            placeholder={t("search_script.placeholder")}
        />
    </SearchOption>;
}

function AncestorOption({ note, ...restProps}: SearchOptionProps) {
    const [ ancestor, setAncestor ] = useNoteRelation(note, "ancestor");
    const [ depth, setDepth ] = useNoteLabel(note, "ancestorDepth");

    const options = useMemo(() => {
        const options: { value: string | undefined; label: string }[] = [
            { value: "", label: t("ancestor.depth_doesnt_matter") },
            { value: "eq1", label: `${t("ancestor.depth_eq", { count: 1 })} (${t("ancestor.direct_children")})` }
        ];

        for (let i=2; i<=9; i++) options.push({ value: `eq${  i}`, label: t("ancestor.depth_eq", { count: i }) });
        for (let i=0; i<=9; i++) options.push({ value: `gt${  i}`, label: t("ancestor.depth_gt", { count: i }) });
        for (let i=2; i<=9; i++) options.push({ value: `lt${  i}`, label: t("ancestor.depth_lt", { count: i }) });

        return options;
    }, []);

    return <SearchOption
        title={t("ancestor.label")}
        note={note} {...restProps}
    >
        <div style={{display: "flex", alignItems: "center"}}>
            <NoteAutocomplete
                noteId={ancestor !== "root" ? ancestor ?? undefined : undefined}
                noteIdChanged={noteId => setAncestor(noteId ?? "root")}
                placeholder={t("ancestor.placeholder")}
            />

            <div style="margin-inline-start: 10px; margin-inline-end: 10px">{t("ancestor.depth_label")}:</div>
            <FormSelect
                values={options}
                keyProperty="value" titleProperty="label"
                currentValue={depth ?? ""} onChange={(value) => setDepth(value ? value : null)}
                style={{ flexShrink: 3 }}
            />
        </div>
    </SearchOption>;
}

function FastSearchOption({ ...restProps }: SearchOptionProps) {
    return <SearchOption
        titleIcon="bx bx-run" title={t("fast_search.fast_search")}
        help={t("fast_search.description")}
        {...restProps}
    />;
}

function DebugOption({ ...restProps }: SearchOptionProps) {
    return <SearchOption
        titleIcon="bx bx-bug" title={t("debug.debug")}
        help={<>
            <p>{t("debug.debug_info")}</p>
            {t("debug.access_info")}
        </>}
        {...restProps}
    />;
}

function IncludeArchivedNotesOption({ ...restProps }: SearchOptionProps) {
    return <SearchOption
        titleIcon="bx bx-archive" title={t("include_archived_notes.include_archived_notes")}
        {...restProps}
    />;
}

function OrderByOption({ note, ...restProps }: SearchOptionProps) {
    const [ orderBy, setOrderBy ] = useNoteLabel(note, "orderBy");
    const [ orderDirection, setOrderDirection ] = useNoteLabel(note, "orderDirection");

    return <SearchOption
        titleIcon="bx bx-arrow-from-top"
        title={t("order_by.order_by")}
        note={note} {...restProps}
    >
        <FormSelect
            className="w-auto d-inline"
            currentValue={orderBy ?? "relevancy"} onChange={setOrderBy}
            keyProperty="value" titleProperty="title"
            values={[
                { value: "relevancy", title: t("order_by.relevancy") },
                { value: "title", title: t("order_by.title") },
                { value: "dateCreated", title: t("order_by.date_created") },
                { value: "dateModified", title: t("order_by.date_modified") },
                { value: "contentSize", title: t("order_by.content_size") },
                { value: "contentAndAttachmentsSize", title: t("order_by.content_and_attachments_size") },
                { value: "contentAndAttachmentsAndRevisionsSize", title: t("order_by.content_and_attachments_and_revisions_size") },
                { value: "revisionCount", title: t("order_by.revision_count") },
                { value: "childrenCount", title: t("order_by.children_count") },
                { value: "parentCount", title: t("order_by.parent_count") },
                { value: "ownedLabelCount", title: t("order_by.owned_label_count") },
                { value: "ownedRelationCount", title: t("order_by.owned_relation_count") },
                { value: "targetRelationCount", title: t("order_by.target_relation_count") },
                { value: "random", title: t("order_by.random") }
            ]}
        />
        {" "}
        <FormSelect
            className="w-auto d-inline"
            currentValue={orderDirection ?? "asc"} onChange={setOrderDirection}
            keyProperty="value" titleProperty="title"
            values={[
                { value: "asc", title: t("order_by.asc") },
                { value: "desc", title: t("order_by.desc") }
            ]}
        />
    </SearchOption>;
}

function LimitOption({ note, defaultValue, ...restProps }: SearchOptionProps) {
    const [ limit, setLimit ] = useNoteLabel(note, "limit");

    return <SearchOption
        titleIcon="bx bx-stop"
        title={t("limit.limit")}
        help={t("limit.take_first_x_results")}
        note={note} {...restProps}
    >
        <FormTextBox
            type="number" min="1" step="1"
            currentValue={limit ?? defaultValue} onChange={setLimit}
        />
    </SearchOption>;
}
