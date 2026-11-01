import "./template_properties.css";

import { dayjs, evaluateTemplate } from "@triliumnext/commons";
import { useEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import ws from "../../services/ws";
import TemplateField, { noteTemplateVariables } from "../bulk_actions/TemplateField";
import { CollectionPropertiesDialog } from "../note_bars/CollectionProperties";
import { Card, OptionCardSection } from "../react/Card";
import { useTriliumEvent } from "../react/hooks";
import NoteAutocomplete from "../react/NoteAutocomplete";

/** What the server's `getNewNoteTitle()` passes to `evaluateTemplate()` for a title template. */
const TITLE_TEMPLATE_VARIABLES = { now: "date", parentNote: "note" } as const;

/**
 * Edits what a template note sets on the notes created from it (their title and where they go), as
 * a column of cards like a collection's properties. Each setting is saved as it is changed.
 */
export default function TemplatePropertiesDialog() {
    const [ note, setNote ] = useState<FNote>();
    const [ shown, setShown ] = useState(false);
    const [ titleTemplate, setTitleTemplate ] = useState("");
    const [ defaultParentId, setDefaultParentId ] = useState<string>();
    const titleWrites = useRef(new Map<string, TitleWrites>());
    const preview = useTitlePreview(titleTemplate, note);

    useTriliumEvent("showTemplateProperties", async ({ noteId }) => {
        const templateNote = await froca.getNote(noteId);
        if (!templateNote) return;
        // froca can lag behind writes still queued, so the template's own state is kept until they end.
        let writes = titleWrites.current.get(noteId);
        if (!writes?.pending) {
            const ownTitleTemplate = templateNote.getOwnedLabelValue("template:titleTemplate") ?? "";
            writes = { saved: ownTitleTemplate, latest: ownTitleTemplate, pending: 0, queue: Promise.resolve() };
            titleWrites.current.set(noteId, writes);
        }
        setTitleTemplate(writes.latest);
        setDefaultParentId(templateNote.getOwnedRelationValue("template:newNoteDefaultParent") ?? undefined);
        setNote(templateNote);
        setShown(true);
    });

    /**
     * Queues writing the title template. A template's writes run one after another, each waiting for
     * froca to hold the one before it, so the last value wins and removing finds the label just created.
     */
    function saveTitleTemplate() {
        const writes = note && titleWrites.current.get(note.noteId);
        if (!note || !writes) return;
        const templateNote = note;
        const value = titleTemplate;
        writes.latest = value;
        writes.pending++;
        writes.queue = writes.queue.catch(() => {}).then(async () => {
            if (value === writes.saved) return;
            if (value) {
                await attributes.setLabel(templateNote.noteId, "template:titleTemplate", value);
            } else {
                await attributes.removeOwnedLabelByName(templateNote, "template:titleTemplate");
            }
            writes.saved = value;
            await ws.waitForMaxKnownEntityChangeId();
        }).finally(() => {
            writes.pending--;
        });
    }

    async function saveDefaultParent(noteId: string | undefined) {
        if (!note) return;
        setDefaultParentId(noteId);
        if (noteId) {
            await attributes.setAttribute(note, "relation", "template:newNoteDefaultParent", noteId);
        } else {
            await attributes.removeOwnedRelationByName(note, "template:newNoteDefaultParent");
        }
    }

    return (
        <CollectionPropertiesDialog
            className="template-properties-dialog"
            title={t("template_properties.title")}
            show={shown}
            onHidden={() => {
                saveTitleTemplate();
                setShown(false);
            }}
        >
            {shown && note && (
                <Card heading={t("template_properties.new_notes")}>
                    <OptionCardSection
                        label={t("template_properties.title_template")}
                        description={t("template_properties.title_template_description")}
                    >
                        <TemplateField
                            key={note.noteId}
                            variables={TITLE_TEMPLATE_VARIABLES}
                            placeholder={t("template_properties.title_template_placeholder")}
                            ariaLabel={t("template_properties.title_template")}
                            preview={preview}
                            currentValue={titleTemplate}
                            onChange={setTitleTemplate}
                            onBlur={saveTitleTemplate}
                        />
                    </OptionCardSection>
                    <OptionCardSection
                        label={t("template_properties.default_parent")}
                        description={t("template_properties.default_parent_description")}
                    >
                        <NoteAutocomplete
                            noteId={defaultParentId}
                            placeholder={t("template_properties.default_parent_placeholder")}
                            noteIdChanged={(noteId) => void saveDefaultParent(noteId || undefined)}
                        />
                    </OptionCardSection>
                </Card>
            )}
        </CollectionPropertiesDialog>
    );
}

/** A template's title template as the dialog writes it, which froca can lag behind. */
interface TitleWrites {
    /** As last written. */
    saved: string;
    /** As last queued, which the field shows while writes are pending. */
    latest: string;
    pending: number;
    queue: Promise<void>;
}

/**
 * The title a note created from `templateNote` would get from `template` now, or `undefined`
 * while it cannot be told. The template's own parent stands in for `parentNote`, since a template
 * has no parent of its own for the notes created from it.
 */
function useTitlePreview(template: string, templateNote: FNote | undefined) {
    const [ parentNote, setParentNote ] = useState<unknown>();

    useEffect(() => {
        let cancelled = false;
        setParentNote(undefined);
        const parent = templateNote?.getParentNotes()[0];
        if (!parent) return;

        // A preview that cannot be built is left out; the field works the same without it.
        parent.getMetadata()
            .then((metadata) => {
                if (!cancelled) setParentNote(noteTemplateVariables(parent, metadata).note);
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };
    }, [ templateNote ]);

    if (!template || !parentNote) return undefined;
    try {
        return evaluateTemplate(template, { now: dayjs(), parentNote });
    } catch {
        return undefined;
    }
}
