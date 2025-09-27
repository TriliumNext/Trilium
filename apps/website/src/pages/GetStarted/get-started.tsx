import { useState } from "preact/hooks";
import Card from "../../components/Card";
import Section from "../../components/Section";
import { App, Architecture, buildDownloadUrl, downloadMatrix, DownloadMatrixEntry, getArchitecture, Platform } from "../../download-helper";
import { usePageTitle } from "../../hooks";
import Button, { Link } from "../../components/Button";
import Icon from "../../components/Icon";
import helpIcon from "../../assets/boxicons/bx-help-circle.svg?raw";
import "./get-started.css";

export default function DownloadPage() {
    const [ currentArch, setCurrentArch ] = useState(getArchitecture());
    usePageTitle("Download");

    return (
        <>
            <Section title="Download the desktop application" className="fill accented">
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
