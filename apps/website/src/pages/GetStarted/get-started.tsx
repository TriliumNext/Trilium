import { useLayoutEffect, useState } from "preact/hooks";
import Card from "../../components/Card.js";
import Section from "../../components/Section.js";
import { App, Architecture, buildDownloadUrl, downloadMatrix, DownloadMatrixEntry, getArchitecture, getPlatform, Platform } from "../../download-helper.js";
import { usePageTitle } from "../../hooks.js";
import Button, { Link } from "../../components/Button.js";
import Icon from "../../components/Icon.js";
import helpIcon from "../../assets/boxicons/bx-help-circle.svg?raw";
import "./get-started.css";
import packageJson from "../../../../../package.json" with { type: "json" };
import { t } from "../../i18n.js";

export default function DownloadPage() {
    const [ currentArch, setCurrentArch ] = useState<Architecture>("x64");
    const [ userPlatform, setUserPlatform ] = useState<Platform>();

    useLayoutEffect(() => {
        getArchitecture().then((arch) => setCurrentArch(arch ?? "x64"));
        setUserPlatform(getPlatform() ?? "windows");
    }, []);

    usePageTitle(t("get-started.title"));

    return (
        <>
            <Section title={t("get-started.desktop_title", { version: packageJson.version })} className="fill accented download-desktop">
                <div className="architecture-switch">
                    <span>{t("get-started.architecture")}</span>

                    <div class="toggle-wrapper">
                        {(["x64", "arm64"] as const).map(arch => (
                            <a
                                href="#"
                                className={`arch ${arch === currentArch ? "active" : ""}`}
                                onClick={() => setCurrentArch(arch)}
                            >{arch}</a>
                        ))}
                    </div>
                </div>

                <div className="grid-3-cols download-desktop">
                    {reorderPlatforms(Object.entries(downloadMatrix.desktop), userPlatform ?? "")
                        .map(entry => (
                        <DownloadCard app="desktop" arch={currentArch} entry={entry} isRecommended={userPlatform === entry[0]} />
                    ))}
                </div>

                <div class="download-footer">
                    <Link href="https://github.com/TriliumNext/Trilium/releases/" openExternally>{t("get-started.older_releases")}</Link>
                </div>
            </Section>

            <Section title={t("get-started.server_title")}>
                <div className="grid-2-cols download-server">
                    {Object.entries(downloadMatrix.server).map(entry => (
                        <DownloadCard app="server" arch={currentArch} entry={entry} />
                    ))}
                </div>
            </Section>
        </>
    )
}

export function DownloadCard({ app, arch, entry: [ platform, entry ], isRecommended }: {
    app: App,
    arch: Architecture,
    entry: [string, DownloadMatrixEntry],
    isRecommended?: boolean;
}) {
    function unwrapText(text: string | Record<Architecture, string>) {
        return (typeof text === "string" ? text : text[arch]);
    }

    const allDownloads = Object.entries(entry.downloads);
    const recommendedDownloads = allDownloads.filter(download => download[1].recommended);
    const restDownloads = allDownloads.filter(download => !download[1].recommended);

    return (
        <Card
            title={
                <>
                    {unwrapText(entry.title)}
                    {entry.helpUrl && (
                        <Link
                            className="more-info"
                            href={entry.helpUrl}
                            openExternally
                        >
                            <Icon svg={helpIcon} />
                        </Link>
                    )}
                    </>
            }
            className={`download-card ${platform} ${isRecommended ? "recommended" : ""}`}
        >
            {unwrapText(entry.description)}

            {entry.quickStartTitle && <p class="quick-start-title">{entry.quickStartTitle}</p>}
            {entry.quickStartCode && (
                <pre className="quick-start">
                    <code>{entry.quickStartCode}</code>
                </pre>
            )}

            <div class="download-options">
                <div className="recommended-options">
                    {recommendedDownloads.map(recommendedDownload => (
                        <Button
                            className="recommended"
                            href={buildDownloadUrl(app, platform as Platform, recommendedDownload[0], arch)}
                            text={recommendedDownload[1].name}
                            openExternally={!!recommendedDownload[1].url}
                        />
                    ))}
                </div>

                <div class="other-options">
                    {restDownloads.map(download => (
                        <Link
                            href={buildDownloadUrl(app, platform as Platform, download[0], arch)}
                            openExternally={!!download[1].url}
                        >
                            {download[1].name}
                        </Link>
                    ))}
                </div>
            </div>
        </Card>
    )
}

function reorderPlatforms(entries: [string, DownloadMatrixEntry][], platformToCenter: Platform | "") {
    const entryToCenter = entries.find(x => x[0] === platformToCenter);
    if (!entryToCenter) return entries;

    const others = entries.filter(x => x !== entryToCenter);
    const mid = Math.floor(others.length / 2);
    others.splice(mid, 0, entryToCenter);
    return others;
}
