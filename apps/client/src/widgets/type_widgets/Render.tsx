import "./Render.css";

import { useEffect, useRef, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import { t } from "../../services/i18n";
import note_create from "../../services/note_create";
import render from "../../services/render";
import toast from "../../services/toast";
import { getErrorMessage } from "../../services/utils";
import Admonition from "../react/Admonition";
import Button, { SplitButton } from "../react/Button";
import FormGroup from "../react/FormGroup";
import { FormListItem } from "../react/FormList";
import { useNoteRelation, useTriliumEvent } from "../react/hooks";
import NoteAutocomplete from "../react/NoteAutocomplete";
import { refToJQuerySelector } from "../react/react_utils";
import SetupForm from "./helpers/SetupForm";
import { TypeWidgetProps } from "./type_widget";

const HELP_PAGE = "HcABDtFCkbFN";

const PREACT_SAMPLE = /*js*/`\
export default function() {
    return <p>Hello world.</p>;
}
`;

const HTML_SAMPLE = /*html*/`\
<p>Hello world.</p>
`;

export default function Render(props: TypeWidgetProps) {
    const { note } = props;
    const [ renderNote ] = useNoteRelation(note, "renderNote");
    const [ disabledRenderNote ] = useNoteRelation(note, "disabled:renderNote");

    if (disabledRenderNote) {
        return <DisabledRender {...props} />;
    }

    if (!renderNote) {
        return <SetupRenderContent {...props} />;
    }

    return <RenderContent {...props} />;
}

function RenderContent({ note, noteContext, ntxId }: TypeWidgetProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [ error, setError ] = useState<unknown | null>(null);

    function refresh() {
        if (!contentRef) return;
        setError(null);
        render.render(note, refToJQuerySelector(contentRef), setError);
    }

    useEffect(refresh, [ note ]);

    // Keyboard shortcut.
    useTriliumEvent("renderActiveNote", () => {
        if (!noteContext?.isActive()) return;
        refresh();
    });

    // Refresh on floating buttons.
    useTriliumEvent("refreshData", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        refresh();
    });

    // Refresh on attribute change.
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().some(a => a.type === "relation" && a.name === "renderNote" && attributes.isAffecting(a, note))) {
            refresh();
        }
    });

    // Integration with search.
    useTriliumEvent("executeWithContentElement", ({ resolve, ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        resolve(refToJQuerySelector(contentRef));
    });

    return (
        <>
            {error && (
                <Admonition type="caution">
                    {getErrorMessage(error)}
                </Admonition>
            )}
            <div ref={contentRef} className="note-detail-render-content" />
        </>
    );
}

function DisabledRender({ note }: TypeWidgetProps) {
    return (
        <SetupForm
            icon="bx bx-extension"
            inAppHelpPage={HELP_PAGE}
        >
            <p>{t("render.disabled_description")}</p>
            <Button
                text={t("render.disabled_button_enable")}
                icon="bx bx-check-shield"
                onClick={() => attributes.toggleDangerousAttribute(note, "relation", "renderNote", true)}
                kind="primary"
            />
        </SetupForm>
    );
}

function SetupRenderContent({ note }: TypeWidgetProps) {
    return (
        <SetupForm
            icon="bx bx-extension"
            inAppHelpPage={HELP_PAGE}
        >
            <FormGroup name="render-target-note" label={t("render.setup_title")}>
                <NoteAutocomplete noteIdChanged={noteId => {
                    if (!noteId) return;
                    setRenderNote(note, noteId);
                }} />
            </FormGroup>

            <SplitButton
                text={t("render.setup_create_sample_preact")}
                icon="bx bxl-react"
                onClick={() => setupSampleNote(note, "text/jsx", PREACT_SAMPLE)}
            >
                <FormListItem
                    icon="bx bxl-html5"
                    onClick={() => setupSampleNote(note, "text/html", HTML_SAMPLE)}
                >{t("render.setup_create_sample_html")}</FormListItem>
            </SplitButton>
        </SetupForm>
    );
}

async function setRenderNote(note: FNote, targetNoteUrl: string) {
    await attributes.setRelation(note.noteId, "renderNote", targetNoteUrl);
}

async function setupSampleNote(parentNote: FNote, mime: string, content: string) {
    const { note: codeNote } = await note_create.createNote(parentNote.noteId, {
        type: "code",
        mime,
        content,
        activate: false
    });
    if (!codeNote) return;
    await setRenderNote(parentNote, codeNote.noteId);
    toast.showMessage(t("render.setup_sample_created"));
}
