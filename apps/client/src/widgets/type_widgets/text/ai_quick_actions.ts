import type { AiQuickAction, AiQuickActionFooter, AiQuickActionGroup } from "@triliumnext/ckeditor5";
import { useEffect, useMemo, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote.js";
import debounce from "../../../services/debounce.js";
import froca from "../../../services/froca.js";
import { t } from "../../../services/i18n.js";
import type LoadResults from "../../../services/load_results.js";
import search from "../../../services/search.js";
import { useTriliumEvent, useTriliumOption } from "../../react/hooks.jsx";
import { buildAiAssistantQuickActions } from "./ai_assistant_stream.js";
import { buildAiModelPicker } from "./ai_model_picker.js";

/**
 * Everything the AI assistant's menu offers: the built-in groups, followed by the instructions the
 * user wrote themselves.
 *
 * The built-ins are ready synchronously; the custom ones are notes and have to be searched for and
 * read. So the assistant starts on the built-ins alone and is handed the full list once it arrives
 * — the menu redraws itself (`AiAssistantUI.updateQuickActions`), which is the same reason the
 * editor need not be rebuilt when a custom action is written or edited.
 */
export function useAiQuickActions(): AiQuickActionGroup[] {
    const [ quickActions, setQuickActions ] = useState<AiQuickActionGroup[]>(buildAiAssistantQuickActions);
    // The built-in Translate group lists these, so a change to them rebuilds the whole list.
    const [ contentLanguages ] = useTriliumOption("languages");

    useEffect(() => {
        void buildQuickActions().then(setQuickActions);
    }, [ contentLanguages ]);

    useTriliumEvent("entitiesReloaded", async ({ loadResults }) => {
        await refreshQuickActions(loadResults, setQuickActions);
    });

    return quickActions;
}

/**
 * The rows closing the assistant's menu. Rebuilt when the model is picked or the providers change,
 * so the row restates which model is in force and moves the tick to it.
 */
export function useAiMenuFooter(): AiQuickActionFooter[] {
    const [ chosenModel ] = useTriliumOption("aiAssistantModel");
    const [ providers ] = useTriliumOption("llmProviders");

    return useMemo(buildAiModelPicker, [ chosenModel, providers ]);
}

/** The label marking a note as an instruction to offer in the assistant's menu. */
const LABEL = "aiQuickAction";
/** The built-in template a user makes one of these notes from. */
const TEMPLATE_NOTE_ID = "_template_ai_quick_action";
const GROUP_ID = "custom";

/** The note ids the last build drew on, so a change elsewhere can be ignored. */
let actionNoteIds = new Set<string>();
const debouncedRefreshIfAffected = debounce(refreshIfAffected, 1000);

export async function buildQuickActions(): Promise<AiQuickActionGroup[]> {
    const groups = buildAiAssistantQuickActions();
    const actions = await getCustomQuickActions();

    if (actions.length) {
        groups.push({
            id: GROUP_ID,
            label: t("ai_assistant.group_custom"),
            iconClass: "bx bx-user",
            // A submenu, like the groups it follows: the user's own actions are named by them and
            // there is no telling how many there will be, which is exactly the case the top level
            // of the menu cannot absorb.
            submenu: true,
            actions
        });
    }

    return groups;
}

/**
 * The user's own instructions: one per `#aiQuickAction` note, titled by the note and worded by its
 * content — the shape a text snippet has, for the same reason. A note is a better home for a prompt
 * than a setting is: it can be written in the editor, revised, synced and organized like anything
 * else.
 */
async function getCustomQuickActions(): Promise<AiQuickAction[]> {
    try {
        // Type is filtered here rather than in the query: a query starting with "(" trips the
        // search lexer (see `snippets.ts`, which works around the same thing).
        const notes = (await search.searchForNotes(`#${LABEL}`))
            .filter((note) => (note.type === "text" || note.type === "code")
                && !note.isArchived && note.isContentAvailable());

        const actions: AiQuickAction[] = [];
        actionNoteIds = new Set(notes.map((note) => note.noteId));

        for (const note of notes) {
            const prompt = await readPrompt(note);
            // An empty note is one the user has not written yet, and an action with no instruction
            // would send the selection to the model with nothing to do to it.
            if (prompt) {
                actions.push({
                    id: `${GROUP_ID}:${note.noteId}`,
                    label: note.title,
                    prompt,
                    iconClass: note.getIcon()
                });
            }
        }

        return actions;
    } catch (e) {
        logError("Error while building the custom AI quick actions: ", e);
        return [];
    }
}

/**
 * What the note tells the model. A code note is already plain text; a text note's content is HTML,
 * and the instruction is what the user wrote rather than the markup they wrote it in — sending the
 * markup spends tokens on it and invites the model to answer in kind.
 */
async function readPrompt(note: FNote): Promise<string> {
    const content = await note.getContent();
    if (!content) {
        return "";
    }
    if (note.type !== "text") {
        return content.trim();
    }

    // The block boundaries carry a line break `textContent` would drop, gluing paragraphs together
    // ("<p>a</p><p>b</p>" → "ab"). A prompt written as steps or a list depends on them.
    const withBreaks = content.replace(
        /<(?:br\b|\/(?:p|div|li|h[1-6]|blockquote|figcaption|pre|td|th|tr)\b)[^>]*>/gi,
        "\n"
    );
    return (new DOMParser().parseFromString(withBreaks, "text/html").body.textContent ?? "")
        .replace(/[^\S\n]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * Rebuilds the list when something that feeds it changed: a note gaining or losing the label, one
 * being made from the template, or the content or title of a note already in the list.
 *
 * Unlike a snippet, whose text reaches the editor through a getter, an action's prompt is baked
 * into the definition — so a content edit means a rebuild, debounced so that typing a prompt does
 * not rebuild once per keystroke.
 */
export async function refreshQuickActions(
    loadResults: LoadResults,
    setQuickActions: (value: AiQuickActionGroup[]) => void
) {
    const marksAnAction = loadResults.getAttributeRows().some((attr) => (attr.type === "label"
        ? attr.name === LABEL
        : attr.value === TEMPLATE_NOTE_ID));

    if (marksAnAction) {
        setQuickActions(await buildQuickActions());
        return;
    }

    const affectedNoteIds = loadResults.getNoteIds();
    if (affectedNoteIds.length) {
        debouncedRefreshIfAffected(affectedNoteIds, setQuickActions);
    }
}

async function refreshIfAffected(
    affectedNoteIds: string[],
    setQuickActions: (value: AiQuickActionGroup[]) => void
) {
    if (!affectedNoteIds.some((noteId) => actionNoteIds.has(noteId))) {
        return;
    }

    await froca.getNotes(affectedNoteIds, true);
    setQuickActions(await buildQuickActions());
}
