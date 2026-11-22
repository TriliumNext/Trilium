import "./edit_link.css";

import type { LinkDisplayMode } from "@triliumnext/ckeditor5";
import internalLinkIcon from "@triliumnext/ckeditor5/src/icons/trilium.svg?raw";
import type { ReferenceKind, ReferenceParams } from "@triliumnext/commons";
import { isHttpUrl } from "@triliumnext/commons/src/lib/link_embed.js";
import { ALLOWED_PROTOCOLS } from "@triliumnext/commons/src/lib/shared_constants.js";
import type { ComponentProps } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { detectEmbedType, fetchPageDetails, type PageDetails } from "../../services/link_embed";
import {
    addParameters, createAnchorTargets, findTarget, getAttachmentLinkTargets, getLinkTargets,
    getNoTargetsText, getParentTargets, LINK_TARGET_KINDS, type LinkTarget, nestTargets,
    splitTargetParameters, StaleListingError
} from "../../services/link_targets";
import type { Suggestion } from "../../services/note_autocomplete";
import options from "../../services/options";
import toast from "../../services/toast";
import tree from "../../services/tree";
import { isMobile } from "../../services/utils";
import { logError } from "../../services/ws";
import Button from "../react/Button";
import { Card, OptionCardSection } from "../react/Card";
import FormSelect from "../react/FormSelect";
import FormTextArea from "../react/FormTextArea";
import FormTextBox, { type FormTextBoxProps, FormTextBoxWithPaste } from "../react/FormTextBox";
import { useTriliumEvent } from "../react/hooks/events";
import LinkTargetList, { scrollToCheckedChoice } from "../react/LinkTargetList";
import { InputGroupSpinner } from "../react/LoadingSpinner";
import Modal from "../react/Modal";
import { suspendModalFocusTraps } from "../react/modal_focustrap";
import NoItems from "../react/NoItems";
import NoteAutocomplete, { type NoteAutocompleteHandle } from "../react/NoteAutocomplete";
import { refToJQuerySelector } from "../react/react_utils";
import SegmentedChoice, { type SegmentedChoiceOption } from "../react/SegmentedChoice";

/**
 * The page of the dialog, by what the link points at: a note, an address outside Trilium, or a
 * heading or an anchor in the document.
 */
export type LinkPage = "note" | "url" | "anchor";

/** An empty text of the link for each page. */
const NO_LINK_TITLES: Readonly<Record<LinkPage, string>> = { note: "", url: "", anchor: "" };

/**
 * What a link on the note page points at inside the note: a target of the note, or the link
 * parameters of the link being edited, whose target can be missing from the list. `null` is the
 * whole note.
 */
