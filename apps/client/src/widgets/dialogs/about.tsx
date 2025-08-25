import Modal from "../react/Modal.js";
import { t } from "../../services/i18n.js";
import { formatDateTime } from "../../utils/formatters.js";
import server from "../../services/server.js";
import utils from "../../services/utils.js";
import openService from "../../services/open.js";
import { useState } from "preact/hooks";
import type { CSSProperties } from "preact/compat";
import type { AppInfo } from "@triliumnext/commons";
import { useTriliumEvent } from "../react/hooks.jsx";

export default function AboutDialog() {
    const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
    const [shown, setShown] = useState(false);
    const forceWordBreak: CSSProperties = { wordBreak: "break-all" };

    useTriliumEvent("openAboutDialog", () => setShown(true));

    return (
        <Modal className="about-dialog"
            size="lg"
            title={t("about.title")}
            show={shown}
            onShown={async () => {
                const appInfo = await server.get<AppInfo>("app-info");
                setAppInfo(appInfo);
            }}
            onHidden={() => setShown(false)}
        >
            <table className="table table-borderless">
                <tbody>
                    <tr>
                        <th>{t("about.homepage")}</th>
                        <td><a className="tn-link external" href="https://github.com/TriliumNext/Trilium" style={forceWordBreak}>https://github.com/TriliumNext/Trilium</a></td>
                    </tr>
                    <tr>
                        <th>{t("about.app_version")}</th>
                        <td className="app-version">{appInfo?.appVersion}</td>
                    </tr>
                    <tr>
                        <th>{t("about.db_version")}</th>
                        <td className="db-version">{appInfo?.dbVersion}</td>
                    </tr>
                    <tr>
                        <th>{t("about.sync_version")}</th>
                        <td className="sync-version">{appInfo?.syncVersion}</td>
                    </tr>
                    <tr>
                        <th>{t("about.build_date")}</th>
                        <td className="build-date">
                            {appInfo?.buildDate ? formatDateTime(appInfo.buildDate) : ""}
                        </td>
                    </tr>
                    <tr>
                        <th>{t("about.build_revision")}</th>
                        <td>
                            {appInfo?.buildRevision && <a className="tn-link build-revision external" href={`https://github.com/TriliumNext/Trilium/commit/${appInfo.buildRevision}`} target="_blank" style={forceWordBreak}>{appInfo.buildRevision}</a>}
                        </td>
                    </tr>
                    <tr>
                        <th>{t("about.data_directory")}</th>
                        <td className="data-directory">
                            {appInfo?.dataDirectory && (<DirectoryLink directory={appInfo.dataDirectory} style={forceWordBreak} />)}
                        </td>
                    </tr>
                </tbody>
            </table>
        </Modal>
    );
}

function DirectoryLink({ directory, style }: { directory: string, style?: CSSProperties }) {
    if (utils.isElectron()) {
        const onClick = (e: MouseEvent) => {
            e.preventDefault();
            openService.openDirectory(directory);
        };

        return <a className="tn-link" href="#" onClick={onClick} style={style}></a>
    } else {
        return <span style={style}>{directory}</span>;
    }
}
