import anytypeProvider from "./anytype.js";
import evernoteProvider from "./evernote.js";
import filesProvider from "./files.js";
import keepProvider from "./keep.js";
import notionProvider from "./notion.js";
import obsidianProvider from "./obsidian.js";
import oneNoteProvider from "./onenote.js";
import oneNoteFileProvider from "./onenote_file.js";
import type { ImportProvider } from "./types.js";

/**
 * Registry of available import providers. Append new providers here; the import dialog renders the
 * picker (services in a grid, local file import grouped full-width beneath) and each provider's panel
 * automatically.
 */
export const importProviders: ImportProvider[] = [filesProvider, oneNoteProvider, oneNoteFileProvider, notionProvider, keepProvider, evernoteProvider, anytypeProvider, obsidianProvider];

export type { ImportProvider, ImportProviderPanelProps } from "./types.js";
