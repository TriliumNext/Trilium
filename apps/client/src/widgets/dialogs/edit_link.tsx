import "./edit_link.css";

import type { LinkDisplayMode } from "@triliumnext/ckeditor5";
import internalLinkIcon from "@triliumnext/ckeditor5/src/icons/trilium.svg?raw";
import { ALLOWED_PROTOCOLS, isHttpUrl } from "@triliumnext/commons";
import { useEffect, useRef, useState } from "preact/hooks";

import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { detectEmbedType } from "../../services/link_embed";
import type { Suggestion } from "../../services/note_autocomplete";
import tree from "../../services/tree";
import { isMobile } from "../../services/utils";
import { logError } from "../../services/ws";
import Button from "../react/Button";
import { Card, CardSection, ChoiceCardSection, OptionCardSection } from "../react/Card";
import FormSelect from "../react/FormSelect";
import FormTextArea from "../react/FormTextArea";
import FormTextBox from "../react/FormTextBox";
import FormToggle from "../react/FormToggle";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import { suspendModalFocusTraps } from "../react/modal_focustrap";
import NoItems from "../react/NoItems";
import NoteAutocomplete, { type NoteAutocompleteHandle } from "../react/NoteAutocomplete";
import { refToJQuerySelector } from "../react/react_utils";
import SegmentedChoice, { type SegmentedChoiceOption } from "../react/SegmentedChoice";

type LinkType = "reference-link" | "external-link" | "hyper-link";

/** What the link points at: a note, an address outside Trilium, or an anchor in the document. */
export type LinkTarget = "note" | "url" | "anchor";

export interface EditLinkOpts {
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
    /** The description of the link preview being edited. */
    currentDescription?: string;
    /** The anchor within the note that the link being edited points at. */
    currentBookmark?: string;
    /**
     * The anchors in the document that the link goes into. When given, the dialog has an Anchors
     * page that links to one of them.
     */
    anchors?: string[];
    /** The anchor in `anchors` that the link being edited points at. */
    currentAnchor?: string;
    /**
     * The side a new link opens on, the note side by default. A selected URL opens on the web link
     * side.
     */
    target?: Exclude<LinkTarget, "anchor">;
    /**
     * Repoints a reference link to a missing note. The dialog is titled "Fix link", searches for
     * `text`, and offers only notes, always as a reference link.
     */
    fixLink?: boolean;
    /**
     * How the web link is displayed: a plain link by default, or as the link preview being edited.
     * `embed` falls back to a card for an address without a player.
     */
    display?: LinkDisplayMode;
    addLink(notePath: string, linkTitle: string | null, externalLink?: boolean): Promise<void>;
    /**
     * Puts a preview of the web link in place of the link. A caller that can show previews passes
     * it, and the dialog then offers the choice of how a web link is displayed, except for a link
     * on a selection. `title` and `description` replace the page's own.
     */
    addLinkPreview?(
        url: string, display: LinkDisplayMode, title: string | null, description: string | null
    ): Promise<void>;
}

export default function EditLinkDialog() {
    const [ opts, setOpts ] = useState<EditLinkOpts>();
    const [ shown, setShown ] = useState(false);
    const hasSubmittedRef = useRef(false);
    const form = useEditLinkForm(opts);

    useTriliumEvent("showEditLinkDialog", opts => {
        setOpts(opts);
        setShown(true);
    });

    function onSubmit() {
        if (!form.hasLink) {
            logError("No link to apply.");
            return;
        }

        hasSubmittedRef.current = true;
        // Insertion logic in onHidden because it needs focus.
        setShown(false);
    }

    return (
        <Modal
            className="edit-link-dialog"
            size="lg"
            title={form.title}
            helpPageId="QEAPj01N5f7w"
            footer={<Button text={form.buttonText} keyboardShortcut="Enter" />}
            onSubmit={onSubmit}
            onShown={form.onShown}
            onHidden={() => {
                if (hasSubmittedRef.current) {
                    hasSubmittedRef.current = false;
                    form.applyLink();
                }

                form.reset();
                setShown(false);
            }}
            show={shown}
        >
            {form.body}
        </Modal>
    );
}

/**
 * The form of the link dialog in the balloon that the text editor places at the caret. `onClose`
 * closes the balloon.
 */
