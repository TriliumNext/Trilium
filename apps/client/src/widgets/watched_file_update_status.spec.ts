import { describe, expect, it, vi } from "vitest";

import fileWatcher from "../services/file_watcher.js";
import server from "../services/server.js";
import WatchedFileUpdateStatusWidget from "./watched_file_update_status.js";

describe("WatchedFileUpdateStatusWidget", () => {
    it("uploads the file recorded by the watcher, whatever the message renders", async () => {
        vi.spyOn(fileWatcher, "getFileModificationStatus").mockReturnValue({
            entityType: "notes",
            entityId: "n1",
            lastModifiedMs: 0,
            filePath: "/tmp/tmp-1-abc-New note.html"
        });
        const uploaded = vi.spyOn(fileWatcher, "fileModificationUploaded");
        const post = vi.spyOn(server, "post").mockResolvedValue(undefined);

        const widget = new WatchedFileUpdateStatusWidget();
        vi.spyOn(widget, "getEntity").mockReturnValue({ entityType: "notes", entityId: "n1" });
        vi.spyOn(widget, "refresh").mockResolvedValue();
        widget.render();
        widget.$widget.find(".file-path").remove();

        const button = widget.$widget.find(".file-upload-button");
        expect(button).toHaveLength(1);
        button.trigger("click");

        await vi.waitFor(() => expect(uploaded).toHaveBeenCalledWith("notes", "n1"));
        expect(post).toHaveBeenCalledWith("notes/n1/upload-modified-file", {
            filePath: "/tmp/tmp-1-abc-New note.html"
        });
    });
});
