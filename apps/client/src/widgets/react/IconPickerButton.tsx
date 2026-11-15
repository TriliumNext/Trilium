import "./IconPickerButton.css";

import clsx from "clsx";
import type { ComponentProps } from "preact";
import { useRef, useState } from "preact/hooks";

import { isMobile } from "../../services/utils";
import ActionButton from "./ActionButton";
import { type DropdownHandle, DropdownPanel } from "./Dropdown";
import type { IconPickerModal, IconPickerProps } from "./IconPicker";
import { preloadLazyModule, useLazyModule } from "./LazyComponent";

/** The picker with its grid of every icon, imported once a button is about to open it. */
const loadIconPicker = () => import("./IconPicker");
const preloadIconPicker = () => preloadLazyModule(loadIconPicker);

export interface IconPickerButtonProps extends Pick<IconPickerProps, "onSelect" | "onReset" | "resetText"> {
    /** The class the button wears, which is the icon it stands for, e.g. `bx bx-star`. */
    icon: string;
    /** What pressing it is for, worn as its tooltip and as the heading of the modal on a phone. */
    title: string;
    /** The host's own class, for a host that dresses the button or the widget around it. */
    className?: string;
    disabled?: boolean;
    /**
     * Said as the picker opens and closes, for a host that has to hold something open while the
     * reader is in it: the picker takes focus with it, and an editor that closes on losing focus
     * would take the picker down with itself.
     */
    onOpened?: () => void;
    onClosed?: () => void;
    /** Dim the page behind the picker, for a host that would rather it were answered before
     * anything else. Has no effect on a phone, where the picker is a dialog with a backdrop of its
     * own. */
    backdrop?: boolean;
}

/**
 * The button an icon is picked through: the picker hangs under it, and what is picked is reported
 * and the picker put away.
 *
 * Where it is put differs with the screen. A desktop gets the menu under the button, at the width
 * twelve icons and a search field ask for. A phone gets a modal of its own instead: that width is
 * wider than the screen, and a menu of it — hung off a button that may itself be in the corner of a
 * panel — leaves the grid mostly off-screen, which is no way to pick from a thousand icons.
 */
export function IconPickerButton({ className, ...props }: IconPickerButtonProps) {
    // A constant of the session rather than of the render, as everywhere else it is branched on.
    return isMobile()
        ? <IconPickerModalButton className={className} {...props} />
        : <IconPickerDropdownButton className={className} {...props} />;
}

/** The picker under the button, as a desktop shows it. */
function IconPickerDropdownButton({
    icon, title, className, disabled, onSelect, onReset, resetText, onOpened, onClosed, backdrop
}: IconPickerButtonProps) {
    const dropdownRef = useRef<DropdownHandle>(null);
    const [ pickerShown, setPickerShown ] = useState(false);

    return (
        <DropdownPanel
            // The legacy class dresses the menu the picker sits in, which the themes and the
            // picker's own stylesheet reach through it.
            className={clsx("note-icon-widget", className)}
            buttonClassName={`note-icon tn-focusable-button ${icon}`}
            title={disabled ? undefined : title}
            disabled={disabled}
            dropdownRef={dropdownRef}
            buttonProps={{ onPointerEnter: preloadIconPicker, onFocus: preloadIconPicker }}
            autoClose="outside"
            backdrop={backdrop}
            hideToggleArrow
            onShown={() => {
                setPickerShown(true);
                onOpened?.();
            }}
            onHidden={() => {
                setPickerShown(false);
                onClosed?.();
            }}
        >
            {/* Built only once opened: it holds every icon of every installed pack, which is far
                more work than a button that merely happens to be on screen should be doing. */}
            {pickerShown && (
                <LazyIconPicker
                    columnCount={12}
                    resetText={resetText}
                    onSelect={(iconClass) => {
                        onSelect(iconClass);
                        dropdownRef.current?.hide();
                    }}
                    onReset={onReset && (() => {
                        onReset();
                        dropdownRef.current?.hide();
                    })}
                />
            )}
        </DropdownPanel>
    );
}

/** The picker on a screen of its own, as a phone shows it. */
function IconPickerModalButton({
    icon, title, className, disabled, onSelect, onReset, resetText, onOpened, onClosed
}: IconPickerButtonProps) {
    const [ modalShown, setModalShown ] = useState(false);
    // The modal is rendered from the first press on, and stays so it can animate closed.
    const [ modalOpened, setModalOpened ] = useState(false);

    return (
        <div className={clsx("note-icon-widget", className)}>
            <ActionButton
                className="note-icon"
                icon={icon}
                text={title}
                // The dropdown button a desktop shows is a `btn`, which the note icon's own rules
                // size. `icon-action` instead is sized by the theme as a toolbar button, which is
                // larger, so the same icon would be drawn differently on the two.
                noIconActionClass
                onPointerEnter={preloadIconPicker}
                onFocus={preloadIconPicker}
                onClick={() => {
                    setModalOpened(true);
                    setModalShown(true);
                    onOpened?.();
                }}
                disabled={disabled}
            />

            {modalOpened && <LazyIconPickerModal
                title={title}
                show={modalShown}
                resetText={resetText}
                onHidden={() => {
                    setModalShown(false);
                    onClosed?.();
                }}
                onSelect={(iconClass) => {
                    onSelect(iconClass);
                    setModalShown(false);
                }}
                onReset={onReset && (() => {
                    onReset();
                    setModalShown(false);
                })}
            />}
        </div>
    );
}

/** The picker's modal, once its module has loaded. */
function LazyIconPickerModal(props: ComponentProps<typeof IconPickerModal>) {
    const iconPicker = useLazyModule(loadIconPicker);
    return iconPicker ? <iconPicker.IconPickerModal {...props} /> : null;
}

/** The picker, once its module has loaded. */
function LazyIconPicker(props: IconPickerProps) {
    const iconPicker = useLazyModule(loadIconPicker);
    return iconPicker ? <iconPicker.default {...props} /> : null;
}
