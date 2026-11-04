import "./youtube_video.css";

import { extractYouTubeVideoId, isHttpUrl } from "@triliumnext/commons";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import toast from "../../services/toast";
import Button from "../react/Button";
import { Card, OptionCardSection } from "../react/Card";
import { FormTextBoxWithPaste } from "../react/FormTextBox";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import { suspendModalFocusTraps } from "../react/modal_focustrap";

export interface YouTubeVideoOpts {
    /**
     * Inserts a player of the YouTube video at `url` once it is ready, unless the editor holds
     * other content by then, and rejects when it cannot be loaded.
     */
    onInsert(url: string): Promise<void>;
}

/**
 * Asks for the address of a YouTube video in a modal, on the `showYouTubeVideoDialog` event. The
 * text editor uses it on mobile, where it has no room for its balloon. The modal closes once the
 * video is inserted.
 */
export default function YouTubeVideoDialog() {
    const [ opts, setOpts ] = useState<YouTubeVideoOpts>();
    const [ isShown, setIsShown ] = useState(false);
    const form = useYouTubeVideoForm();
    const { isInserting, insert } = useVideoInsertion();

    useTriliumEvent("showYouTubeVideoDialog", (newOpts) => {
        setOpts(newOpts);
        form.reset();
        setIsShown(true);
    });

    return (
        <Modal
            className="youtube-video-dialog"
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
 * closes once the video is inserted.
 */
export function YouTubeVideoBalloon({ onInsert }: YouTubeVideoOpts) {
    // Lets the field take focus inside a modal, such as the quick edit popup.
    useEffect(() => suspendModalFocusTraps(), []);
    const form = useYouTubeVideoForm();
    const { isInserting, insert } = useVideoInsertion();

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
            <div className="youtube-video-actions">
                <InsertButton isEnabled={!!form.url && !isInserting} />
            </div>
        </form>
    );
}

/**
 * Inserts a video through `onInsert`, with `isInserting` set until it settles, and shows an error
 * toast when it fails. `insert()` resolves to whether the video was inserted.
 */
function useVideoInsertion() {
    const [ isInserting, setIsInserting ] = useState(false);

    async function insert(onInsert: YouTubeVideoOpts["onInsert"], url: string) {
        setIsInserting(true);
        try {
            await onInsert(url);
            return true;
        } catch (e) {
            console.error("Failed to insert the YouTube video:", e);
            toast.showError(t("youtube_video.insert_failed"));
            return false;
        } finally {
            setIsInserting(false);
        }
    }

    return { isInserting, insert };
}

/** The button that submits the form, enabled once the field holds the address of a video. */
function InsertButton({ isEnabled }: { isEnabled: boolean }) {
    return (
        <Button
            text={t("youtube_video.button_insert")}
            keyboardShortcut="Enter"
            disabled={!isEnabled}
        />
    );
}

/** The URL field, shared by the modal and the balloon, and the address of the video typed in it. */
function useYouTubeVideoForm() {
    const [ text, setText ] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const url = getYouTubeVideoUrl(text);

    return {
        inputRef,
        /** The address of the video, or `null` while the field holds none. */
        url,
        reset: () => setText(""),
        body: (
            <Card>
                <OptionCardSection
                    className="youtube-video-url"
                    name="youtube-video-url"
                    label={t("add_link.url")}
                    error={text.trim() && !url ? t("youtube_video.not_a_video") : undefined}
                >
                    <FormTextBoxWithPaste
                        inputRef={inputRef}
                        inputMode="url"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellcheck={false}
                        placeholder="https://www.youtube.com/watch?v="
                        currentValue={text}
                        onChange={setText}
                    />
                </OptionCardSection>
            </Card>
        )
    };
}

/**
 * The address of the YouTube video typed as `text`, with `https://` added when it names no scheme,
 * or `null` when it is not one.
 *
 * Exported for testing.
 */
export function getYouTubeVideoUrl(text: string): string | null {
    const link = text.trim();
    const url = /^[a-z][a-z0-9+.-]*:/i.test(link) ? link : `https://${link}`;
    return isHttpUrl(url) && extractYouTubeVideoId(url) ? url : null;
}
