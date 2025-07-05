import NoteContextAwareWidget from "./note_context_aware_widget.js";
import options from "../services/options.js";
import attributeService from "../services/attributes.js";
import { t } from "../services/i18n.js";
import type FNote from "../entities/fnote.js";
import type { EventData } from "../components/app_context.js";

const TPL = /*html*/`
<div class="shared-info-widget alert alert-warning use-tn-links">
    <style>
        .shared-info-widget {
            margin: 10px;
            contain: none;
            padding: 10px;
            font-weight: bold;
        }
    </style>

    <span class="shared-text"></span> <a class="shared-link external"></a>. ${t("shared_info.help_link")}
</div>`;

export default class SharedInfoWidget extends NoteContextAwareWidget {

    private $sharedLink!: JQuery<HTMLElement>;
    private $sharedText!: JQuery<HTMLElement>;

    isEnabled() {
        return super.isEnabled() && this.noteId !== "_share" && this.note?.hasAncestor("_share");
    }

    doRender() {
        this.$widget = $(TPL);
        this.$sharedLink = this.$widget.find(".shared-link");
        this.$sharedText = this.$widget.find(".shared-text");
        this.contentSized();
    }

    async refreshWithNote(note: FNote) {
        const syncServerHost = options.get("syncServerHost");
        const sharePath = options.get("sharePath");
        let link;

        const shareId = this.getShareId(note);

        if (syncServerHost) {
            link = `${syncServerHost}${sharePath}/${shareId}`;
            this.$sharedText.text(t("shared_info.shared_publicly"));
        } else {
            let host = location.host;
            if (host.endsWith("/")) {
                // seems like IE has trailing slash
                // https://github.com/zadam/trilium/issues/3782
                host = host.slice(0, -1);
            }

            link = `${location.protocol}//${host}${location.pathname}${sharePath.slice(1)}/${shareId}`;
            this.$sharedText.text(t("shared_info.shared_locally"));
        }

        this.$sharedLink.attr("href", link).text(link);
    }

    getShareId(note: FNote) {
        if (note.hasOwnedLabel("shareRoot")) {
            return "";
        }

        return note.getOwnedLabelValue("shareAlias") || note.noteId;
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (loadResults.getAttributeRows().find((attr) => attr.name?.startsWith("_share") && attributeService.isAffecting(attr, this.note))) {
            this.refresh();
        } else if (loadResults.getBranchRows().find((branch) => branch.noteId === this.noteId)) {
            this.refresh();
        }
    }
}
