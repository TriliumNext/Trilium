import { useMemo, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import Button from "../react/Button";
import Modal from "../react/Modal";
import { dismissCallToAction, getCallToActions } from "./call_to_action_definitions";

export default function CallToActionDialog() {
    const activeCallToActions = useMemo(() => getCallToActions(), []);
    const [ activeIndex, setActiveIndex ] = useState(0);
    const [ shown, setShown ] = useState(true);
    const activeItem = activeCallToActions[activeIndex];

    function goToNext() {
        if (activeIndex + 1 < activeCallToActions.length) {
            setActiveIndex(activeIndex + 1);
        } else {
            setShown(false);
        }
    }

    return (activeCallToActions.length &&
        <Modal
            className="call-to-action"
            size="md"
            title={activeItem.title}
            show={shown}
            onHidden={() => setShown(false)}
            footerAlignment="between"
            footer={<>
                <Button text={t("call_to_action.dismiss")} onClick={async () => {
                    await dismissCallToAction(activeItem.id);
                    goToNext();
                }} />
                {activeItem.buttons.map((button) =>
                    <Button text={button.text} onClick={async () => {
                        await dismissCallToAction(activeItem.id);
                        await button.onClick();
                        goToNext();
                    }}/>
                )}
            </>}
        >
            <p className="pre-wrap-text">{activeItem.message}</p>
        </Modal>
    );
}