type NotePart = { target: LinkTarget } | { params: ReferenceParams } | null;

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
     * The text of the link being edited, which the title field opens with and keeps until another
     * note is picked. Without it, a link to a note mirrors the note's title.
     */
    currentTitle?: string;
    /** The description of the link preview being edited. */
    currentDescription?: string;
    /** The anchor within the note that the link being edited points at. */
    currentBookmark?: string;
    /**
     * The anchors in the document that the link goes into. When given, the dialog has a Headings
     * & anchors page that links to one of them.
     */
    anchors?: string[];
    /** The anchor in `anchors` that the link being edited points at. */
    currentAnchor?: string;
    /**
     * The headings of the document that the link goes into, in document order. When given, the
     * Heading / anchor page lists them.
     */
    headings?: LinkTarget[];
    /** The heading in `headings` that the link being edited points at. */
    currentHeading?: LinkTarget;
    /**
     * The id of the note that the link goes into. When the note page picks this note, it lists
     * `headings` and `anchors`, which follow the editor, rather than those the server reads.
     */
    noteId?: string;
    /**
     * The page a new link opens on, the note side by default. A selected URL opens on the web link
     * side.
     */
    target?: LinkPage;
    /**
     * Repoints a reference link to a missing note. The dialog is titled "Fix link", searches for
     * `text`, and offers only notes, always as a reference link.
     */
    fixLink?: boolean;
    /**
     * How the web link is displayed: a text link by default, or as the link preview being edited.
     * `embedLink` falls back to a card for an address without a player.
     */
    display?: LinkDisplayMode;
    /**
     * Edits a media embed: the dialog shows only the address and the title, and applies them
     * through `addLinkPreview` as an embed.
     */
    isMedia?: boolean;
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
    // The `applyLink()` of the render that submitted, so that a choice made while it waited for
    // the server does not change the link.
    const submittedLinkRef = useRef<(() => void) | null>(null);
    const form = useEditLinkForm(opts);

    useTriliumEvent("showEditLinkDialog", opts => {
        setOpts(opts);
        setShown(true);
    });

    async function onSubmit() {
        if (!form.hasLink) {
            logError("No link to apply.");
            return;
        }
        if (form.isCreatingReference || !form.validate()) return;
        if (form.needsReference && !await form.createReference()) return;

        submittedLinkRef.current = form.applyLink;
        // Insertion logic in onHidden because it needs focus.
        setShown(false);
    }

    return (
        <Modal
            className="edit-link-dialog"
            size="lg"
            title={form.title}
            helpPageId="QEAPj01N5f7w"
            footer={
                <Button
                    text={form.buttonText} keyboardShortcut="Enter"
                    disabled={!form.hasLink || form.isCreatingReference}
                />
            }
            onSubmit={() => void onSubmit()}
            onShown={form.onShown}
            onHide={form.cancelReference}
            onHidden={() => {
                const applyLink = submittedLinkRef.current;
                submittedLinkRef.current = null;
                applyLink?.();

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

    async function submit() {
        if (!form.hasLink || form.isCreatingReference || !form.validate()) return;
        if (form.needsReference && !await form.createReference()) return;

        onClose();
        form.applyLink();
    }

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                void submit();
            }}
        >
            {form.body}
            <div className="edit-link-actions">
                <Button
                    text={form.buttonText} keyboardShortcut="Enter"
                    disabled={!form.hasLink || form.isCreatingReference}
                />
            </div>
        </form>
    );
}

/**
 * The state and the fields of the link dialog for `opts`, shared by the modal and the balloon. Each
 * page keeps its own state while another page is shown, and only the page shown is applied.
 */
