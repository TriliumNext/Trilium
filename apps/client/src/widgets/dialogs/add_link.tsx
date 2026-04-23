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

export interface AddLinkOpts {
    text: string;
    hasSelection: boolean;
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
                froca.getNote(noteId).then((note) => {
                    if (cancelled) return;
                    const bkms = note?.getLabels("internalBookmark").map((l) => l.value) ?? [];
                    setBookmarks(bkms);
                    setSelectedBookmark("");
                });
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

    function onShown() {
        const $autocompleteEl = refToJQuerySelector(autocompleteRef);
        if (!opts?.text) {
            note_autocomplete.showRecentNotes($autocompleteEl);
        } else {
            note_autocomplete.setText($autocompleteEl, opts.text);
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
            title={t("add_link.add_link")}
            helpPageId="QEAPj01N5f7w"
            footer={<Button text={t("add_link.button_add_link")} keyboardShortcut="Enter" />}
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

            {bookmarks.length > 0 && (
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

            {!opts?.hasSelection && (
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
