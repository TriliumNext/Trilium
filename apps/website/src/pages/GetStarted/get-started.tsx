import { useState } from "preact/hooks";
import Card from "../../components/Card.js";
import Section from "../../components/Section.js";
import { App, Architecture, buildDownloadUrl, downloadMatrix, DownloadMatrixEntry, getArchitecture, Platform } from "../../download-helper.js";
import { usePageTitle } from "../../hooks.js";
import Button, { Link } from "../../components/Button.js";
import Icon from "../../components/Icon.js";
import helpIcon from "../../assets/boxicons/bx-help-circle.svg?raw";
import "./get-started.css";
import packageJson from "../../../../../package.json" with { type: "json" };

export default function DownloadPage() {
    const [ currentArch, setCurrentArch ] = useState(getArchitecture() ?? "x64");
    usePageTitle("Download");

    return (
        <>
            <Section title={`Download the desktop application (v${packageJson.version})`} className="fill accented download-desktop">
                <div className="architecture-switch">
                    <span>Architecture:</span>

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
                    {Object.entries(downloadMatrix.desktop).map(entry => <DownloadCard app="desktop" arch={currentArch} entry={entry} />)}
                </div>

                <div class="download-footer">
                    <Link href="https://github.com/TriliumNext/Trilium/releases/" openExternally>See older releases</Link>
                </div>
            </Section>

            <Section title="Set up a server for access on multiple devices">
                <div className="grid-2-cols download-server">
                    {Object.entries(downloadMatrix.server).map(entry => <DownloadCard app="server" arch={currentArch} entry={entry} />)}
                </div>
            </Section>
        </>
    )
}

export function DownloadCard({ app, arch, entry: [ platform, entry ] }: { app: App, arch: Architecture, entry: [string, DownloadMatrixEntry] }) {
    function unwrapText(text: string | Record<Architecture, string>) {
        return (typeof text === "string" ? text : text[arch]);
    }

    const allDownloads = Object.entries(entry.downloads);
    const recommendedDownloads = allDownloads.filter(download => download[1].recommended);
    const restDownloads = allDownloads.filter(download => !download[1].recommended);

    return (
        <Card title={<>
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
        </>} className="download-card">
            {unwrapText(entry.description)}

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