function useEditLinkForm(opts: EditLinkOpts | undefined) {
    const [ linkTitles, setLinkTitles ] = useState(NO_LINK_TITLES);
    const [ linkDescription, setLinkDescription ] = useState("");
    // The note picked on the note page.
    const [ suggestion, setSuggestion ] = useState<Suggestion | null>(null);
    // The targets of that note, `null` while they load.
    const [ noteTargets, setNoteTargets ] = useState<LinkTarget[] | null>(null);
    // Whether the viewer of the note picked lists its headings once it has opened it.
    const [ isTocPending, setIsTocPending ] = useState(false);
    const [ notePart, setNotePart ] = useState<NotePart>(null);
    const [ expandedNoteTargets, setExpandedNoteTargets ] = useState<ReadonlySet<LinkTarget>>(
        new Set()
    );
    const [ isCreatingReference, setIsCreatingReference ] = useState(false);
    const [ noteTitle, setNoteTitle ] = useState("");
    const [ target, setTarget ] = useState<LinkPage>("note");
    const [ webLink, setWebLink ] = useState("");
    const [ display, setDisplay ] = useState<LinkDisplayMode>("textLink");
    // The heading or the anchor of the document that the Heading / anchor page links to.
    const [ ownTarget, setOwnTarget ] = useState<LinkTarget | null>(null);
    const [ expandedOwnTargets, setExpandedOwnTargets ] = useState<ReadonlySet<LinkTarget>>(
        new Set()
    );
    const [ isShowPending, setIsShowPending ] = useState(false);
    // An edited attachment link keeps its target, so the form edits its title alone.
    const isAttachmentLink = !opts?.targetOnly && isAttachmentPath(opts?.currentLink?.notePath);
    const isMedia = !!opts?.isMedia;
    const webLinkRef = useRef<HTMLInputElement>(null);
    const titleRef = useRef<HTMLInputElement>(null);
    // The scrolling boxes around the Headings and Anchors cards, of the Heading / anchor page and
    // of the note page.
    const linkTargetsRef = useRef<HTMLDivElement>(null);
    const noteTargetsRef = useRef<HTMLDivElement>(null);
    // The headings and anchors of the document, which the Heading / anchor page lists.
    const ownTargets = useMemo(() => [
        ...(opts?.headings ?? []), ...createOwnAnchors(opts?.anchors ?? [])
    ], [ opts ]);
    const ownTree = useMemo(() => nestTargets(ownTargets), [ ownTargets ]);
    const noteTree = useMemo(() => nestTargets(noteTargets ?? []), [ noteTargets ]);
    // Changes when the form is reset, canceled or unmounted, so a reference created later applies
    // no link.
    const generationRef = useRef(0);
    // The page's own title, of the link preview being edited or retrieved from the page, while the
    // title field still shows it.
    const previewTitleRef = useRef<string | null>(null);
    // The page's own description, as `previewTitleRef`.
    const previewDescriptionRef = useRef<string | null>(null);
    // The details of the web pages read since the dialog opened, by URL.
    const pageDetailsRef = useRef(new Map<string, Promise<PageDetails | null>>());
    // The URL whose page details are being read.
    const [ retrievingUrl, setRetrievingUrl ] = useState<string | null>(null);
    const [ isRetrievalPending, setIsRetrievalPending ] = useState(false);
    // The fields show their errors from the first submit on.
    const [ showsErrors, setShowsErrors ] = useState(false);
    // On mobile, focusing a field opens the keyboard, so a field waits for a tap.
    const autoFocus = !isMobile();

    useEffect(() => {
        const initialWebLink = opts ? getInitialWebLink(opts) : null;
        const initialTarget = getInitialTarget(opts, initialWebLink);
        setTarget(initialTarget);
        setWebLink(initialWebLink ?? "");
        setDisplay(opts?.display ?? "textLink");
        setOwnTarget(opts?.currentHeading ?? ownTargets.find((own) =>
            own.kind === "anchor" && own.title === opts?.currentAnchor) ?? null);
        // Sub-headings start collapsed, except the ones above the heading being edited.
        setExpandedOwnTargets(new Set(
            opts?.currentHeading ? getParentTargets(ownTree, opts.currentHeading) : []
        ));
        previewTitleRef.current = opts?.currentLink && opts.display && opts.display !== "textLink"
            ? opts.currentTitle ?? null : null;
        setNotePart(getInitialNotePart(opts));
        setExpandedNoteTargets(new Set());
        setLinkTitles({ ...NO_LINK_TITLES, [initialTarget]: opts?.currentTitle ?? "" });
        previewDescriptionRef.current = opts?.currentDescription ?? null;
        setLinkDescription(opts?.currentDescription ?? "");
        pageDetailsRef.current = new Map();
        setRetrievingUrl(null);
        setShowsErrors(false);

        // Taken as though it had just been picked, so that a dialog opened on a link and left alone
        // has one to apply — and so that everything a pick settles (the title, the anchors a note
        // offers) is settled for it as well.
        setSuggestion(opts?.currentLink?.notePath ? opts.currentLink : null);
    }, [ opts ]);

    function setLinkTitle(page: LinkPage, title: string) {
        setLinkTitles((titles) => ({ ...titles, [page]: title }));
    }

    function changeWebLink(text: string) {
        setWebLink(text);
        // A title and description of a page belong to its address, so another address takes those
        // of its own page. Compared in the updaters: the paste listener calls this from an older
        // render.
        const previewTitle = previewTitleRef.current;
        const previewDescription = previewDescriptionRef.current;
        if (previewTitle !== null) {
            setLinkTitles((titles) => titles.url === previewTitle ? { ...titles, url: "" } : titles);
        }
        setLinkDescription((description) => description === previewDescription ? "" : description);
        previewTitleRef.current = null;
        previewDescriptionRef.current = null;
    }

    /** Shows the web link page with `url` as its address, for a URL found on the note page. */
    function moveToWebLink(url: string) {
        setTarget("url");
        changeWebLink(url);
    }

    useEffect(() => {
        // The note field mounts empty when the note page is shown again.
        if (target === "note" && suggestion?.notePath && noteTitle) {
            handleRef.current?.setText(noteTitle, suggestion.notePath);
        }

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
                moveToWebLink(text);
            }
        };
        input.addEventListener("paste", onPaste);
        return () => input.removeEventListener("paste", onPaste);
    }, [ target, opts ]);

    const notePath = suggestion?.notePath;
    // The note page lists where in the note or the attachment a link can point, except for a
    // caller that picks only the note.
    const showsNoteTargets = !opts?.targetOnly;

    useEffect(() => {
        setNoteTargets(null);
        setIsTocPending(false);
        const noteId = tree.getNoteIdFromUrl(notePath);
        if (!notePath || !noteId) return;

        let cancelled = false;
        void tree.getNoteTitle(noteId).then((title) => {
            if (!cancelled) setNoteTitle(title);
        });

        const { path } = splitTargetParameters(notePath);
        const attachmentId = getAttachmentId(notePath);
        if (showsNoteTargets && noteId === opts?.noteId && !attachmentId) {
            showNoteTargets([
                ...(opts.headings ?? []), ...createAnchorTargets(opts.anchors ?? [], path)
            ]);
        } else if (showsNoteTargets) {
            const listing = attachmentId
                ? getAttachmentLinkTargets(noteId, attachmentId, path)
                : getLinkTargets(noteId, path);
            void listing.then(({ targets, isTocPending }) => {
                if (cancelled) return;
                showNoteTargets(targets);
                setIsTocPending(isTocPending);
            });
        }

        return () => { cancelled = true; };
    }, [ notePath, showsNoteTargets, opts ]);

    // The balloon unmounts the form as it closes.
    useEffect(() => () => {
        generationRef.current++;
    }, []);

    /** Lists `targets` on the note page, with the targets above the linked one expanded. */
    function showNoteTargets(targets: LinkTarget[]) {
        setNoteTargets(targets);
        const linkedTarget = getPartTarget(targets, notePart);
        setExpandedNoteTargets(new Set(linkedTarget
            ? getParentTargets(nestTargets(targets), linkedTarget)
            : []));
    }

    // The target that the link on the note page points at, if it points at one in the list.
    const noteTarget = getPartTarget(noteTargets ?? [], notePart);
    // The target whose title a link without a text of its own mirrors.
    const mirroredTarget = noteTarget && LINK_TARGET_KINDS[noteTarget.kind].isTitleMirrored
        ? noteTarget : null;
    const needsReference = target === "note" && !!noteTarget?.createReference
        && !noteTarget.params;

    /**
     * Gives the target picked on the note page a reference on the server. Returns whether the link
     * can be applied, which it cannot after the server failed, or once the form was reset or closed
     * meanwhile.
     */
    async function createReference() {
        const generation = generationRef.current;
        setIsCreatingReference(true);
        try {
            await noteTarget?.createReference?.();
            return generation === generationRef.current;
        } catch (e) {
            if (generation !== generationRef.current) {
                return false;
            }
            if (e instanceof StaleListingError) {
                // The note changed since the listing: it is listed again for a new pick.
                toast.showError(t("add_link.listing_changed"));
                const noteId = tree.getNoteIdFromUrl(notePath);
                /* v8 ignore else -- only a listing for this note path gives a target a reference */
                if (notePath && noteId) {
                    const { path } = splitTargetParameters(notePath);
                    const { targets } = await getLinkTargets(noteId, path);
                    if (generation === generationRef.current) {
                        showNoteTargets(targets);
                    }
                }
                return false;
            }
            console.error("Failed to create a reference to the target:", e);
            toast.showError(t("add_link.heading_reference_failed"));
            return false;
        } finally {
            setIsCreatingReference(false);
        }
    }

    // Runs one render after `onShown`, so `fillAndFocus()` reads the state set from `opts`.
    useEffect(() => {
        if (!isShowPending) return;
        setIsShowPending(false);
        void fillAndFocus();
    }, [ isShowPending ]);

    async function fillAndFocus() {
        // The lists scroll as they mount, which is before the modal has a size.
        const list = target === "anchor" ? linkTargetsRef.current : noteTargetsRef.current;
        scrollToCheckedChoice(list);

        if (target === "url" || target === "anchor" || isAttachmentLink) {
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
        // a value the field is given behind its back is one it does not know it holds, so it is
        // wiped the moment the field is left.
        const text = (currentNoteId ? await tree.getNoteTitle(currentNoteId) : opts?.currentLink?.externalLink)
            || opts?.text;

        if (text) {
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

    const linkTitle = linkTitles[target];
    const webLinkUrl = normalizeWebLink(webLink) ?? undefined;
    // The web link page offers the display, except on a selection: a preview would replace the
    // selected text.
    const showsDisplay = !!opts?.addLinkPreview && !opts.hasSelection && !isMedia;
    const shownDisplay = isMedia ? "embedLink" : getShownDisplay(display, webLinkUrl);
    const isPreview = isMedia || (showsDisplay && shownDisplay !== "textLink");
    const showsTitle = !opts?.hasSelection && !opts?.targetOnly && !opts?.fixLink;
    // Only a card shows a description.
    const showsDescription = showsTitle && showsDisplay && shownDisplay === "cardLink";

    // The fields shown blank that take their value from the web page, as the options allow.
    const retrievesTitle = showsTitle && !linkTitles.url.trim() && options.is(isPreview
        ? "textNoteLinkDetailsRetrievalEnabled" : "textNoteLinkTitleRetrievalEnabled");
    const retrievesDescription = showsDescription && !linkDescription.trim()
        && options.is("textNoteLinkDetailsRetrievalEnabled");
    const isRetrieving = !!webLinkUrl && webLinkUrl === retrievingUrl;
    const webLinkError = webLinkUrl ? getWebLinkError(webLinkUrl, isMedia) : undefined;

    /** Shows the errors of the fields from now on, and returns whether the link can be applied. */
    function validate() {
        setShowsErrors(true);
        if (target === "url" && webLinkError) {
            webLinkRef.current?.focus();
            return false;
        }
        return true;
    }

    // Runs one render after a request, so `retrievePageDetails()` reads the address pasted or the
    // display picked.
    useEffect(() => {
        if (!isRetrievalPending) return;
        setIsRetrievalPending(false);
        retrievePageDetails();
    }, [ isRetrievalPending ]);

    /** Fills the blank fields that take their value from the web page, reading each page once. */
    function retrievePageDetails() {
        const url = webLinkUrl;
        if (!url || !isHttpUrl(url) || (!retrievesTitle && !retrievesDescription)) return;

        let details = pageDetailsRef.current.get(url);
        if (!details) {
            details = fetchPageDetails(url);
            pageDetailsRef.current.set(url, details);
        }

        setRetrievingUrl(url);
        void details.then((result) => {
            setRetrievingUrl((current) => current === url ? null : current);
            fillPageDetailsRef.current?.(url, result);
        });
    }

    // Holds the latest render's `fillPageDetails()`, so a page that loads later fills the fields as
    // they are by then.
    const fillPageDetailsRef = useRef<typeof fillPageDetails | undefined>(undefined);
    fillPageDetailsRef.current = fillPageDetails;

    /** Fills the fields from the `details` of the page at `url`, while it is the address shown. */
    function fillPageDetails(url: string, details: PageDetails | null) {
        if (url !== webLinkUrl || !details) return;

        if (retrievesTitle && details.title) {
            setLinkTitle("url", details.title);
            previewTitleRef.current = details.title;
        }
        if (retrievesDescription && details.description) {
            setLinkDescription(details.description);
            previewDescriptionRef.current = details.description;
        }
    }

    /** Applies the link picked, through `opts.addLink` or `opts.addLinkPreview`. */
    function applyLink() {
        if (!opts) return;

        if (target === "anchor") {
            if (ownTarget?.kind === "anchor") {
                // A link without a text of its own reads as the anchor's name. `true` keeps the
                // href of an anchor link as it is.
                opts.addLink(ownTarget.createLinkPath(), linkTitle.trim() || ownTarget.title, true);
            } else if (ownTarget) {
                // `null` makes a reference link, which shows the current text of the heading.
                const title = opts.hasSelection
                    ? opts.text || ownTarget.title
                    : linkTitle.trim() || null;
                opts.addLink(ownTarget.createLinkPath(), title);
            }
            return;
        }

        if (target === "note") {
            if (!suggestion?.notePath) return;
            // `null` makes a reference link, which shows the current title of the note or the
            // title of a mirrored target. A selection keeps its own text, but `addLink()` needs a
            // title to link it rather than replace it.
            const title = opts.hasSelection
                ? opts.text || mirroredTarget?.title || noteTitle
                : linkTitle.trim() || null;
            opts.addLink(getNoteLinkPath(suggestion.notePath, notePart), title);
            return;
        }

        if (!webLinkUrl) return;
        const text = linkTitle.trim();
        if (isPreview && opts.addLinkPreview) {
            // A text that only repeats the address leaves the page's own title.
            const title = text && text !== webLinkUrl ? text : null;
            const description = showsDescription ? linkDescription.trim() || null : null;
            void opts.addLinkPreview(webLinkUrl, shownDisplay, title, description);
            return;
        }
        // An external link without a text of its own reads as its address.
        opts.addLink(webLinkUrl, text || webLinkUrl, true);
    }

    function reset() {
        generationRef.current++;
        setSuggestion(null);
        setNotePart(null);
        setExpandedNoteTargets(new Set());
        setNoteTitle("");
    }

    const autocompleteRef = useRef<HTMLInputElement>(null);
    const handleRef = useRef<NoteAutocompleteHandle>(null);
    const isEditing = !!opts?.currentLink || !!opts?.currentAnchor || !!opts?.currentHeading;
    const title = opts?.fixLink ? t("add_link.fix_link")
        : isEditing ? t("add_link.edit_link") : t("add_link.add_link");
    const buttonText = opts?.fixLink ? t("add_link.button_fix_link")
        : isEditing ? t("add_link.button_edit_link") : t("add_link.button_add_link");

    /** The text the link reads as while the title field is empty. */
    function getTitlePlaceholder() {
        if (target === "anchor") {
            if (!ownTarget) return undefined;
            return ownTarget.kind === "anchor" ? ownTarget.title : t("add_link.title_from_heading");
        }
        if (isAttachmentLink) return t("add_link.title_from_attachment");
        if (target === "note") {
            return mirroredTarget
                ? t("add_link.title_from_heading")
                : t("add_link.title_from_note");
        }
        return isPreview ? t("add_link.page_title") : webLinkUrl ?? t("add_link.title_from_url");
    }

    const titleSection = (
        <OptionCardSection
            className="edit-link-text" name="link-title" label={t("add_link.link_title")}
        >
            <RetrievedTextBox
                inputRef={titleRef}
                currentValue={linkTitle}
                placeholder={getTitlePlaceholder()}
                onChange={(title) => setLinkTitle(target, title)}
                isRetrieving={target === "url" && isRetrieving && retrievesTitle}
            />
        </OptionCardSection>
    );

    const pages: SegmentedChoiceOption<LinkPage>[] = [
        { value: "url", label: t("add_link.web_link"), icon: "bx-globe" },
        { value: "note", label: t("add_link.note"), iconSvg: internalLinkIcon }
    ];
    if (opts?.anchors || opts?.headings) {
        pages.push({ value: "anchor", label: t("add_link.anchors"), icon: "bx-bookmark" });
    }
    const switcher = !opts?.fixLink && !isAttachmentLink && !isMedia && (
        <SegmentedChoice<LinkPage>
            className="edit-link-target"
            options={pages}
            currentValue={target}
            onChange={setTarget}
        />
    );

    const anchorPage = ownTargets.length > 0 ? (<>
        {showsTitle && <Card>{titleSection}</Card>}

        <LinkTargetList
            listRef={linkTargetsRef}
            className="edit-link-targets"
            targetTree={ownTree}
            checkedTarget={ownTarget}
            onCheckTarget={setOwnTarget}
            expandedTargets={expandedOwnTargets}
            setExpandedTargets={setExpandedOwnTargets}
            getKindTitle={getOwnKindTitle}
        />
    </>) : (
        <NoItems icon="bx bx-bookmark" text={t("add_link.no_headings_or_anchors")} />
    );

    /**
     * Where in the note picked on the note page the link can point: a placeholder until a note is
     * picked, a spinner while its targets load, then the whole note and its targets.
     */
    function renderNoteTargets() {
        if (!notePath) {
            return (
                <div className="edit-link-targets edit-link-note-targets">
                    <NoItems icon="bx bx-bookmark" text={t("add_link.select_note_for_targets")} />
                </div>
            );
        }

        if (!noteTargets) {
            return (
                <div className="edit-link-targets edit-link-note-targets" role="status">
                    <NoItems icon="bx bx-loader bx-spin" text={t("add_link.inspecting_note")} />
                </div>
            );
        }

        return (
            <LinkTargetList
                listRef={noteTargetsRef}
                className="edit-link-targets edit-link-note-targets"
                targetTree={noteTree}
                checkedTarget={noteTarget}
                isWholeNoteChecked={notePart === null}
                onCheckTarget={(item) => setNotePart({ target: item })}
                onCheckWholeNote={() => setNotePart(null)}
                expandedTargets={expandedNoteTargets}
                setExpandedTargets={setExpandedNoteTargets}
                placeholder={
                    <NoItems icon="bx bx-bookmark" text={getNoTargetsText(isTocPending)} />
                }
            />
        );
    }
    const displays = [
        { value: "textLink", title: t("add_link.display_plain") },
        { value: "iconAndTextLink", title: t("add_link.display_inline") },
        { value: "cardLink", title: t("add_link.display_card") },
        ...(hasPlayer(webLinkUrl)
            ? [ { value: "embedLink", title: t("add_link.display_embed") } ]
            : [])
    ];

    return {
        title,
        buttonText,
        /** Whether the side shown has a link to apply: an address, a note, a heading or an anchor. */
        hasLink: target === "url" ? !!webLinkUrl
            : target === "note" ? !!suggestion?.notePath
            : !!ownTarget,
        /** Fills and focuses the fields, once the form is on screen. */
        onShown: () => setIsShowPending(true),
        validate,
        /** Whether `createReference()` gives the target picked a reference before `applyLink()`. */
        needsReference,
        createReference,
        /** Makes a `createReference()` still waiting on the server apply no link. */
        cancelReference: () => {
            generationRef.current++;
        },
        isCreatingReference,
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
                            error={showsErrors ? webLinkError : undefined}
                        >
                            <FormTextBoxWithPaste
                                inputRef={webLinkRef}
                                inputMode="url"
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellcheck={false}
                                placeholder="https://"
                                currentValue={webLink}
                                onChange={changeWebLink}
                                onBlur={() => setIsRetrievalPending(true)}
                                onPasted={() => setIsRetrievalPending(true)}
                            />
                        </OptionCardSection>

                        {showsTitle && titleSection}

                        {showsDescription && (
                            <OptionCardSection
                                className="edit-link-description" name="link-description"
                                label={t("add_link.description")}
                            >
                                <RetrievedTextArea
                                    rows={2}
                                    currentValue={linkDescription}
                                    placeholder={t("add_link.page_description")}
                                    onChange={setLinkDescription}
                                    isRetrieving={isRetrieving && retrievesDescription}
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
                                    disabled={!canPreview(webLinkUrl)}
                                    onChange={(next) => {
                                        setDisplay(next as LinkDisplayMode);
                                        setIsRetrievalPending(true);
                                    }}
                                />
                            </OptionCardSection>
                        )}
                    </>
                ) : (
                    <>
                        {!isAttachmentLink && (
                            <OptionCardSection
                                className="edit-link-note" name="note" label={t("add_link.note")}
                            >
                                <NoteAutocomplete
                                    inputRef={autocompleteRef}
                                    handleRef={handleRef}
                                    isListAsWideAsField
                                    // A URL picked from the search belongs on the web link side.
                                    onChange={(picked) => {
                                        if (picked?.externalLink) {
                                            moveToWebLink(picked.externalLink);
                                            return;
                                        }
                                        // Another note drops the text, so the link mirrors its
                                        // title, and points at its top.
                                        if (picked?.notePath !== suggestion?.notePath) {
                                            setLinkTitle("note", "");
                                            setNotePart(null);
                                        }
                                        setSuggestion(picked);
                                    }}
                                    opts={{
                                        allowExternalLinks: !opts?.fixLink,
                                        allowCreatingNotes: true
                                    }}
                                />
                            </OptionCardSection>
                        )}

                        {showsTitle && titleSection}
                    </>
                )}
            </Card>

            {target === "note" && showsNoteTargets && renderNoteTargets()}
        </>)
    };
}

