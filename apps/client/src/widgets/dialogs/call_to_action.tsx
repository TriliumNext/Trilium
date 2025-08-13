import { useState } from "preact/hooks";
import Button from "../react/Button";
import Modal from "../react/Modal";
import ReactBasicWidget from "../react/ReactBasicWidget";
import { CallToAction, dismissCallToAction, getCallToActions } from "./call_to_action_definitions";

function CallToActionDialogComponent({ activeCallToActions }: { activeCallToActions: CallToAction[] }) {
    if (!activeCallToActions.length) {
        return <></>;
    }
    
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

    return (
        <Modal
            className="call-to-action"
            size="md"
            title="New features"
            show={shown}
            onHidden={() => setShown(false)}
            footerAlignment="between"
            footer={<>
                <Button text="Dismiss" onClick={async () => {
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
            <h4>{activeItem.title}</h4>
            <p>{activeItem.message}</p>
        </Modal>
    )
}

export class CallToActionDialog extends ReactBasicWidget {

    get component() {
        return <CallToActionDialogComponent activeCallToActions={getCallToActions()} /> 
    }

}