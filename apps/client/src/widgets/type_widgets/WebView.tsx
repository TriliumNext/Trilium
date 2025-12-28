import { t } from "../../services/i18n";
import utils from "../../services/utils";
import Alert from "../react/Alert";
import { useNoteLabel } from "../react/hooks";
import { TypeWidgetProps } from "./type_widget";
import "./WebView.css";

const isElectron = utils.isElectron();

export default function WebView({ note }: TypeWidgetProps) {
    const [ webViewSrc ] = useNoteLabel(note, "webViewSrc");

    return (webViewSrc
        ? <WebViewContent src={webViewSrc} />
        : <WebViewHelp />
    );
}

function WebViewContent({ src }: { src: string }) {
    if (!isElectron) {
        return <iframe src={src} class="note-detail-web-view-content" sandbox="allow-same-origin allow-scripts allow-popups" />
    } else {
        return <webview src={src} class="note-detail-web-view-content" />
    }
}

function WebViewHelp() {
    return (
        <Alert className="note-detail-web-view-help" type="warning">
            <h4>{t("web_view.web_view")}</h4>
            <p>{t("web_view.embed_websites")}</p>
            <p>{t("web_view.create_label")}</p>
        </Alert>
    )
}
