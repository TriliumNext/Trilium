import { NOTIFICATION_SOUND_MAX_BYTES } from "@triliumnext/commons/src/lib/notifications.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca.js";
import {
    defaultSoundUrl, getAlertSoundUrl, resetCustomSound, uploadCustomSound
} from "./notification_sound.js";
import { NotificationRequestError, SILENT_REFUSALS } from "./notifications.js";
import server from "./server.js";

const upload = vi.fn<typeof server.upload>();

beforeEach(() => {
    // The shared mock of `server` has no upload.
    server.upload = upload;
});

afterEach(() => {
    upload.mockReset();
    vi.restoreAllMocks();
});

describe("getAlertSoundUrl", () => {
    it("names the custom sound by its blob, and the default one while none is set", async () => {
        buildNote({ id: "_resources", title: "Resources" });
        expect(await getAlertSoundUrl()).toBe(defaultSoundUrl);

        const resources = withSound("ID3");
        const blob = await resources.getChildNotes().then(([ sound ]) => sound.getBlob());
        expect(await getAlertSoundUrl()).toBe(`api/notifications/sound?v=${blob?.blobId}`);

        // A reset empties the note.
        withSound("");
        expect(await getAlertSoundUrl()).toBe(defaultSoundUrl);
    });
});

describe("uploadCustomSound", () => {
    it("sends the file, and turns a refusal into its code", async () => {
        const file = new File([ "ID3" ], "chime.mp3", { type: "audio/mpeg" });
        await uploadCustomSound(file);
        expect(upload).toHaveBeenCalledWith("notifications/sound", file, undefined, "POST");

        upload.mockRejectedValueOnce(
            { status: 400, responseText: JSON.stringify({ code: "unsupported-format" }) });
        await expect(uploadCustomSound(file)).rejects.toMatchObject({ code: "unsupported-format" });
        upload.mockRejectedValueOnce({ status: 0, responseText: "" });
        await expect(uploadCustomSound(file)).rejects.toMatchObject({ code: "internal" });
    });

    it("refuses a file over the limit before its upload", async () => {
        const file = new File([ new Uint8Array(NOTIFICATION_SOUND_MAX_BYTES + 1) ], "long.mp3");
        const refusal = uploadCustomSound(file);

        await expect(refusal).rejects.toBeInstanceOf(NotificationRequestError);
        await expect(refusal).rejects.toMatchObject({ code: "too-large" });
        expect(upload).not.toHaveBeenCalled();
    });
});

describe("resetCustomSound", () => {
    it("asks the server without its error toast, and turns a refusal into its code", async () => {
        const remove = vi.spyOn(server, "remove").mockResolvedValue(undefined);
        await resetCustomSound();
        expect(remove).toHaveBeenCalledWith("notifications/sound", undefined, undefined,
            SILENT_REFUSALS);

        remove.mockRejectedValueOnce("{\"code\":\"not-initialized\"}");
        await expect(resetCustomSound()).rejects.toMatchObject({ code: "not-initialized" });
    });
});

/** Puts `_resources` in froca with the custom sound, whose note holds `content`. */
function withSound(content: string) {
    return buildNote({ id: "_resources", title: "Resources", children: [ {
        id: "_notificationSound", title: "Sound", type: "file", mime: "audio/mpeg", content
    } ] });
}
