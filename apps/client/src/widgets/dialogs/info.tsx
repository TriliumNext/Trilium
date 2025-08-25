import { EventData } from "../../components/app_context";
import Modal from "../react/Modal";
import { t } from "../../services/i18n";
import Button from "../react/Button";
import { useRef, useState } from "preact/hooks";
import { RawHtmlBlock } from "../react/RawHtml";
import { useTriliumEvent } from "../react/hooks";

export default function InfoDialog() {
    const [ opts, setOpts ] = useState<EventData<"showInfoDialog">>();
    const [ shown, setShown ] = useState(false);
    const okButtonRef = useRef<HTMLButtonElement>(null);

    useTriliumEvent("showInfoDialog", (opts) => {
        setOpts(opts);
        setShown(true);
    });

    return (<Modal
        className="info-dialog"
        size="sm"
        title={t("info.modalTitle")}
        onHidden={() => {
            opts?.callback?.();
            setShown(false);
        }}
        onShown={() => okButtonRef.current?.focus?.()}
        footer={<Button
            buttonRef={okButtonRef}
            text={t("info.okButton")}
            onClick={() => setShown(false)}
        />}
        show={shown}
        stackable
    >
        <RawHtmlBlock className="info-dialog-content" html={opts?.message ?? ""} />
    </Modal>);
}
