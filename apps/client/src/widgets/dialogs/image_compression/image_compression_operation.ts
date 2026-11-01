import type { ImageCompressionResponse, WebSocketMessage } from "@triliumnext/commons";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import { formatSize, randomString } from "../../../services/utils";
import { subscribeToMessages, unsubscribeToMessage } from "../../../services/ws";
import type { ImageCompressionToolOptions } from "./image_compression_options";

/**
 * What a compression run acts on: a whole note — the images its attachments hold — or a single
 * image picked out on its own, which may be an image note or an image attachment.
 *
 * `mime` is what tells the two apart. Present, the target *is* one image of that type, and the
 * dialog can offer only the settings that could reach it; absent, the target is a note holding
 * however many images of whatever types, and every setting is in play.
 */
export type ImageCompressionTarget =
    | { type: "note"; noteId: string; mime?: string }
    | { type: "attachment"; attachmentId: string; mime: string };

/**
 * Whether the dialog is configuring one named image rather than whatever a note happens to hold.
 *
 * The mime is read only for this — as a marker that the target *is* one image. What format that
 * image actually is comes from its content, never from here: an image note Trilium saved itself
 * carries `image/jpg`, which is not a real mime type at all.
 */
export function isSingleImage(target: ImageCompressionTarget): boolean {
    return target.mime !== undefined;
}

/** Shared by every stage of a run, so the message is swapped in place rather than stacked. */
export const IMAGE_COMPRESSION_TOAST_ID = "image-compression";

/**
 * Decoding and re-encoding is measured in seconds per image, and a subtree run can hold thousands
 * of them. The default minute would not stop the server working — it would only lose the answer and
 * report a failure for something that went on to succeed.
 */
const COMPRESSION_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Compresses the target's images and reports what that did, image by image and in total.
 *
 * `onProgress` is called as the run works through them. A subtree can hold hundreds, and the request
 * itself says nothing until it is over — so the count comes back the other way, over the websocket,
 * against a task named here and quoted in the request.
 */
export function runImageCompression(
    target: ImageCompressionTarget,
    options: ImageCompressionToolOptions,
    taskId: string,
    onProgress?: (done: number, total: number | undefined) => void
): Promise<ImageCompressionResponse> {
    const url = target.type === "note"
        ? `notes/${target.noteId}/compress-images`
        : `attachments/${target.attachmentId}/compress-image`;
    const listener = onProgress && followProgress(taskId, onProgress);

    return server.postWithTimeout<ImageCompressionResponse>(url, COMPRESSION_TIMEOUT_MS, {
        taskId,
        resize: options.resize,
        maxWidthHeight: options.maxWidthHeight,
        jpegHandling: options.jpegHandling,
        pngHandling: options.pngHandling,
        quality: options.quality,
        conversionQuality: options.conversionQuality,
        // Left out entirely for an attachment, which has no subtree to descend into — the endpoint
        // does not read it, and sending it would suggest it does.
        ...(target.type === "note" ? { recursive: options.processChildNotes } : {})
    }).finally(() => {
        if (listener) {
            unsubscribeToMessage(listener);
        }
    });
}

/** Names a run, so it can be followed and called off by whoever started it. */
export function newCompressionTaskId(): string {
    return randomString(12);
}

/**
 * Calls off a run that is still going.
 *
 * Answers nothing: the images already compressed are already saved, and the run itself reports what
 * it managed as it always does — so there is no second account of it to wait for here.
 */
export function cancelImageCompression(taskId: string): void {
    void server.post(`image-compression/${taskId}/cancel`);
}

/**
 * Watches one run's progress messages, and only that run's.
 *
 * Subscribed for the length of the request rather than for the length of the session: a run is
 * started from here and is over when the request answers, so there is nothing for a listener to
 * hear before or after. The task id is checked as well as the type — two runs can be in flight from
 * two windows, and each should count its own.
 */
function followProgress(taskId: string, onProgress: (done: number, total: number | undefined) => void) {
    const listener = (message: WebSocketMessage) => {
        if (message.type === "taskProgressCount" && "taskId" in message && message.taskId === taskId) {
            onProgress(message.progressCount, message.totalCount);
        }
    };

    subscribeToMessages(listener);

    return listener;
}

/**
 * What the run is told to have done. Every image it visited is counted, skipped ones included, so
 * the count and the two sizes are all measured over the same set and read as one sentence.
 *
 * A run that saved nothing says so rather than quoting a size that did not move: "from 45 MiB to
 * 45 MiB" reads as a failure to report, where it is in fact a complete and correct answer — the
 * images were already as small as these settings can make them.
 *
 * The images a stopped run never reached are counted out of both, because they were never weighed
 * either: they are reported at zero bytes, having not been read. Counting them would claim the
 * whole tree was processed and then quote the sizes of the handful that actually were, which is
 * how "867 images processed, reducing the size from 73.72 MiB to 554.6 KiB" comes about. What the
 * run got through before it was called off is said instead, against the total it set out to visit.
 */
export function compressionResultMessage(result: ImageCompressionResponse): string {
    const total = result.items.length;
    const done = total - result.items.filter((item) => item.skipReason === "cancelled").length;
    const stopped = done < total;

    if (done === 0) {
        return t(stopped ? "space_usage.compress_result_stopped_none" : "space_usage.compress_result_none");
    }

    if (result.savedSize <= 0) {
        return stopped
            ? t("space_usage.compress_result_stopped_no_gain", { done, total })
            : t("space_usage.compress_result_no_gain", { count: done });
    }

    const before = formatSize(result.originalSize);
    const after = formatSize(result.newSize);

    return stopped
        ? t("space_usage.compress_result_stopped", { done, total, before, after })
        : t("space_usage.compress_result", { count: done, before, after });
}
