import { getRecommendedDownload } from "../download-helper";
import "./DownloadButton.css";
import Button from "./Button";
import downloadIcon from "../assets/boxicons/bx-arrow-in-down-square-half.svg?raw";

interface DownloadButtonProps {
    big?: boolean;
}

const { name, url } = getRecommendedDownload();

export default function DownloadButton({ big }: DownloadButtonProps) {
    return (
        <Button
           className={`download-button desktop-only ${big ? "big" : ""}`}
           href={url}
           iconSvg={downloadIcon}
           text={<>
                Download now{" "}
                <span class="platform">for {name}</span>
           </>}
        />
    )
}
