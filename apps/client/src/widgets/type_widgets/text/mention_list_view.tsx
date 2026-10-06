import type { EmojiSuggestion, MentionFeedObjectItem, MentionHostedList, MentionHostedListState, SlashCommandConfig, SlashCommandDefinition, SlashCommandItem, TriliumEmojiMention, TriliumSlashCommands } from "@triliumnext/ckeditor5";
import clsx from "clsx";
import type { ComponentChildren } from "preact";

import { AutocompleteList } from "../../react/FormAutocomplete";
import { type CommandEntry, CommandMentionList, createHostedList, NoteMentionList } from "../../react/NoteAutocomplete";

/** The editor a list for a plugin's marker is created for. */
type HostEditor = Parameters<NonNullable<SlashCommandConfig["list"]>>[0];

/**
 * Lists the notes for the query typed after `@` as the note autocomplete does, for the editor config's
 * `mention.hostedFeeds`, and mentions the note picked as a reference link.
 */
export function createNoteMentionList({ allowCreatingNotes, preselect, getParentNotePath }: {
    allowCreatingNotes?: boolean;
    preselect?: boolean;
    /**
     * The note the editor is open on, which a child note is created under. A getter, as switching
     * notes reuses the editor.
     */
    getParentNotePath?(): string | null | undefined;
} = {}): MentionHostedList {
    return createHostedList<MentionHostedListState>((state, list) => (
        <NoteMentionList
            {...list}
            query={state.query}
            allowCreatingNotes={allowCreatingNotes}
            parentNotePath={getParentNotePath?.()}
            preselect={preselect}
            onPick={(notePath) => state.commit(typeof notePath === "string"
                ? toMention(notePath)
                : notePath.then((path) => path ? toMention(path) : undefined))}
        />
    ));
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
