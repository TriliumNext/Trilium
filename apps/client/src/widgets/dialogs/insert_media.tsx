import "./insert_media.css";

import { isHttpUrl } from "@triliumnext/commons";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import toast from "../../services/toast";
import Button from "../react/Button";
import { Card, OptionCardSection } from "../react/Card";
import { FormTextBoxWithPaste } from "../react/FormTextBox";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import { suspendModalFocusTraps } from "../react/modal_focustrap";

export interface InsertMediaOpts {
    /**
     * Inserts a player of the media at `url` once it is ready, unless the editor holds other
     * content by then, and rejects when it cannot be loaded.
     */
    onInsert(url: string): Promise<void>;
}

/**
 * Asks for the address of a YouTube video or of an audio or video file in a modal, on the
 * `showInsertMediaDialog` event. The text editor uses it on mobile, where it has no room for its
 * balloon. The modal closes once the media is inserted.
 */
export default function InsertMediaDialog() {
    const [ opts, setOpts ] = useState<InsertMediaOpts>();
    const [ isShown, setIsShown ] = useState(false);
    const form = useInsertMediaForm();
    const { isInserting, insert } = useMediaInsertion();

    useTriliumEvent("showInsertMediaDialog", (newOpts) => {
        setOpts(newOpts);
        form.reset();
        setIsShown(true);
    });

    return (
        <Modal
            className="insert-media-dialog"
            size="lg"
            title={t("youtube_video.title")}
            footer={<InsertButton isEnabled={!!form.url && !isInserting} />}
            onSubmit={async () => {
                if (!form.url || !opts || isInserting) return;

                if (await insert(opts.onInsert, form.url)) {
                    setIsShown(false);
                }
            }}
            onHidden={() => setIsShown(false)}
            show={isShown}
        >
            {form.body}
        </Modal>
    );
}

/**
 * The form of the prompt in the balloon that the text editor places at the caret, which the editor
 * closes once the media is inserted.
 */
export function InsertMediaBalloon({ onInsert }: InsertMediaOpts) {
    // Lets the field take focus inside a modal, such as the quick edit popup.
    useEffect(() => suspendModalFocusTraps(), []);
    const form = useInsertMediaForm();
    const { isInserting, insert } = useMediaInsertion();

    useEffect(() => {
        form.inputRef.current?.focus();
    }, []);

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                if (form.url && !isInserting) void insert(onInsert, form.url);
            }}
        >
            {form.body}
            <div className="insert-media-actions">
                <InsertButton isEnabled={!!form.url && !isInserting} />
            </div>
        </form>
    );
}

/**
 * Inserts the media through `onInsert`, with `isInserting` set until it settles, and shows an error
 * toast when it fails. `insert()` resolves to whether the media was inserted.
 */
function useMediaInsertion() {
    const [ isInserting, setIsInserting ] = useState(false);

    async function insert(onInsert: InsertMediaOpts["onInsert"], url: string) {
        setIsInserting(true);
        try {
            await onInsert(url);
            return true;
        } catch (e) {
            console.error("Failed to insert the media:", e);
            toast.showError(t("youtube_video.insert_failed"));
            return false;
        } finally {
            setIsInserting(false);
        }
    }

    return { isInserting, insert };
}

/** The button that submits the form, enabled once the field holds a web address. */
function InsertButton({ isEnabled }: { isEnabled: boolean }) {
    return (
        <Button
            text={t("youtube_video.button_insert")}
            keyboardShortcut="Enter"
            disabled={!isEnabled}
        />
    );
}

/** The URL field, shared by the modal and the balloon, and the web address typed in it. */
function useInsertMediaForm() {
    const [ text, setText ] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const url = getMediaUrl(text);

    return {
        inputRef,
        /** The web address of the media, or `null` while the field holds none. */
        url,
        reset: () => setText(""),
        body: (
            <Card>
                <OptionCardSection
                    className="insert-media-url"
                    name="insert-media-url"
                    label={t("add_link.url")}
                    error={text.trim() && !url ? t("youtube_video.not_a_video") : undefined}
                >
                    <FormTextBoxWithPaste
                        inputRef={inputRef}
                        inputMode="url"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellcheck={false}
                        placeholder="https://"
                        currentValue={text}
                        onChange={setText}
                    />
                </OptionCardSection>
            </Card>
        )
    };
}

/**
 * The web address typed as `text`, with `https://` added when it names no scheme, or `null` when
 * it is not one. Whether it is media is known only once the server reads it.
 *
 * Exported for testing.
 */
export function getMediaUrl(text: string): string | null {
    const link = text.trim();
    if (!link || /\s/.test(link)) {
        return null;
    }

    const url = /^[a-z][a-z0-9+.-]*:/i.test(link) ? link : `https://${link}`;
    return isHttpUrl(url) ? url : null;
}
