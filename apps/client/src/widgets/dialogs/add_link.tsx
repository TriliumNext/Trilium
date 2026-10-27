import "./add_link.css";

import { ALLOWED_PROTOCOLS } from "@triliumnext/commons";
import { useEffect, useRef, useState } from "preact/hooks";

import froca from "../../services/froca";
import { t } from "../../services/i18n";
import type { Suggestion } from "../../services/note_autocomplete";
import tree from "../../services/tree";
import { isMobile } from "../../services/utils";
import { logError } from "../../services/ws";
import Button from "../react/Button";
import { Card, CardSection, OptionCardSection } from "../react/Card";
import FormSelect from "../react/FormSelect";
import FormTextBox from "../react/FormTextBox";
import FormToggle from "../react/FormToggle";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import NoteAutocomplete, { type NoteAutocompleteHandle } from "../react/NoteAutocomplete";
import { refToJQuerySelector } from "../react/react_utils";
import SegmentedChoice from "../react/SegmentedChoice";

type LinkType = "reference-link" | "external-link" | "hyper-link";

/** What the link points at: a note, or an address outside Trilium. */
type LinkTarget = "note" | "url";

function findAnchorIds(content: string): string[] {
    const re = /<a\b([^>]*)>(<\/a>)?/g;
    const ids: string[] = [];
    let match;

    while ((match = re.exec(content))) {
        const attrs = match[1];
        if (/\bhref\s*=/.test(attrs)) continue;

        const idMatch = /\bid\s*=\s*"([^"]+)"/.exec(attrs) ?? /\bid\s*=\s*'([^']+)'/.exec(attrs);
        if (!idMatch) continue;

        const id = idMatch[1];
        if (!ids.includes(id)) ids.push(id);
    }

    return ids;
}

export interface AddLinkOpts {
    text: string;
    hasSelection: boolean;
    /**
     * Pick what the link points at and nothing else.
     *
     * For a caller that carries no text of its own to dress — a mind map node reads as its own
     * topic — there is no title to write and no reference-or-hyperlink to choose between, and the
     * anchor within a note is left out too: what it appends is a link only a rich text can follow.
     * `linkTitle` is handed over all the same, so a caller minding it need not be told twice.
     */
    targetOnly?: boolean;
    /**
     * The link the dialog opens on, in the shape a pick comes back in.
     *
     * A caller changing a link that is already there says what it points at, and the field opens
     * filled with it: changing a link is then the same gesture as making one, and a dialog left as
     * it was applies what was already pointed at rather than refusing for want of a pick. The
     * dialog says it is editing rather than adding, too.
     */
    currentLink?: Suggestion;
    /**
     * The text of the link being edited. The dialog opens with the title not mirroring the note's,
     * and keeps this text until another note or anchor is picked.
     */
    currentTitle?: string;
    /** The anchor within the note that the link being edited points at. */
    currentBookmark?: string;
    /**
     * Repoints a reference link to a missing note. The dialog is titled "Fix link", searches for
     * `text`, and offers only notes, always as a reference link.
     */
    fixLink?: boolean;
    addLink(notePath: string, linkTitle: string | null, externalLink?: boolean): Promise<void>;
}

