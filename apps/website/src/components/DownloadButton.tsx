import { getRecommendedDownload, RecommendedDownload } from "../download-helper.js";
import "./DownloadButton.css";
import Button from "./Button.js";
import downloadIcon from "../assets/boxicons/bx-arrow-in-down-square-half.svg?raw";
import packageJson from "../../../../package.json" with { type: "json" };
import { useContext, useEffect, useState } from "preact/hooks";
import { useTranslation } from "react-i18next";
import { LocaleContext } from "../index.js";

interface DownloadButtonProps {
    big?: boolean;
}

export default function DownloadButton({ big }: DownloadButtonProps) {
    const locale = useContext(LocaleContext);
    const { t } = useTranslation();
    const [ recommendedDownload, setRecommendedDownload ] = useState<RecommendedDownload | null>();
    useEffect(() => {
        getRecommendedDownload(t)?.then(setRecommendedDownload);
    }, [ t ]);

    return (recommendedDownload &&
        <>
            {recommendedDownload.platform !== "linux"
            ? (
                <Button
                    className={`download-button desktop-only ${big ? "big" : ""}`}
                    href={recommendedDownload.url}
                    iconSvg={downloadIcon}
                    text={<>
                            {t("download_now.text")}
                            {big
                            ? <span class="platform">{t("download_now.platform_big", { version: packageJson.version, platform: recommendedDownload.name })}</span>
                            : <span class="platform">{t("download_now.platform_small", { platform: recommendedDownload.name })}</span>
                            }
                    </>}
                />
            ) : (
                <Button
                    className={`download-button desktop-only ${big ? "big" : ""}`}
                    href={`/${locale}/get-started/`}
                    iconSvg={downloadIcon}
                    text={<>
                            {t("download_now.text")}
                            {big
                            ? <span class="platform">{t("download_now.linux_big", { version: packageJson.version })}</span>
                            : <span class="platform">{t("download_now.linux_small")}</span>
                            }
                    </>}
                />
            )}

            {big && (
                <a class="more-download-options desktop-only" href="./get-started/">{t("download_now.more_platforms")}</a>
            )}
        </>
    )
}
