import TimeSelector from "../time_selector.js";

const TPL = /*html*/`
<div class="options-section">
    <p class="form-text">

    </p>
    <div id="time-selector-placeholder"></div>
</div>`;

export default class ProtectedSessionTimeoutOptions extends TimeSelector {
    constructor() {
        super({
            widgetId: "protected-session-timeout",
            widgetLabelId: "password.protected_session_timeout_label",
            optionValueId: "protectedSessionTimeout",
            optionTimeScaleId: "protectedSessionTimeoutTimeScale",
            minimumSeconds: 60
        });
        super.doRender();
    }

    doRender() {
        const $timeSelector = this.$widget;
        // inject TimeSelector widget template
        this.$widget = $(TPL);
        this.$widget.find("#time-selector-placeholder").replaceWith($timeSelector);
    }
}
