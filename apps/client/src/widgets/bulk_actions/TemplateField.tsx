import "../search_field_editor.css";
import "./TemplateField.css";

import { hostedCompletion, type HostedCompletionState } from "@triliumnext/codemirror/src/extensions/hosted_completion";
import { triliumTemplate } from "@triliumnext/codemirror/src/extensions/trilium_template";
import { createFieldEditor, type FieldEditor } from "@triliumnext/codemirror/src/field_editor";
import { dayjs, evaluateTemplate, type TemplateVariables, type TemplateVariableTypes } from "@triliumnext/commons";
import clsx from "clsx";
import { createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import type { NoteMetaData } from "../../entities/fnote";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { CommandMentionList, createHostedList, filterCommandEntries } from "../react/NoteAutocomplete";
import { SEARCH_FIELD_EDITOR_CLASS } from "../search_field_editor";
import { type TemplateCompletion, templateCompletionAt, type TemplateEntry } from "./template_completions";

/** The note a template is previewed against, such as the first of the notes a bulk action runs on. */
export const TemplatePreviewNoteContext = createContext<string | undefined>(undefined);

interface TemplateFieldProps {
    currentValue: string;
    onChange(value: string): void;
    /** Called when focus leaves the field, for a caller that saves the value then. */
    onBlur?(): void;
    /**
     * The result shown below the field, for a caller that fills the template in itself. Without it,
     * the template is filled in for the note in {@link TemplatePreviewNoteContext}.
     */
    preview?: string;
    /** The variables the template can read, as the server passes them to `evaluateTemplate()`. */
    variables: TemplateVariableTypes;
    placeholder?: string;
    ariaLabel?: string;
}

/**
 * A one-line field for a template filled in by `evaluateTemplate()`: the `${...}` expressions are
 * coloured, completed and checked by the same rules the server applies, and the result for the note
 * in {@link TemplatePreviewNoteContext} is shown below the field.
 */
export default function TemplateField({ currentValue, onChange, onBlur, preview: givenPreview, variables, placeholder, ariaLabel }: TemplateFieldProps) {
    const parentRef = useRef<HTMLDivElement>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const notePreview = useTemplatePreview(currentValue, useContext(TemplatePreviewNoteContext));
    const preview = givenPreview ?? notePreview;

    useEffect(() => {
        if (!parentRef.current) return;

        const editor: FieldEditor = createFieldEditor({
            parent: parentRef.current,
            doc: currentValue,
            placeholder,
            ariaLabel,
            singleLine: true,
            onChange: (value) => onChangeRef.current(value),
            extensions: [
                triliumTemplate(variables, templateLintMessages()),
                hostedCompletion({
                    match: (before) => templateCompletionAt(before, variables),
                    list: createTemplateCompletionList
                })
            ]
        });

        return () => editor.destroy();
        // Builds the editor once; the field owns its document from then on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="template-field" onBlur={onBlur}>
            <div ref={parentRef} className={clsx(SEARCH_FIELD_EDITOR_CLASS, "form-control tn-input-field")} />
            {preview && <div className="template-field-preview">{t("template_field.preview", { result: preview })}</div>}
        </div>
    );
}

function templateLintMessages() {
    return {
        unclosed: t("template_field.error_unclosed"),
        unsupported: t("template_field.error_unsupported"),
        unknownVariable: (name: string) => t("template_field.error_unknown_variable", { name }),
        propertyNotAllowed: (name: string) => t("template_field.error_property_not_allowed", { name }),
        methodNotAllowed: (name: string) => t("template_field.error_method_not_allowed", { name }),
        methodNotOnValue: (name: string) => t("template_field.error_method_not_on_value", { name })
    };
}

function createTemplateCompletionList() {
    return createHostedList<HostedCompletionState<TemplateCompletion>>((state, props) => {
        const { match } = state;
        return (
            <CommandMentionList<TemplateEntry>
                key={`${match.key}:${match.from}`}
                {...props}
                query={match.query}
                source={async (query) => filterCommandEntries(match.entries(), query)}
                onPick={(entry) => state.commit(entry.insert)}
            />
        );
    });
}

/**
 * The template filled in for the note `noteId`, or `undefined` while there is none, the template
 * has no expression to show the effect of, or the template is refused (the field underlines why).
 */
function useTemplatePreview(template: string, noteId: string | undefined) {
    const [ variables, setVariables ] = useState<TemplateVariables>();

    useEffect(() => {
        let cancelled = false;
        setVariables(undefined);
        if (!noteId) return;

        // A preview that cannot be built is left out; the field works the same without it.
        (async () => {
            const note = await froca.getNote(noteId, true);
            if (!note) return;
            const metadata = await note.getMetadata();
            if (!cancelled) setVariables(noteTemplateVariables(note, metadata));
        })().catch(() => {});

        return () => {
            cancelled = true;
        };
    }, [ noteId ]);

    if (!variables || !template.includes("${")) return undefined;
    try {
        return evaluateTemplate(template, variables);
    } catch {
        return undefined;
    }
}

/**
 * The `note` variable the server passes to `evaluateTemplate()` for a bulk rename, rebuilt from the
 * client's copy of the note: every property and method the template engine allows, with the dates
 * of `BNote`.
 */
export function noteTemplateVariables(note: FNote, metadata: NoteMetaData): TemplateVariables {
    return {
        note: {
            title: note.title,
            noteId: note.noteId,
            type: note.type,
            mime: note.mime,
            isProtected: note.isProtected,
            dateCreated: metadata.dateCreated,
            dateModified: metadata.dateModified,
            utcDateCreated: metadata.utcDateCreated,
            utcDateModified: metadata.utcDateModified,
            dateCreatedObj: dayjs(metadata.dateCreated),
            utcDateCreatedObj: dayjs.utc(metadata.utcDateCreated),
            getLabelValue: (name: string) => note.getLabelValue(name),
            getLabel: (name: string) => note.getLabel(name),
            getLabelValues: (name: string) => note.getLabels(name).map((label) => label.value),
            getRelationValue: (name: string) => note.getRelationValue(name),
            getAttributeValue: (type: "label" | "relation", name: string) => note.getAttributeValue(type, name)
        }
    };
}
