import "./WebView.css";

import { useCallback, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import { t } from "../../services/i18n";
import toast from "../../services/toast";
import utils from "../../services/utils";
import Button from "../react/Button";
import FormGroup from "../react/FormGroup";
import FormTextBox from "../react/FormTextBox";
import { useNoteLabel } from "../react/hooks";
import SetupForm from "./helpers/SetupForm";
import { TypeWidgetProps } from "./type_widget";

const isElectron = utils.isElectron();
const HELP_PAGE = "1vHRoWCEjj0L";

export default function WebView({ note }: TypeWidgetProps) {
    const [ webViewSrc ] = useNoteLabel(note, "webViewSrc");
    const [ disabledWebViewSrc ] = useNoteLabel(note, "disabled:webViewSrc");

    if (disabledWebViewSrc) {
        return <DisabledWebView note={note} url={disabledWebViewSrc} />;
    }

    if (!webViewSrc) {
        return <SetupWebView note={note} />;
    }

    return <WebViewContent src={webViewSrc} />;
}

function WebViewContent({ src }: { src: string }) {
    if (!isElectron) {
        return <iframe src={src} class="note-detail-web-view-content" sandbox="allow-same-origin allow-scripts allow-popups" />;
    }
    return <webview src={src} class="note-detail-web-view-content" />;

}

function SetupWebView({note}: {note: FNote}) {
    const [ , setSrcLabel] = useNoteLabel(note, "webViewSrc");
    const [ src, setSrc ] = useState("");

    const submit = useCallback((url: string) => {
        try {
            // Validate URL
            new URL(url);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (ex) {
            toast.showErrorTitleAndMessage(t("web_view_setup.invalid_url_title"),
                t("web_view_setup.invalid_url_message"));
            return;
        }

        setSrcLabel(url);
    }, [ setSrcLabel ]);

    return (
        <SetupForm
            icon="bx bx-globe-alt" inAppHelpPage={HELP_PAGE}
            onSubmit={() => submit(src)}
        >
            <FormGroup name="web-view-src-detail" label={t("web_view_setup.title")}>
                <input className="form-control"
                    type="text"
                    value={src}
                    placeholder={t("web_view_setup.url_placeholder")}
                    onChange={(e) => {setSrc((e.target as HTMLInputElement)?.value);}}
                />
            </FormGroup>

            <Button
                text={t("web_view_setup.create_button")}
                primary
                keyboardShortcut="Enter"
            />
        </SetupForm>
    );
}

function DisabledWebView({ note, url }: { note: FNote, url: string }) {
    return (
        <SetupForm icon="bx bx-globe-alt" inAppHelpPage={HELP_PAGE}>
            <FormGroup name="web-view-src-detail" label={t("web_view_setup.disabled_description")}>
                <FormTextBox
                    type="url"
                    currentValue={url}
                    disabled
                />
            </FormGroup>

            <Button
                text={t("web_view_setup.disabled_button_enable")}
                icon="bx bx-check-shield"
                onClick={() => attributes.toggleDangerousAttribute(note, "label", "webViewSrc", true)}
                primary
            />
        </SetupForm>
    );
}
