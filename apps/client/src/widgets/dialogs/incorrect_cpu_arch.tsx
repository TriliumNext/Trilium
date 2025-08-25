import { useRef } from "preact/hooks";
import { t } from "../../services/i18n.js";
import utils from "../../services/utils.js";
import Button from "../react/Button.js";
import Modal from "../react/Modal.js";
import { useState } from "preact/hooks";
import { useTriliumEvent } from "../react/hooks.jsx";

export default function IncorrectCpuArchDialogComponent() {
    const [ shown, setShown ] = useState(false);
    const downloadButtonRef = useRef<HTMLButtonElement>(null);
    useTriliumEvent("showCpuArchWarning", () => setShown(true));

    return (
        <Modal
            className="cpu-arch-dialog"
            size="lg"
            title={t("cpu_arch_warning.title")}
            onShown={() => downloadButtonRef.current?.focus()}
            footerAlignment="between"
            footer={<>
                <Button
                    buttonRef={downloadButtonRef}
                    text={t("cpu_arch_warning.download_link")}
                    icon="bx bx-download"
                    onClick={() => {
                        // Open the releases page where users can download the correct version
                        if (utils.isElectron()) {
                            const { shell } = utils.dynamicRequire("electron");
                            shell.openExternal("https://github.com/TriliumNext/Trilium/releases/latest");
                        } else {
                            window.open("https://github.com/TriliumNext/Trilium/releases/latest", "_blank");
                        }
                    }}/>
                <Button text={t("cpu_arch_warning.continue_anyway")}
                    onClick={() => setShown(false)} />
            </>}
            onHidden={() => setShown(false)}
            show={shown}
        >
            <p>{utils.isMac() ? t("cpu_arch_warning.message_macos") : t("cpu_arch_warning.message_windows")}</p>
            <p>{t("cpu_arch_warning.recommendation")}</p>
        </Modal>
    )
}
