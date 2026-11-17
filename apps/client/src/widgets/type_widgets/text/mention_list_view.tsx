import type { EmojiSuggestion, MentionFeedObjectItem, MentionHostedList, MentionHostedListState, SlashCommandConfig, SlashCommandDefinition, SlashCommandItem, TriliumEmojiMention, TriliumSlashCommands } from "@triliumnext/ckeditor5";
import clsx from "clsx";
import type { ComponentChildren } from "preact";

import contextMenu from "../../../menus/context_menu";
import { buildInsertMenuItems, keepEditorFocused } from "../../../menus/text_editor_context_menu";
import type { LinkTarget } from "../../../services/link_targets";
import options from "../../../services/options";
import { AutocompleteList } from "../../react/FormAutocomplete";
import LinkMentionList from "../../react/LinkMentionList";
import {
    type CommandEntry, CommandMentionList, createHostedList, NoteMentionList,
    type NoteMentionListProps
} from "../../react/NoteAutocomplete";
import { type ChildNoteParent, createChildNote, openChildNote } from "./child_note";

/** The editor a list for a plugin's marker is created for. */
type HostEditor = Parameters<NonNullable<SlashCommandConfig["list"]>>[0];

/**
 * Lists the notes for the query typed after `@` as the note autocomplete does, for the editor config's
 * `mention.hostedFeeds`, and mentions the note picked as a reference link.
 */
export function createNoteMentionList({
    allowCreatingNotes, preselect, getParentNotePath, getChildNoteParent, getOwnLinkTargets
}: NoteMentionListOptions = {}): MentionHostedList {
    return createHostedList<MentionHostedListState>((state, list) => {
        const childNoteParent = getChildNoteParent?.();
        const props: NoteMentionListProps = {
            ...list,
            query: state.query,
            allowCreatingNotes,
            parentNotePath: getParentNotePath?.(),
            preselect,
            onPick: (notePath) => state.commit(typeof notePath === "string"
                ? toMention(notePath)
                : notePath.then(toMentionIfCreated)),
            onPickChildNote: childNoteParent && ((title) => {
                const mention = createChildNote(childNoteParent, title)
                    .then(toMentionIfCreated);
                state.commit(mention);
                // Runs after the commit inserts the link, which focuses the editor.
                void mention.then((created) => created && openChildNote(
                    created.notePath, childNoteParent.ntxId, { selectTitle: false }
                ));
            })
        };

        if (!getOwnLinkTargets || !options.is("textNoteCompletionLinkTargetsEnabled")) {
            return <NoteMentionList {...props} />;
        }

        return (
            <LinkMentionList
                {...props}
                linkedNotePath={getMentionedNotePath(state.followUpOf)}
                onLinkNote={(notePath) => state.commitAndFollowUp(toMention(notePath))}
                onKeepLink={state.dismiss}
                getOwnTargets={getOwnLinkTargets}
            />
        );
    });
}

interface NoteMentionListOptions {
    allowCreatingNotes?: boolean;
    preselect?: boolean;
    /**
     * The note the editor is open on, which a child note is created under. A getter, as switching
     * notes reuses the editor.
     */
    getParentNotePath?(): string | null | undefined;
    /**
     * The note the editor is open on, in place of `getParentNotePath`: the child note row then
     * creates the note without asking for its type, and opens it in Quick edit once linked.
     */
    getChildNoteParent?(): ChildNoteParent | undefined;
    /**
     * When given, and while `textNoteCompletionLinkTargetsEnabled` is on, a note picked from the
     * list is linked at once and the list follows up on the link with a second page, which lists
     * the targets of the note, such as its headings and anchors, for the text typed after the
     * link. A pick there points the link at the target. It returns the targets of the note at
     * `notePath` from the editor, when the editor is open on that note. The server reads those of
     * any other note.
     */
    getOwnLinkTargets?(notePath: string): LinkTarget[] | undefined;
}

/**
 * Lists what `source` has for the query typed after a marker as a form field's autocomplete lists
 * it, for the editor config's `mention.hostedFeeds`, and mentions the entry picked as `toMention`
 * makes it.
 */
export function createAutocompleteMentionList({ source, renderItem, toMention }: {
    source(query: string): Promise<string[]>;
    renderItem?(item: string, query: string): ComponentChildren;
    toMention(item: string): MentionFeedObjectItem;
}): MentionHostedList {
    return createHostedList<MentionHostedListState>((state, list) => (
        <AutocompleteList
            {...list}
            query={state.query}
            source={source}
            renderItem={renderItem}
            onPick={(item) => state.commit(toMention(item))}
        />
    ));
}