/**
 * A text box of the dialog, with a spinner at its end while its value is retrieved from the web
 * page. The input group stays without the spinner, so the field keeps its focus when it goes.
 */
function RetrievedTextBox({ isRetrieving, ...props }: FormTextBoxProps & {
    isRetrieving: boolean;
}) {
    return (
        <div className="input-group">
            <FormTextBox {...props} />
            {isRetrieving && <InputGroupSpinner label={t("add_link.retrieving_from_page")} />}
        </div>
    );
}

/** A text area of the dialog, as {@link RetrievedTextBox}. */
function RetrievedTextArea({ isRetrieving, ...props }: ComponentProps<typeof FormTextArea> & {
    isRetrieving: boolean;
}) {
    return (
        <div className="input-group">
            <FormTextArea {...props} />
            {isRetrieving && <InputGroupSpinner label={t("add_link.retrieving_from_page")} />}
        </div>
    );
}

/**
 * The page the dialog opens on: Heading / anchor for an edited link to a heading or an anchor,
 * Web page when there is an `initialWebLink`, Heading / anchor for a new link that asks for it,
 * and Note otherwise.
 */
function getInitialTarget(
    opts: EditLinkOpts | undefined, initialWebLink: string | null
): LinkPage {
    if (opts?.currentAnchor || opts?.currentHeading) return "anchor";
    if (initialWebLink !== null) return "url";
    return opts?.target === "anchor" && !opts.currentLink ? "anchor" : "note";
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

/** Where in its note the link being edited points, which the note page opens on. */
function getInitialNotePart(opts: EditLinkOpts | undefined): NotePart {
    const notePath = opts?.currentLink?.notePath;
    const params = notePath ? splitTargetParameters(notePath).params : {};
    if (opts?.currentBookmark) {
        params.bookmark = opts.currentBookmark;
    }
    return Object.keys(params).length > 0 ? { params } : null;
}

/** The target of `targets` that `part` points at, if it points at one. */
function getPartTarget(targets: LinkTarget[], part: NotePart) {
    if (!part) return null;
    return "target" in part ? part.target : findTarget(targets, part.params) ?? null;
}

/** The path of a link to `part` of the note at `notePath`. */
function getNoteLinkPath(notePath: string, part: NotePart) {
    const { path } = splitTargetParameters(notePath);
    if (!part) return path;
    return "target" in part ? part.target.createLinkPath() : addParameters(path, part.params);
}

/** The anchors `names` of the document that the link goes into, which link as `#name`. */
function createOwnAnchors(names: string[]): LinkTarget[] {
    return names.map((name) => ({
        kind: "anchor",
        title: name,
        params: { bookmark: name },
        createLinkPath: () => `#${name}`
    }));
}

/** The heading of the card of each kind on the Heading / anchor page. */
function getOwnKindTitle(kind: ReferenceKind) {
    return kind === "heading" ? t("add_link.headings") : t("add_link.target_anchor");
}

/**
 * How the web link to `url` is displayed when `display` is picked: as a text link when the address
 * is not a web page, and as a card in place of a player that the address does not have.
 *
 * Exported for testing.
 */
export function getShownDisplay(display: LinkDisplayMode, url: string | undefined): LinkDisplayMode {
    if (!canPreview(url)) return "textLink";
    return display === "embedLink" && !hasPlayer(url) ? "cardLink" : display;
}

/** Whether a web link to `url` can be a preview: a web page, or no address typed yet. */
function canPreview(url: string | undefined) {
    return !url || isHttpUrl(url);
}

/** Whether `url` has a player to embed: a YouTube video, or a video or audio file. */
function hasPlayer(url: string | undefined) {
    return !!url && detectEmbedType(url) !== "opengraph";
}

/** Whether `notePath` links to an attachment of the note, through its `attachmentId` parameter. */
function isAttachmentPath(notePath: string | undefined) {
    return !!getAttachmentId(notePath);
}

/** The attachment that the link at `notePath` names, if it names one. */
function getAttachmentId(notePath: string | undefined) {
    const query = notePath?.split("?", 2)[1];
    return query ? new URLSearchParams(query).get("attachmentId") : null;
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

/**
 * Why the web link `link` cannot be applied: it is a `javascript:`, `vbscript:` or `data:` link,
 * which can run code, `new URL()` cannot parse it, or it is no web address for `isMedia`.
 * `undefined` for a link that can be applied.
 *
 * Exported for testing.
 */
export function getWebLinkError(link: string, isMedia = false): string | undefined {
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return t("add_link.invalid_url");
    }
    const runsCode = [ "javascript:", "vbscript:", "data:" ].includes(url.protocol);
    if (runsCode) {
        return t("add_link.script_link_not_allowed", { scheme: url.protocol });
    }
    return isMedia && !isHttpUrl(link) ? t("youtube_video.not_a_video") : undefined;
}
