import optionsService from "../../services/options.js";
import server from "../../services/server.js";
import toastService from "../../services/toast.js";

const TPL = `
<div>
    <h4>Spell check</h4>

    <p>These options apply only for desktop builds, browsers will use their own native spell check.</p>

    <div class="custom-control custom-checkbox">
        <input type="checkbox" class="custom-control-input" id="spell-check-enabled">
        <label class="custom-control-label" for="spell-check-enabled">Enable spellcheck</label>
    </div>

    <br/>

    <div class="form-group">
        <label for="spell-check-language-code">Language code</label>
        <input type="text" class="form-control" id="spell-check-language-code" placeholder="for example &quot;en-US&quot;, &quot;de-AT&quot;">
    </div>

    <p>Changes to the spell check options will take effect after application restart.</p>
</div>

<div>
    <h4>Image compression</h4>

    <div class="form-group">
        <label for="image-max-width-height">Max width / height of an image in pixels (image will be resized if it exceeds this setting).</label>
        <input class="form-control" id="image-max-width-height" type="number">
    </div>

    <div class="form-group">
        <label for="image-jpeg-quality">JPEG quality (0 - worst quality, 100 best quality, 50 - 85 is recommended)</label>
        <input class="form-control" id="image-jpeg-quality" min="0" max="100" type="number">
    </div>
</div>

<div>
    <h4>Protected session timeout</h4>

    <p>Protected session timeout is a time period after which the protected session is wiped out from
        browser's memory. This is measured from the last interaction with protected notes. See <a href="https://github.com/zadam/trilium/wiki/Protected-notes" class="external">wiki</a> for more info.</p>

    <div class="form-group">
        <label for="protected-session-timeout-in-seconds">Protected session timeout (in seconds)</label>
        <input class="form-control" id="protected-session-timeout-in-seconds" type="number">
    </div>
</div>

<div>
    <h4>Note revisions snapshot interval</h4>

    <p>Note revision snapshot time interval is time in seconds after which new note revision will be created for the note. See <a href="https://github.com/zadam/trilium/wiki/Note-revisions" class="external">wiki</a> for more info.</p>

    <div class="form-group">
        <label for="note-revision-snapshot-time-interval-in-seconds">Note revision snapshot time interval (in seconds)</label>
        <input class="form-control" id="note-revision-snapshot-time-interval-in-seconds" type="number">
    </div>
</div>`;

export default class ProtectedSessionOptions {
    constructor() {
        $("#options-other").html(TPL);

        this.$spellCheckEnabled = $("#spell-check-enabled");
        this.$spellCheckLanguageCode = $("#spell-check-language-code");

        this.$spellCheckEnabled.on('change', () => {
            const opts = { 'spellCheckEnabled': this.$spellCheckEnabled.is(":checked") ? "true" : "false" };
            server.put('options', opts).then(() => toastService.showMessage("Options change have been saved."));

            return false;
        });

        this.$spellCheckLanguageCode.on('change', () => {
            const opts = { 'spellCheckLanguageCode': this.$spellCheckLanguageCode.val() };
            server.put('options', opts).then(() => toastService.showMessage("Options change have been saved."));

            return false;
        });

        this.$protectedSessionTimeout = $("#protected-session-timeout-in-seconds");

        this.$protectedSessionTimeout.on('change', () => {
            const protectedSessionTimeout = this.$protectedSessionTimeout.val();

            server.put('options', { 'protectedSessionTimeout': protectedSessionTimeout }).then(() => {
                optionsService.reloadOptions();

                toastService.showMessage("Options change have been saved.");
            });

            return false;
        });

        this.$noteRevisionsTimeInterval = $("#note-revision-snapshot-time-interval-in-seconds");

        this.$noteRevisionsTimeInterval.on('change', () => {
            const opts = { 'noteRevisionSnapshotTimeInterval': this.$noteRevisionsTimeInterval.val() };
            server.put('options', opts).then(() => toastService.showMessage("Options change have been saved."));

            return false;
        });

        this.$imageMaxWidthHeight = $("#image-max-width-height");
        this.$imageJpegQuality = $("#image-jpeg-quality");

        this.$imageMaxWidthHeight.on('change', () => {
            const opts = { 'imageMaxWidthHeight': this.$imageMaxWidthHeight.val() };
            server.put('options', opts).then(() => toastService.showMessage("Options change have been saved."));

            return false;
        });

        this.$imageJpegQuality.on('change', () => {
            const opts = { 'imageJpegQuality': this.$imageJpegQuality.val() };
            server.put('options', opts).then(() => toastService.showMessage("Options change have been saved."));

            return false;
        });
    }

    optionsLoaded(options) {
        this.$spellCheckEnabled.prop("checked", options['spellCheckEnabled'] === 'true');
        this.$spellCheckLanguageCode.val(options['spellCheckLanguageCode']);

        this.$protectedSessionTimeout.val(options['protectedSessionTimeout']);
        this.$noteRevisionsTimeInterval.val(options['noteRevisionSnapshotTimeInterval']);

        this.$imageMaxWidthHeight.val(options['imageMaxWidthHeight']);
        this.$imageJpegQuality.val(options['imageJpegQuality']);
    }
}
