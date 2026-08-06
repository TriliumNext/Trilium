import { t } from "../../services/i18n";
import Modal from "../react/Modal";
import Button from "../react/Button";
import FormRadioGroup from "../react/FormRadioGroup";
import NoteAutocomplete from "../react/NoteAutocomplete";
import { useRef, useState, useEffect } from "preact/hooks";
import tree from "../../services/tree";
import froca from "../../services/froca";
import note_autocomplete, { Suggestion } from "../../services/note_autocomplete";
import { logError } from "../../services/ws";
import FormGroup from "../react/FormGroup.js";
import { refToJQuerySelector } from "../react/react_utils";
import { useTriliumEvent } from "../react/hooks";

type LinkType = "reference-link" | "external-link" | "hyper-link";

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
    const hasSubmittedRef = useRef(false);

    useTriliumEvent("showAddLinkDialog", opts => {
        setOpts(opts);
        setShown(true);
    });

    useEffect(() => {
        if (opts?.hasSelection) {
            setLinkType("hyper-link");
        } else {
            setLinkType("reference-link");
        }

        // Taken as though it had just been picked, so that a dialog opened on a link and left alone
        // has one to apply — and so that everything a pick settles (the title, the anchors a note
        // offers, whether it is a link outside Trilium at all) is settled for it as well.
        setSuggestion(opts?.currentLink ?? null);
    }, [ opts ]);

    async function setDefaultLinkTitle(noteId: string) {
        const title = await tree.getNoteTitle(noteId);
        setNoteTitle(title);
        setLinkTitle(title);
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
                    setSelectedBookmark("");
                })();
            }
            resetExternalLink();
        }

        if (suggestion.externalLink) {
            setLinkTitle(suggestion.externalLink);
            setLinkType("external-link");
        }

        return () => { cancelled = true; };
    }, [suggestion]);

    useEffect(() => {
        if (selectedBookmark) {
            setLinkTitle(`${noteTitle} - ${selectedBookmark}`);
        } else {
            setLinkTitle(noteTitle);
        }
    }, [selectedBookmark, noteTitle]);

    async function onShown() {
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
            note_autocomplete.showRecentNotes($autocompleteEl);
        } else {
            note_autocomplete.setText($autocompleteEl, text);

            // What `setText` fills the field with is something being typed, which has nothing picked
            // behind it; the note the dialog opens on is picked already.
            if (currentNotePath) {
                $autocompleteEl.setSelectedNotePath(currentNotePath);
            }
        }

        // to be able to quickly remove entered text
        $autocompleteEl
            .trigger("focus")
            .trigger("select");
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

    return (
        <Modal
            className="add-link-dialog"
            size="lg"
            maxWidth={1000}
            title={opts?.currentLink ? t("add_link.edit_link") : t("add_link.add_link")}
            helpPageId="QEAPj01N5f7w"
            footer={<Button text={opts?.currentLink ? t("add_link.button_edit_link") : t("add_link.button_add_link")} keyboardShortcut="Enter" />}
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
                        // Handle external link
                        opts.addLink(suggestion.externalLink, linkTitle, true);
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
            <FormGroup label={t("add_link.note")} name="note">
                <NoteAutocomplete
                    inputRef={autocompleteRef}
                    onChange={setSuggestion}
                    opts={{
                        allowExternalLinks: true,
                        allowCreatingNotes: true
                    }}
                />
            </FormGroup>

            {bookmarks.length > 0 && !opts?.targetOnly && (
                <FormGroup label={t("add_link.anchor")} name="anchor">
                    <select
                        className="form-select"
                        value={selectedBookmark}
                        onChange={(e) => setSelectedBookmark((e.target as HTMLSelectElement).value)}
                    >
                        <option value="">{t("add_link.anchor_none")}</option>
                        {bookmarks.map((bk) => (
                            <option key={bk} value={bk}>{bk}</option>
                        ))}
                    </select>
                </FormGroup>
            )}

            {!opts?.hasSelection && !opts?.targetOnly && (
                <div className="add-link-title-settings">
                    {(linkType !== "external-link") && (
                        <>
                            <FormRadioGroup
                                name="link-type"
                                currentValue={linkType}
                                values={[
                                    { value: "reference-link", label: t("add_link.link_title_mirrors") },
                                    { value: "hyper-link", label: t("add_link.link_title_arbitrary") }
                                ]}
                                onChange={(newValue) => setLinkType(newValue as LinkType)}
                            />
                        </>
                    )}

                    {(linkType !== "reference-link" && (
                        <div className="add-link-title-form-group form-group">
                            <br/>
                            <label>
                                {t("add_link.link_title")}

                                <input className="link-title form-control" style={{ width: "100%" }}
                                    value={linkTitle}
                                    onInput={e => setLinkTitle((e.target as HTMLInputElement)?.value ?? "")}
                                />
                            </label>
                        </div>
                    ))}
                </div>
            )}
        </Modal>
    );
}
