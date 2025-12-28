import "./ReadOnlyNoteInfoBar.css";
import { t } from "../services/i18n";
import { useIsNoteReadOnly, useNoteContext, useTriliumEvent } from "./react/hooks"
import Button from "./react/Button";
import InfoBar from "./react/InfoBar";
import HelpButton from "./react/HelpButton";

export default function ReadOnlyNoteInfoBar(props: {}) {
    const { note, noteContext } = useNoteContext();
    const { isReadOnly, enableEditing } = useIsNoteReadOnly(note, noteContext);
    const isExplicitReadOnly = note?.isLabelTruthy("readOnly");

    return (
        <InfoBar
            className="read-only-note-info-bar-widget"
            type={(isExplicitReadOnly ? "subtle" : "prominent")}
            style={{display: (!isReadOnly) ? "none" : undefined}}
        >
            <div class="read-only-note-info-bar-widget-content">
                {(isExplicitReadOnly) ? (
                    <div>{t("read-only-info.read-only-note")}</div>
                ) : (
                    <div>
                        {t("read-only-info.auto-read-only-note")}
                        {" "}
                        <HelpButton helpPage="CoFPLs3dRlXc" />
                    </div>
                )}

                <Button text={t("read-only-info.edit-note")}
                        icon="bx-pencil" onClick={() => enableEditing()} />
            </div>
        </InfoBar>
    );
}