export default function AddLinkDialog() {
    const [ opts, setOpts ] = useState<AddLinkOpts>();
    const [ linkTitle, setLinkTitle ] = useState("");
    const [ linkType, setLinkType ] = useState<LinkType>();
    const [ suggestion, setSuggestion ] = useState<Suggestion | null>(null);
    const [ bookmarks, setBookmarks ] = useState<string[]>([]);
    const [ selectedBookmark, setSelectedBookmark ] = useState("");
    const [ noteTitle, setNoteTitle ] = useState("");
    const [ shown, setShown ] = useState(false);
    const [ target, setTarget ] = useState<LinkTarget>("note");
    const [ webLink, setWebLink ] = useState("");
    const hasSubmittedRef = useRef(false);
    const webLinkRef = useRef<HTMLInputElement>(null);
    // The text of the link being edited, while it stands in for the picked note's title.
    const keptTitleRef = useRef<string | null>(null);
    const initialBookmarkRef = useRef("");
    // On mobile, focusing a field opens the keyboard, so a field waits for a tap.
    const autoFocus = !isMobile();

    useTriliumEvent("showAddLinkDialog", opts => {
        setOpts(opts);
        setShown(true);
    });

    useEffect(() => {
        if (opts?.hasSelection || opts?.currentTitle !== undefined) {
            setLinkType("hyper-link");
        } else {
            setLinkType("reference-link");
        }

        const initialWebLink = opts ? getInitialWebLink(opts) : null;
        setTarget(initialWebLink !== null ? "url" : "note");
        setWebLink(initialWebLink ?? "");
        keptTitleRef.current = opts?.currentTitle ?? null;
        initialBookmarkRef.current = opts?.currentBookmark ?? "";
        setLinkTitle(opts?.currentTitle ?? "");

        // Taken as though it had just been picked, so that a dialog opened on a link and left alone
        // has one to apply — and so that everything a pick settles (the title, the anchors a note
        // offers, whether it is a link outside Trilium at all) is settled for it as well.
        const initialLink = initialWebLink !== null ? normalizeWebLink(initialWebLink) : null;
        setSuggestion(opts?.currentLink ?? (initialLink ? { externalLink: initialLink } : null));
    }, [ opts ]);

    function changeWebLink(text: string) {
        setWebLink(text);
        const link = normalizeWebLink(text);
        setSuggestion(link ? { externalLink: link } : null);
    }

    function changeTarget(next: LinkTarget, text = "") {
        keptTitleRef.current = null;
        setTarget(next);
        setNoteTitle("");
        setLinkTitle("");
        setLinkType(opts?.hasSelection ? "hyper-link" : "reference-link");
        if (next === "url") {
            changeWebLink(text);
        } else {
            setWebLink("");
            setSuggestion(null);
        }
    }

    useEffect(() => {
        if (!autoFocus) return;
        if (target === "url") {
            webLinkRef.current?.focus();
        } else {
            autocompleteRef.current?.focus();
        }
    }, [ target ]);

    // A URL pasted on the note side moves to the web link side.
    useEffect(() => {
        const input = autocompleteRef.current;
        if (!input || target !== "note" || opts?.fixLink) return;

        const onPaste = (e: ClipboardEvent) => {
            const text = e.clipboardData?.getData("text/plain").trim();
            if (text && hasScheme(text)) {
                e.preventDefault();
                changeTarget("url", text);
            }
        };
        input.addEventListener("paste", onPaste);
        return () => input.removeEventListener("paste", onPaste);
    }, [ target, opts ]);

    async function setDefaultLinkTitle(noteId: string) {
        const title = await tree.getNoteTitle(noteId);
        setNoteTitle(title);
        if (keptTitleRef.current === null) {
            setLinkTitle(title);
        }
    }

    useEffect(() => {
        const resetExternalLink = () =>
            setLinkType((prev) => prev === "external-link" ? "reference-link" : prev);

        if (!suggestion) {
            resetExternalLink();
            setBookmarks([]);
            setSelectedBookmark("");
            return;
        }

        let cancelled = false;

        if (suggestion.notePath) {
            const noteId = tree.getNoteIdFromUrl(suggestion.notePath);
            if (noteId) {
                setDefaultLinkTitle(noteId);
                (async () => {
                    const note = await froca.getNote(noteId);
                    if (cancelled || !note) return;

                    let bkms = note.getLabels("internalBookmark").map((l) => l.value);

                    // Fall back to scanning the note content for anchors if no labels
                    // are present (e.g. notes that predate the bookmark-label feature).
                    if (bkms.length === 0 && note.type === "text") {
                        const content = await note.getContent();
                        if (cancelled) return;
                        if (typeof content === "string") {
                            bkms = findAnchorIds(content);
                        }
                    }

                    setBookmarks(bkms);
                    setSelectedBookmark(initialBookmarkRef.current);
                    initialBookmarkRef.current = "";
                })();
            }
            resetExternalLink();
        }

        if (suggestion.externalLink) {
            setLinkType("external-link");
        }

        return () => { cancelled = true; };
    }, [suggestion]);

    useEffect(() => {
        if (keptTitleRef.current !== null) return;
        if (selectedBookmark) {
            setLinkTitle(`${noteTitle} - ${selectedBookmark}`);
        } else {
            setLinkTitle(noteTitle);
        }
    }, [selectedBookmark, noteTitle]);

    async function onShown() {
        if (target === "url") {
            if (autoFocus) {
                webLinkRef.current?.focus();
                webLinkRef.current?.select();
            }
            return;
        }

        const $autocompleteEl = refToJQuerySelector(autocompleteRef);
        const currentNotePath = opts?.currentLink?.notePath;
        const currentNoteId = currentNotePath && tree.getNoteIdFromUrl(currentNotePath);

        // A link already there fills the field the way text handed to the dialog does: a note by the
        // name it goes by, an address as it stands. Through the autocomplete rather than around it —
        // a value the field is given behind its back is one it does not know it holds, so nothing is
        // searched for it and it is wiped the moment the field is left.
        const text = (currentNoteId ? await tree.getNoteTitle(currentNoteId) : opts?.currentLink?.externalLink)
            || opts?.text;

        if (!text) {
            if (autoFocus) handleRef.current?.showRecentNotes();
        } else {
            // The note the dialog opens on is picked already, so the field selects it.
            handleRef.current?.setText(text, currentNotePath);
        }

        // to be able to quickly remove entered text
        if (autoFocus) {
            $autocompleteEl
                .trigger("focus")
                .trigger("select");
        }
    }

    function onSubmit() {
        hasSubmittedRef.current = true;

        if (suggestion) {
            // Insertion logic in onHidden because it needs focus.
            setShown(false);
        } else {
            logError("No link to add.");
        }
    }

    const autocompleteRef = useRef<HTMLInputElement>(null);
    const handleRef = useRef<NoteAutocompleteHandle>(null);
    const title = opts?.fixLink ? t("add_link.fix_link")
        : opts?.currentLink ? t("add_link.edit_link") : t("add_link.add_link");
    const buttonText = opts?.fixLink ? t("add_link.button_fix_link")
        : opts?.currentLink ? t("add_link.button_edit_link") : t("add_link.button_add_link");

    const showsTitle = !opts?.hasSelection && !opts?.targetOnly && !opts?.fixLink;
    const titleSection = (
        <OptionCardSection
            className="add-link-text" name="link-title" label={t("add_link.link_title")}
        >
            <FormTextBox
                currentValue={linkTitle}
                placeholder={target === "url" ? suggestion?.externalLink : undefined}
                onChange={setLinkTitle}
            />
        </OptionCardSection>
    );

    return (
        <Modal
            className="add-link-dialog"
            size="lg"
            title={title}
            helpPageId="QEAPj01N5f7w"
            footer={<Button text={buttonText} keyboardShortcut="Enter" />}
            onSubmit={onSubmit}
            onShown={onShown}
            onHidden={() => {
                // Insert the link.
                if (hasSubmittedRef.current && suggestion && opts) {
                    hasSubmittedRef.current = false;

                    if (suggestion.notePath) {
                        // Handle note link, optionally with a bookmark anchor
                        const path = selectedBookmark
                            ? `${suggestion.notePath}?bookmark=${encodeURIComponent(selectedBookmark)}`
                            : suggestion.notePath;
                        opts.addLink(path, linkType === "reference-link" ? null : linkTitle);
                    } else if (suggestion.externalLink) {
                        // An external link without a text of its own reads as its address.
                        const text = linkTitle.trim() || suggestion.externalLink;
                        opts.addLink(suggestion.externalLink, text, true);
                    }
                }

                setSuggestion(null);
                setBookmarks([]);
                setSelectedBookmark("");
                setNoteTitle("");
                setShown(false);
            }}
            show={shown}
        >
            <Card>
                {!opts?.fixLink && (
                    <CardSection>
                        <SegmentedChoice<LinkTarget>
                            className="add-link-target"
                            options={[
                                { value: "note", label: t("add_link.note"), icon: "bx-note" },
                                { value: "url", label: t("add_link.web_link"), icon: "bx-globe" }
                            ]}
                            currentValue={target}
                            onChange={(next) => changeTarget(next)}
                        />
                    </CardSection>
                )}

                {target === "url" ? (
                    <OptionCardSection
                        className="add-link-url" name="url" label={t("add_link.url")}
                        subSectionsVisible={showsTitle}
                        subSections={titleSection}
                    >
                        <FormTextBox
                            inputRef={webLinkRef}
                            inputMode="url"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellcheck={false}
                            placeholder="https://"
                            currentValue={webLink}
                            onChange={changeWebLink}
                        />
                    </OptionCardSection>
                ) : (
                    <>
                        <OptionCardSection
                            className="add-link-note" name="note" label={t("add_link.note")}
                        >
                            <NoteAutocomplete
                                inputRef={autocompleteRef}
                                handleRef={handleRef}
                                // A URL picked from the search belongs on the web link side.
                                onChange={(picked) => {
                                    if (picked?.externalLink) {
                                        changeTarget("url", picked.externalLink);
                                        return;
                                    }
                                    // Another note takes its own title over the edited link's text.
                                    if (picked?.notePath !== suggestion?.notePath) {
                                        keptTitleRef.current = null;
                                    }
                                    setSuggestion(picked);
                                }}
                                opts={{
                                    allowExternalLinks: !opts?.fixLink,
                                    allowCreatingNotes: true
                                }}
                            />
                        </OptionCardSection>

                        {bookmarks.length > 0 && !opts?.targetOnly && (
                            <OptionCardSection name="anchor" label={t("add_link.anchor")}>
                                <FormSelect
                                    values={[
                                        { value: "", title: t("add_link.anchor_none") },
                                        ...bookmarks.map((bookmark) => ({
                                            value: bookmark, title: bookmark
                                        }))
                                    ]}
                                    keyProperty="value"
                                    titleProperty="title"
                                    currentValue={selectedBookmark}
                                    onChange={(bookmark) => {
                                        keptTitleRef.current = null;
                                        setSelectedBookmark(bookmark);
                                    }}
                                />
                            </OptionCardSection>
                        )}

                        {showsTitle && (
                            <OptionCardSection
                                className="add-link-mirror"
                                name="mirror-title"
                                label={t("add_link.mirror_title")}
                                description={t("add_link.mirror_title_description")}
                                subSectionsVisible={linkType === "hyper-link"}
                                subSections={titleSection}
                            >
                                <FormToggle
                                    currentValue={linkType === "reference-link"}
                                    onChange={(mirror) => {
                                        setLinkType(mirror ? "reference-link" : "hyper-link");
                                    }}
                                />
                            </OptionCardSection>
                        )}
                    </>
                )}
            </Card>
        </Modal>
    );
}

/**
 * The address the dialog opens on, on the web link side: the external link being edited, or a
 * selected text that is a URL. `null` opens it on the note side.
 */
function getInitialWebLink(opts: AddLinkOpts): string | null {
    if (opts.fixLink) return null;
    if (opts.currentLink) return opts.currentLink.externalLink ?? null;
    const text = opts.text.trim();
    return opts.hasSelection && hasScheme(text) ? text : null;
}

/** Whether `text` is a whole URL with a scheme, the way the note search tells URLs apart. */
function hasScheme(text: string) {
    return /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(text);
}

/**
 * The link for an address as typed: trimmed, and with `https://` before an address that names no
 * scheme, as CKEditor's `link.defaultProtocol` does. `null` for an empty one.
 */
export function normalizeWebLink(text: string): string | null {
    const link = text.trim();
    if (!link) return null;
    const scheme = /^([a-z][a-z0-9+.-]*):(\d?)/i.exec(link);
    // A colon followed by a digit is a port, as in `localhost:8080`, unless it ends a scheme
    // Trilium allows, as in `tel:123`.
    const hasScheme = scheme && (!scheme[2] || ALLOWED_PROTOCOLS.includes(scheme[1].toLowerCase()));
    return hasScheme ? link : `https://${link}`;
}
