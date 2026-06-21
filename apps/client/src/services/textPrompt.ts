/**
 * Non-blocking alternative to `window.prompt()` that renders a small dialog
 * using Trilium's Bootstrap classes, matching the application's design.
 *
 * Resolves with the entered string on confirm, or `null` on cancel / Escape.
 */
export function textPrompt(label: string, defaultValue = ""): Promise<string | null> {
    return new Promise((resolve) => {
        const $backdrop = $('<div class="modal-backdrop fade show">').appendTo("body");

        const $modal = $(`
            <div class="modal show" tabindex="-1" style="display:block">
                <div class="modal-dialog modal-sm modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-body" style="padding:16px 16px 8px">
                            <label style="display:block;margin-bottom:8px;font-weight:500"></label>
                            <input type="text" class="form-control">
                        </div>
                        <div class="modal-footer" style="padding:8px 16px 12px">
                            <button class="btn btn-primary btn-sm">OK</button>
                            <button class="btn btn-secondary btn-sm">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        `).appendTo("body");

        // Set text safely (no XSS)
        $modal.find("label").text(label);
        $modal.find("input").val(defaultValue);

        function done(value: string | null) {
            $modal.remove();
            $backdrop.remove();
            $(document).off("keydown.textPrompt");
            resolve(value);
        }

        $modal.find(".btn-primary").on("click", () => done($modal.find("input").val() as string));
        $modal.find(".btn-secondary").on("click", () => done(null));

        // Close on backdrop click
        $modal.on("click", (e) => { if ($(e.target).is($modal)) done(null); });

        $(document).on("keydown.textPrompt", (e) => {
            if (e.key === "Enter")  done($modal.find("input").val() as string);
            if (e.key === "Escape") done(null);
        });

        setTimeout(() => ($modal.find("input")[0] as HTMLInputElement | undefined)?.select(), 50);
    });
}