export function EditLinkBalloon({ opts, onClose }: { opts: EditLinkOpts; onClose(): void }) {
    // Lets the fields take focus inside a modal, such as the quick edit popup. Runs before the
    // effects of `useEditLinkForm()`, which focus the fields.
    useEffect(() => suspendModalFocusTraps(), []);
    const form = useEditLinkForm(opts);

    useEffect(() => {
        form.onShown();
    }, []);

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                if (!form.hasLink) return;

                onClose();
                form.applyLink();
            }}
        >
            {form.body}
            <div className="edit-link-actions">
                <Button text={form.buttonText} keyboardShortcut="Enter" />
            </div>
        </form>
    );
}

/** The state and the fields of the link dialog for `opts`, shared by the modal and the balloon. */
function useEditLinkForm(opts: EditLinkOpts | undefined) {
    const [ linkTitle, setLinkTitle ] = useState("");
    const [ linkDescription, setLinkDescription ] = useState("");
    const [ linkType, setLinkType ] = useState<LinkType>();
    const [ suggestion, setSuggestion ] = useState<Suggestion | null>(null);
    const [ bookmarks, setBookmarks ] = useState<string[]>([]);
    const [ selectedBookmark, setSelectedBookmark ] = useState("");
    const [ noteTitle, setNoteTitle ] = useState("");
    const [ target, setTarget ] = useState<LinkTarget>("note");
    const [ webLink, setWebLink ] = useState("");
    const [ display, setDisplay ] = useState<LinkDisplayMode>("plain");
    const [ anchor, setAnchor ] = useState("");
    const [ isShowPending, setIsShowPending ] = useState(false);
    const webLinkRef = useRef<HTMLInputElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    // The text of the link being edited, while it stands in for the picked note's title.
    const keptTitleRef = useRef<string | null>(null);
    const initialBookmarkRef = useRef("");
    // The title of the link preview being edited, while the title field still shows it.
    const previewTitleRef = useRef<string | null>(null);
    // The description of the link preview being edited, while the description field still shows it.
    const previewDescriptionRef = useRef<string | null>(null);
    // On mobile, focusing a field opens the keyboard, so a field waits for a tap.
    const autoFocus = !isMobile();

    useEffect(() => {
        if (opts?.hasSelection || opts?.currentTitle !== undefined) {
            setLinkType("hyper-link");
        } else {
            setLinkType("reference-link");
        }

        const initialWebLink = opts ? getInitialWebLink(opts) : null;
        setTarget(getInitialTarget(opts, initialWebLink));
        setWebLink(initialWebLink ?? "");
        setDisplay(opts?.display ?? "plain");
        setAnchor(opts?.currentAnchor ?? "");
        keptTitleRef.current = opts?.currentTitle ?? null;
        previewTitleRef.current = opts?.currentLink && opts.display && opts.display !== "plain"
            ? opts.currentTitle ?? null : null;
        initialBookmarkRef.current = opts?.currentBookmark ?? "";
        setLinkTitle(opts?.currentTitle ?? "");
        previewDescriptionRef.current = opts?.currentDescription ?? null;
        setLinkDescription(opts?.currentDescription ?? "");

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
        // A preview's title and description are its page's, so another address takes those of its
        // own page.
        if (previewTitleRef.current !== null && linkTitle === previewTitleRef.current) {
            setLinkTitle("");
        }
        previewTitleRef.current = null;
        if (linkDescription === previewDescriptionRef.current) {
            setLinkDescription("");
        }
        previewDescriptionRef.current = null;
    }

    function changeTarget(next: LinkTarget, text = "") {
        keptTitleRef.current = null;
        setTarget(next);
        setNoteTitle("");
        setLinkTitle("");
        setLinkDescription("");
        setLinkType(opts?.hasSelection ? "hyper-link" : "reference-link");
        setAnchor("");
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
        } else if (target === "anchor") {
            titleRef.current?.focus();
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

    // Runs one render after `onShown`, so `fillAndFocus()` reads the state set from `opts`.
    useEffect(() => {
        if (!isShowPending) return;
        setIsShowPending(false);
        void fillAndFocus();
    }, [ isShowPending ]);

    async function fillAndFocus() {
        if (target === "url" || target === "anchor") {
            const field = target === "url" ? webLinkRef.current : titleRef.current;
            if (autoFocus) {
                field?.focus();
                field?.select();
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

    // A link on a selection keeps the selected text, which a preview would replace.
    const showsDisplay = target === "url" && !!opts?.addLinkPreview && !opts.hasSelection;
    const shownDisplay = getShownDisplay(display, suggestion?.externalLink);
    const isPreview = showsDisplay && shownDisplay !== "plain";
    const showsTitle = !opts?.hasSelection && !opts?.targetOnly && !opts?.fixLink;
    // A video player shows no title.
    const showsWebLinkTitle = showsTitle && !(showsDisplay && shownDisplay === "embed");
    // Only a card shows a description.
    const showsDescription = showsTitle && showsDisplay && shownDisplay === "card";

    /** Applies the link picked, through `opts.addLink` or `opts.addLinkPreview`. */
    function applyLink() {
        if (!opts) return;

        if (target === "anchor") {
            // An anchor link without a text of its own reads as the anchor's name. `true` keeps
            // the href as it is.
            if (anchor) opts.addLink(`#${anchor}`, linkTitle.trim() || anchor, true);
            return;
        }

        if (!suggestion) return;

        if (suggestion.notePath) {
            // Handle note link, optionally with a bookmark anchor
            const path = selectedBookmark
                ? `${suggestion.notePath}?bookmark=${encodeURIComponent(selectedBookmark)}`
                : suggestion.notePath;
            opts.addLink(path, linkType === "reference-link" ? null : linkTitle);
        } else if (suggestion.externalLink) {
            const url = suggestion.externalLink;
            const text = linkTitle.trim();
            if (isPreview && opts.addLinkPreview) {
                // A text that only repeats the address leaves the page's own title.
                const title = shownDisplay !== "embed" && text && text !== url ? text : null;
                const description = showsDescription ? linkDescription.trim() || null : null;
                void opts.addLinkPreview(url, shownDisplay, title, description);
                return;
            }
            // An external link without a text of its own reads as its address.
            opts.addLink(url, text || url, true);
        }
    }

    function reset() {
        setSuggestion(null);
        setBookmarks([]);
        setSelectedBookmark("");
        setNoteTitle("");
    }

    const autocompleteRef = useRef<HTMLInputElement>(null);
    const handleRef = useRef<NoteAutocompleteHandle>(null);
    const isEditing = !!opts?.currentLink || !!opts?.currentAnchor;
    const title = opts?.fixLink ? t("add_link.fix_link")
        : isEditing ? t("add_link.edit_link") : t("add_link.add_link");
    const buttonText = opts?.fixLink ? t("add_link.button_fix_link")
        : isEditing ? t("add_link.button_edit_link") : t("add_link.button_add_link");

    /** The text the link reads as while the title field is empty. */
    function getTitlePlaceholder() {
        if (target === "anchor") return anchor || undefined;
        if (target !== "url") return undefined;
        return isPreview ? t("add_link.page_title")
            : suggestion?.externalLink ?? t("add_link.title_from_url");
    }

    const titleSection = (
        <OptionCardSection
            className="edit-link-text" name="link-title" label={t("add_link.link_title")}
        >
            <FormTextBox
                inputRef={titleRef}
                currentValue={linkTitle}
                placeholder={getTitlePlaceholder()}
                onChange={setLinkTitle}
            />
        </OptionCardSection>
    );

    const targets: SegmentedChoiceOption<LinkTarget>[] = [
        { value: "url", label: t("add_link.web_link"), icon: "bx-globe" },
        { value: "note", label: t("add_link.note"), iconSvg: internalLinkIcon }
    ];
    if (opts?.anchors) {
        targets.push({ value: "anchor", label: t("add_link.anchors"), icon: "bx-bookmark" });
    }
    const switcher = !opts?.fixLink && (
        <SegmentedChoice<LinkTarget>
            className="edit-link-target"
            options={targets}
            currentValue={target}
            onChange={(next) => changeTarget(next)}
        />
    );

    const anchors = opts?.anchors ?? [];
    const anchorPage = (<>
        {showsTitle && <Card>{titleSection}</Card>}

        <Card className="edit-link-anchors" heading={t("add_link.target_anchor")}>
            {anchors.length > 0 ? anchors.map((name) => (
                <ChoiceCardSection
                    key={name}
                    icon="bx bx-bookmark"
                    isChecked={name === anchor}
                    onCheck={() => setAnchor(name)}
                >
                    {name}
                </ChoiceCardSection>
            )) : (
                <CardSection className="edit-link-no-anchors">
                    <NoItems icon="bx bx-bookmark" text={t("add_link.no_anchors")} size="small" />
                </CardSection>
            )}
        </Card>
    </>);
    const displays = [
        { value: "plain", title: t("add_link.display_plain") },
        { value: "inline", title: t("add_link.display_inline") },
        { value: "card", title: t("add_link.display_card") },
        ...(hasPlayer(suggestion?.externalLink)
            ? [ { value: "embed", title: t("add_link.display_embed") } ]
            : [])
    ];

    return {
        title,
        buttonText,
        hasLink: target === "anchor" ? !!anchor : !!suggestion,
        /** Fills and focuses the fields, once the form is on screen. */
        onShown: () => setIsShowPending(true),
        applyLink,
        reset,
        body: target === "anchor" ? (<>
            {switcher}
            {anchorPage}
        </>) : (<>
            {switcher}

            <Card>
                {target === "url" ? (
                    <>
                        <OptionCardSection
                            className="edit-link-url" name="url" label={t("add_link.url")}
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

                        {showsWebLinkTitle && titleSection}

                        {showsDescription && (
                            <OptionCardSection
                                className="edit-link-description" name="link-description"
                                label={t("add_link.description")}
                            >
                                <FormTextArea
                                    rows={2}
                                    currentValue={linkDescription}
                                    placeholder={t("add_link.page_description")}
                                    onChange={setLinkDescription}
                                    onKeyDown={(e) => {
                                        // A card shows its description as one paragraph, so
                                        // Enter saves the link as in the other fields.
                                        if (e.key !== "Enter" || e.isComposing) return;
                                        e.preventDefault();
                                        e.currentTarget.form?.requestSubmit();
                                    }}
                                />
                            </OptionCardSection>
                        )}

                        {showsDisplay && (
                            <OptionCardSection
                                className="edit-link-display" name="display"
                                label={t("add_link.display_as")}
                            >
                                <FormSelect
                                    values={displays}
                                    keyProperty="value"
                                    titleProperty="title"
                                    currentValue={shownDisplay}
                                    disabled={!canPreview(suggestion?.externalLink)}
                                    onChange={(next) => setDisplay(next as LinkDisplayMode)}
                                />
                            </OptionCardSection>
                        )}
                    </>
                ) : (
                    <>
                        <OptionCardSection
                            className="edit-link-note" name="note" label={t("add_link.note")}
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
                                className="edit-link-mirror"
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
        </>)
    };
}

/**
 * The page the dialog opens on: Anchors for an edited anchor link, Web link when there is an
 * `initialWebLink`, and Note otherwise.
 */
function getInitialTarget(
    opts: EditLinkOpts | undefined, initialWebLink: string | null
): LinkTarget {
    if (opts?.currentAnchor) return "anchor";
    return initialWebLink !== null ? "url" : "note";
}

/**
 * The address the dialog opens on, on the web link side: the external link being edited, a
 * selected text that is a URL, or an empty one for `target: "url"`. `null` opens it on the note
 * side.
 */
function getInitialWebLink(opts: EditLinkOpts): string | null {
    if (opts.fixLink) return null;
    if (opts.currentLink) return opts.currentLink.externalLink ?? null;
    const text = opts.text.trim();
    if (opts.hasSelection && hasScheme(text)) return text;
    return opts.target === "url" ? "" : null;
}

/** The `id`s of the anchors in the HTML `content`, which are `<a>` elements without an `href`. */
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

/**
 * How the web link to `url` is displayed when `display` is picked: as a plain link when the address
 * is not a web page, and as a card in place of a player that the address does not have.
 *
 * Exported for testing.
 */
export function getShownDisplay(display: LinkDisplayMode, url: string | undefined): LinkDisplayMode {
    if (!canPreview(url)) return "plain";
    return display === "embed" && !hasPlayer(url) ? "card" : display;
}

/** Whether a web link to `url` can be a preview: a web page, or no address typed yet. */
function canPreview(url: string | undefined) {
    return !url || isHttpUrl(url);
}

/** Whether `url` has a video player to embed. */
function hasPlayer(url: string | undefined) {
    return !!url && detectEmbedType(url) !== "opengraph";
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
