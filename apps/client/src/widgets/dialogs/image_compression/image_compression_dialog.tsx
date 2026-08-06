import "./image_compression_dialog.css";

import type { ImageCompressionResponse } from "@triliumnext/commons";
import { render } from "preact";
import { useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import toast from "../../../services/toast";
import Button from "../../react/Button";
import { Card } from "../../react/Card";
import { useTriliumOptionJson } from "../../react/hooks";
import Modal from "../../react/Modal";
import {
    cancelImageCompression,
    compressionResultMessage,
    IMAGE_COMPRESSION_TOAST_ID,
    type ImageCompressionTarget,
    isSingleImage,
    newCompressionTaskId,
    runImageCompression
} from "./image_compression_operation";
import {
    hasWorkToDo,
    type ImageCompressionToolOptions,
    readImageCompressionOptions
} from "./image_compression_options";
import {
    JpegHandlingSection,
    PngHandlingSection,
    ProcessChildNotesSection,
    ResizeImageSection,
    UnsupportedFormatNotice
} from "./image_compression_sections";
import {
    ImageCompressionSummary,
    readableFormats,
    useCompressionReading
} from "./image_compression_summary";

/**
 * Opens the image compression dialog for one note or one attachment, and resolves once the run it
 * asked for has finished: the report of what was compressed, or `null` if the user backed out.
 * Callers await it to know when their own figures are stale.
 *
 * Mounted on demand into a host of its own, as the cleanup dialog is: a dialog reached from a
 * context menu has no place sitting in the page that merely *could* open it.
 */
export function showImageCompressionDialog(target: ImageCompressionTarget): Promise<ImageCompressionResponse | null> {
    return new Promise((resolve) => {
        const host = document.body.appendChild(document.createElement("div"));

        render(
            <ImageCompressionDialog target={target} onFinished={(result) => {
                resolve(result);
                render(null, host);
                host.remove();
            }} />,
            host
        );
    });
}

/**
 * How the target's images are to be recompressed. Every setting is written straight back to the
 * stored option as it changes, so the next run opens where this one left off whether or not it was
 * carried through — the same bargain the cleanup tool makes.
 */
function ImageCompressionDialog({ target, onFinished }: {
    target: ImageCompressionTarget,
    onFinished: (result: ImageCompressionResponse | null) => void
}) {
    const [ shown, setShown ] = useState(true);
    const [ stored, setStored ] = useTriliumOptionJson<Partial<ImageCompressionToolOptions>>("imageCompressionToolOptions");
    const [ options, setOptions ] = useState<ImageCompressionToolOptions>(() => readImageCompressionOptions(stored));
    const update = (patch: Partial<ImageCompressionToolOptions>) => {
        const next = { ...options, ...patch };
        setOptions(next);
        void setStored(next);
    };

    // What the run was asked to do, held across the close: the operation starts once the dialog is
    // out of the way, by which time the state it was configured from is on its way out too.
    const pending = useRef<ImageCompressionToolOptions | null>(null);
    const sectionProps = { options, onChange: update };

    // Nothing is offered until the reading says there is something for it to act on: a format with
    // no images of it behind it is a setting with nothing to apply it to, and a run configured
    // entirely out of such settings would visit every image and change none of them.
    const reading = useCompressionReading(target, options);
    const formats = readableFormats(target, reading);

    // Named for what the run will actually reach. The dialog names its own action twice — once as
    // the heading, once on the button that carries it out — and both say the same thing.
    const action = isSingleImage(target) ? t("compress-image") : t("compress-images");

    async function runPendingCompression() {
        const settings = pending.current;

        if (!settings) {
            onFinished(null);
            return;
        }

        // A spinner rather than a bar: nothing here can say how far along one image is. The message
        // is replaced as the count arrives — one toast throughout, so the wording changes in place
        // rather than a second toast appearing beside the first.
        //
        // Calling it off leaves everything already compressed compressed: the run writes as it goes,
        // and starting it again skips what is done without reading it. So the button says stop, not
        // undo, and the toast stays up until the run answers with what it managed.
        const taskId = newCompressionTaskId();
        const showProgress = (message: string) => toast.showPersistent({
            id: IMAGE_COMPRESSION_TOAST_ID,
            icon: "bx bx-loader-circle bx-spin",
            message,
            dismissible: false,
            buttons: [ {
                text: t("space_usage.compress_cancel_run"),
                onClick: () => cancelImageCompression(taskId)
            } ]
        });

        showProgress(t("space_usage.compress_running"));

        let result: ImageCompressionResponse | null = null;

        try {
            result = await runImageCompression(target, settings, taskId, (done, total) => {
                // Until the run has said how many there are, the count on its own would read as a
                // total; the wording without one says only that it is working through them.
                showProgress(total === undefined
                    ? t("space_usage.compress_running")
                    : t("space_usage.compress_running_progress", { done, total }));
            });
            toast.showMessage(compressionResultMessage(result), COMPRESSION_DONE_TIMEOUT_MS);
        } catch {
            // Already reported by the request layer, and nothing here can say what the run managed
            // to change before it failed — so it is answered as no run rather than as an empty one.
        } finally {
            toast.closePersistent(IMAGE_COMPRESSION_TOAST_ID);
            onFinished(result);
        }
    }

    return (
        <Modal
            className="image-compression-dialog"
            title={action}
            size="sm"
            minWidth={COMPRESSION_DIALOG_MIN_WIDTH}
            show={shown}
            onHidden={() => void runPendingCompression()}
            footer={<>
                <Button text={t("space_usage.compress_cancel")} onClick={() => setShown(false)} />
                <Button
                    text={action}
                    kind="primary"
                    // Nothing asked of anything actually here would visit every image and change
                    // none of them: a run that provably does nothing is not one to offer. Also
                    // covers the reading still being in flight, when nothing is yet known.
                    disabled={!hasWorkToDo(options, formats)}
                    onClick={() => {
                        pending.current = options;
                        setShown(false);
                    }}
                />
            </>}
            stackable
        >
            <ImageCompressionSummary reading={reading} recursive={options.processChildNotes} />

            {/* Only what there are images for. Scaling goes with them: it acts on the same formats
                and nothing else, so with none of them present it has nothing to scale either. */}
            {formats.length > 0 && (
                <Card className="image-compression-settings">
                    <ResizeImageSection {...sectionProps} />
                    {formats.includes("jpg") && <JpegHandlingSection {...sectionProps} />}
                    {formats.includes("png") && <PngHandlingSection {...sectionProps} />}
                </Card>
            )}

            {/* Said only of one named image, whose format is the whole reason there is nothing to
                offer. For a note the reading above has already listed what it holds. */}
            {isSingleImage(target) && reading.info && formats.length === 0 && (
                <Card className="image-compression-settings">
                    <UnsupportedFormatNotice />
                </Card>
            )}

            {/* A card of its own: everything above says *how* to compress, this says how far the
                run reaches. Absent for a single image, which has no subtree to reach into. */}
            {!isSingleImage(target) && (
                <Card className="image-compression-scope">
                    <ProcessChildNotesSection {...sectionProps} />
                </Card>
            )}
        </Modal>
    );
}

/**
 * The width the dialog starts at, narrow on purpose: a few settings read top to bottom rather than
 * scanned across. A floor rather than a size — row titles never wrap, so a long translation widens
 * the dialog instead of folding onto a second line (see the sections' stylesheet).
 */
const COMPRESSION_DIALOG_MIN_WIDTH = "420px";

/**
 * Longer than the default couple of seconds: this reports on something that ran unattended and has
 * three figures worth reading, and it is the only account of a run the user will get.
 */
const COMPRESSION_DONE_TIMEOUT_MS = 15000;