/**
 * Lists the `/` palette's entries for the query as the command palette lists its commands, for the
 * editor config's `slashCommand.list`, opening on the best match so that Enter runs it.
 */
export function createSlashCommandList(editor: HostEditor): MentionHostedList {
    const palette = editor.plugins.get("TriliumSlashCommands") as TriliumSlashCommands;
    const source = async (query: string) => palette.search(query).map(toCommandEntry);

    return createHostedList<MentionHostedListState>((state, list) => (
        <CommandMentionList<SlashCommandEntry>
            {...list}
            query={state.query}
            source={source}
            className="slash-command-menu"
            onPick={({ definition }) => state.commit(toSlashCommandItem(definition))}
        />
    ));
}

/**
 * Opens the `/` palette's entries that insert or wrap content as a menu below `handle`, with a
 * filter at its top, for the editor config's `blockDragHandle.openInsertMenu`, and calls `onClose`
 * once the menu is closed.
 */
export function openSlashCommandMenu(editor: HostEditor, handle: HTMLElement, onClose: () => void) {
    // A click on the handle of the open menu only closes the menu.
    if (contextMenu.dismissedByLastPress) {
        onClose();
        return;
    }

    const palette = editor.plugins.get("TriliumSlashCommands") as TriliumSlashCommands;
    const editorFocus = keepEditorFocused(editor);
    void contextMenu.show({
        anchor: handle,
        items: buildInsertMenuItems(palette.search(""), (definition) => palette.run(definition)),
        filterable: true,
        focusFilter: true,
        className: "slash-command-menu",
        selectMenuItemHandler: () => {},
        onShow: editorFocus.onShow,
        onHide: () => {
            editorFocus.onHide?.();
            onClose();
        }
    });
}

/**
 * Lists the emoji for the query typed after `:` as the command palette lists its commands, the emoji
 * in place of the icon, for the editor config's `emoji.list`.
 */
export function createEmojiList(editor: HostEditor): MentionHostedList {
    const emoji = editor.plugins.get("TriliumEmojiMention") as TriliumEmojiMention;
    const source = async (query: string) => emoji.search(query).map(toEmojiEntry);

    return createHostedList<MentionHostedListState>((state, list) => (
        <CommandMentionList<EmojiEntry>
            {...list}
            query={state.query}
            source={source}
            onPick={({ suggestion }) => state.commit(suggestion)}
        />
    ));
}

type SlashCommandEntry = CommandEntry & { definition: SlashCommandDefinition };

/** What the palette commits for an entry, which `TriliumSlashCommands` then runs. */
function toSlashCommandItem(definition: SlashCommandDefinition): SlashCommandItem {
    return { id: definition.id, definition };
}

/** A palette entry as a command row: a snippet's font icon in its colour, or the entry's SVG. */
function toCommandEntry(definition: SlashCommandDefinition): SlashCommandEntry {
    return {
        id: definition.id,
        title: definition.title,
        description: definition.description,
        icon: definition.iconClass ? clsx(definition.iconClass, definition.iconColorClass) : undefined,
        iconSvg: definition.iconClass ? undefined : definition.icon,
        definition
    };
}

type EmojiEntry = CommandEntry & { suggestion: EmojiSuggestion };

/**
 * An emoji as a command row, the emoji its icon, or the entry that opens the picker, set apart from
 * the emoji above it with the icon of the editor's emoji button.
 */
function toEmojiEntry(suggestion: EmojiSuggestion): EmojiEntry {
    return {
        id: suggestion.id,
        title: suggestion.title,
        iconSvg: suggestion.icon,
        iconText: suggestion.opensPicker ? undefined : suggestion.text,
        startsGroup: suggestion.opensPicker,
        suggestion
    };
}

/** The mention `MentionCustomization` turns into a reference link to `notePath`. */
function toMention(notePath: string) {
    return { id: `@${notePath}`, notePath };
}

function toMentionIfCreated(notePath: string | undefined) {
    return notePath ? toMention(notePath) : undefined;
}

/** The path of the note that `toMention()` made `mention` for, or `undefined` for other items. */
function getMentionedNotePath(mention: MentionFeedObjectItem | null) {
    return mention && "notePath" in mention && typeof mention.notePath === "string"
        ? mention.notePath
        : undefined;
}
