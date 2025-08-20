import OptionsWidget from "../options_widget.js";
import { t } from "../../../../services/i18n.js";
import type { OptionMap } from "@triliumnext/commons";
import searchService from "../../../../services/search.js";
import { normalizeSharePathInput } from "./share_path_utils.js";

const TPL = /*html*/`
<div class="options-section">
    <h4>${t("share.title")}</h4>

    <div class="form-group">
        <label class="tn-checkbox">
            <input class="form-check-input redirect-bare-domain" type="checkbox" name="redirectBareDomain" value="true">
            ${t("share.redirect_bare_domain")}
        </label>
        <p class="form-text">${t("share.redirect_bare_domain_description")}</p>

        <div class="share-root-check mt-2 mb-2">
            <button class="btn btn-sm btn-secondary check-share-root">${t("share.check_share_root")}</button>
            <div class="share-root-status form-text mt-2"></div>
        </div>
    </div>

    <div class="form-group">
        <label class="tn-checkbox">
        <input class="form-check-input show-login-in-share-theme" type="checkbox" name="showLoginInShareTheme" value="true">
            ${t("share.show_login_link")}
        </label>
        <p class="form-text">${t("share.show_login_link_description")}</p>
    </div>

    <div class="form-group">
        <label>${t("share.share_path")}</label>
        <div>
            <input type="text" class="form-control share-path" placeholder="${t("share.share_path_placeholder")}">
        </div>
        <div class="form-text">
            ${t("share.share_path_description")}
        </div>
    </div>

</div>`;

export default class ShareSettingsOptions extends OptionsWidget {
    private $redirectBareDomain!: JQuery<HTMLInputElement>;
    private $showLoginInShareTheme!: JQuery<HTMLInputElement>;
    private $sharePath!: JQuery<HTMLInputElement>;
    private $shareRootCheck!: JQuery<HTMLElement>;
    private $shareRootStatus!: JQuery<HTMLElement>;

    doRender() {
        this.$widget = $(TPL);
        this.contentSized();

        this.$redirectBareDomain = this.$widget.find(".redirect-bare-domain");
        this.$showLoginInShareTheme = this.$widget.find(".show-login-in-share-theme");
        this.$sharePath = this.$widget.find(".share-path");
        this.$shareRootCheck = this.$widget.find(".share-root-check");
        this.$shareRootStatus = this.$widget.find(".share-root-status");
        this.$shareRootCheck.hide();

        this.$redirectBareDomain.on('change', async () => {
            const redirectBareDomain = this.$redirectBareDomain.is(":checked");
            await this.updateOption<"redirectBareDomain">("redirectBareDomain", redirectBareDomain.toString());

            // Show/hide share root status section based on redirectBareDomain checkbox
            this.$shareRootCheck.toggle(redirectBareDomain);
        });

        this.$showLoginInShareTheme.on('change', async () => {
            const showLoginInShareTheme = this.$showLoginInShareTheme.is(":checked");
            await this.updateOption<"showLoginInShareTheme">("showLoginInShareTheme", showLoginInShareTheme.toString());
        });

        this.$sharePath.on('change', async () => {
            const DEFAULT_SHAREPATH = "/share";
            const sharePathInput = this.$sharePath.val()?.trim() || "";

            const normalizedSharePath = normalizeSharePathInput(sharePathInput);
            const optionValue = (!sharePathInput || !normalizedSharePath || normalizedSharePath === "/")
                ? DEFAULT_SHAREPATH
                : normalizedSharePath;

            await this.updateOption<"sharePath">("sharePath", optionValue);
        });

        this.$widget.find(".check-share-root").on("click", () => this.checkShareRoot());
    }

    async optionsLoaded(options: OptionMap) {
        const redirectBareDomain = options.redirectBareDomain === "true";
        this.$redirectBareDomain.prop("checked", redirectBareDomain);
        this.$shareRootCheck.toggle(redirectBareDomain);

        this.$showLoginInShareTheme.prop("checked", options.showLoginInShareTheme === "true");
        this.$sharePath.val(options.sharePath);
    }

    async checkShareRoot() {
        this.$shareRootCheck.prop("disabled", true);

        const setCheckShareRootStyle = (removeClassName: string, addClassName: string, text: string) => {
            this.$shareRootStatus
                .removeClass(removeClassName)
                .addClass(addClassName)
                .text(text);

            this.$shareRootCheck.prop("disabled", false);
        };

        try {
            const shareRootNotes = await searchService.searchForNotes("#shareRoot");
            const sharedShareRootNotes = shareRootNotes.filter((note) => note.isShared());

            // No Note found that has the sharedRoot label AND is currently shared
            if (sharedShareRootNotes.length < 1) {
                const textMessage = (shareRootNotes.length > 0)
                    ? t("share.share_root_not_shared", { noteTitle: shareRootNotes[0].title })
                    : t("share.share_root_not_found");

                return setCheckShareRootStyle("text-success", "text-danger", textMessage);
            }

            // more than one currently shared Note found with the sharedRoot label
            // → use the first found, but warn user about it
            if (sharedShareRootNotes.length > 1) {

                const foundNoteTitles = shareRootNotes.map(note => t("share.share_note_title", {
                    noteTitle: note.title,
                    interpolation: {
                        escapeValue: false
                    }
                }));
                const activeNoteTitle = foundNoteTitles[0];

                return setCheckShareRootStyle("text-danger", "text-success",
                    t("share.share_root_multiple_found", {
                        activeNoteTitle,
                        foundNoteTitles: foundNoteTitles.join(", ")
                    })
                );
            }

            // exactly one note that has the sharedRoot label AND is currently shared
            return setCheckShareRootStyle("text-danger", "text-success",
                t("share.share_root_found", { noteTitle: sharedShareRootNotes[0].title })
            );
        } catch (err) {
            console.error(err);
            return setCheckShareRootStyle("text-success", "text-danger",
                t("share.check_share_root_error",)
            );
        }
    }
}
