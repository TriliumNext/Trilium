import type { JSX } from "preact";
import { useEffect,useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import note_autocomplete, { Suggestion } from "../../services/note_autocomplete";
import tree from "../../services/tree";
import { logError } from "../../services/ws";
import Button from "../react/Button";
import FormGroup from "../react/FormGroup.js";
import FormRadioGroup from "../react/FormRadioGroup";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import NoteAutocomplete from "../react/NoteAutocomplete";
import { refToJQuerySelector } from "../react/react_utils";

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
    const [ shown, setShown ] = useState(false);
    const hasSubmittedRef = useRef(false);
    const suggestionRef = useRef<Suggestion | null>(null);
    const submitOnSelectionRef = useRef(false);

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
        const noteTitle = await tree.getNoteTitle(noteId);
        setLinkTitle(noteTitle);
    }

    function resetExternalLink() {
        if (linkType === "external-link") {
            setLinkType("reference-link");
        }
    }

    useEffect(() => {
        if (!suggestion) {
            resetExternalLink();
            return;
        }

        if (suggestion.notePath) {
            const noteId = tree.getNoteIdFromUrl(suggestion.notePath);
            if (noteId) {
                setDefaultLinkTitle(noteId);
            }
            resetExternalLink();
        }

        if (suggestion.externalLink) {
            setLinkTitle(suggestion.externalLink);
            setLinkType("external-link");
        }
    }, [suggestion]);

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

    function submitSelectedLink(selectedSuggestion: Suggestion | null) {
        submitOnSelectionRef.current = false;
        hasSubmittedRef.current = Boolean(selectedSuggestion);

        if (!selectedSuggestion) {
            logError("No link to add.");
            return;
        }

        // Insertion logic in onHidden because it needs focus.
        setShown(false);
    }

    function onSuggestionChange(nextSuggestion: Suggestion | null) {
        suggestionRef.current = nextSuggestion;
        setSuggestion(nextSuggestion);

        if (submitOnSelectionRef.current && nextSuggestion) {
            submitSelectedLink(nextSuggestion);
        }
    }

    function onAutocompleteKeyDownCapture(e: JSX.TargetedKeyboardEvent<HTMLInputElement>) {
        if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.isComposing) {
            return;
        }

        submitOnSelectionRef.current = true;
    }

    function onAutocompleteKeyUpCapture(e: JSX.TargetedKeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter") {
            submitOnSelectionRef.current = false;
        }
    }

    function onSubmit() {
        submitSelectedLink(suggestionRef.current);
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
                submitOnSelectionRef.current = false;

                // Insert the link.
                if (hasSubmittedRef.current && suggestionRef.current && opts) {
                    hasSubmittedRef.current = false;

                    if (suggestionRef.current.notePath) {
                        // Handle note link
                        opts.addLink(suggestionRef.current.notePath, linkType === "reference-link" ? null : linkTitle);
                    } else if (suggestionRef.current.externalLink) {
                        // Handle external link
                        opts.addLink(suggestionRef.current.externalLink, linkTitle, true);
                    }
                }

                suggestionRef.current = null;
                setSuggestion(null);
                setShown(false);
            }}
            show={shown}
        >
            <FormGroup label={t("add_link.note")} name="note">
                <NoteAutocomplete
                    inputRef={autocompleteRef}
                    onChange={onSuggestionChange}
                    onKeyDownCapture={onAutocompleteKeyDownCapture}
                    onKeyUpCapture={onAutocompleteKeyUpCapture}
                    opts={{
                        allowExternalLinks: true,
                        allowCreatingNotes: true
                    }}
                />
            </FormGroup>

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
