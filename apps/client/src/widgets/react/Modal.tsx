import clsx from "clsx";
import { useEffect, useRef, useMemo } from "preact/hooks";
import { t } from "../../services/i18n";
import { ComponentChildren } from "preact";
import type { CSSProperties, RefObject } from "preact/compat";
import { openDialog } from "../../services/dialog";
import { Modal as BootstrapModal } from "bootstrap";
import { memo } from "preact/compat";
import { useSyncedRef } from "./hooks";

interface CustomTitleBarButton {
    title: string;
    iconClassName: string;
    onClick: () => void;
}

export interface ModalProps {
    className: string;
    title: string | ComponentChildren;
    customTitleBarButtons?: (CustomTitleBarButton | null)[];
    size: "xl" | "lg" | "md" | "sm";
    children: ComponentChildren;
    /**
     * Items to display in the modal header, apart from the title itself which is handled separately.
     */
    header?: ComponentChildren;
    footer?: ComponentChildren;
    footerStyle?: CSSProperties;
    footerAlignment?: "right" | "between";
    minWidth?: string;
    maxWidth?: number;
    zIndex?: number;
    /**
     * If true, the modal body will be scrollable if the content overflows.
     * This is useful for larger modals where you want to keep the header and footer visible
     * while allowing the body content to scroll.
     * Defaults to false.
     */
    scrollable?: boolean;
    /**
     * If set, the modal body and footer will be wrapped in a form and the submit event will call this function.
     * Especially useful for user input that can be submitted with Enter key.
     */
    onSubmit?: () => void;
    /** Called when the modal is shown. */
    onShown?: () => void;
    /**
     * Called when the modal is hidden, either via close button, backdrop click or submit.
     *
     * Here it's generally a good idea to set `show` to false to reflect the actual state of the modal.
     */
    onHidden: () => void;
    helpPageId?: string;
    /**
     * Gives access to the underlying modal element. This is useful for manipulating the modal directly
     * or for attaching event listeners.
     */
    modalRef?: RefObject<HTMLDivElement>;
    /**
     * Gives access to the underlying form element of the modal. This is only set if `onSubmit` is provided.
     */
    formRef?: RefObject<HTMLFormElement>;
    bodyStyle?: CSSProperties;
    /**
     * Controls whether the modal is shown. Setting it to `true` will trigger the modal to be displayed to the user, whereas setting it to `false` will hide the modal.
     * This method must generally be coupled with `onHidden` in order to detect when the modal was closed externally (e.g. by the user clicking on the backdrop or on the close button).
     */
    show: boolean;
    /**
     * By default displaying a modal will close all existing modals. Set this to true to keep the existing modals open instead. This is useful for confirmation modals.
     */
    stackable?: boolean;
    /**
     * If true, the modal will remain in the DOM even when not shown. This can be useful for certain CSS transitions or when you want to avoid re-mounting the modal content.
     */
    keepInDom?: boolean;
    /**
     * If true, the modal will not focus itself after becoming visible.
     */
    noFocus?: boolean;
}

export default function Modal({ children, className, size, title, customTitleBarButtons: titleBarButtons, header, footer, footerStyle, footerAlignment, onShown, onSubmit, helpPageId, minWidth, maxWidth, zIndex, scrollable, onHidden: onHidden, modalRef: externalModalRef, formRef, bodyStyle, show, stackable, keepInDom, noFocus }: ModalProps) {
    const modalRef = useSyncedRef<HTMLDivElement>(externalModalRef);
    const modalInstanceRef = useRef<BootstrapModal>();
    const elementToFocus = useRef<Element | null>();

    useEffect(() => {
        const modalElement = modalRef.current;
        if (!modalElement) return;

        if (onShown) {
            modalElement.addEventListener("shown.bs.modal", onShown);
        }

        function onModalHidden() {
            onHidden();
            if (elementToFocus.current && "focus" in elementToFocus.current) {
                (elementToFocus.current as HTMLElement).focus();
            }
        }

        modalElement.addEventListener("hidden.bs.modal", onModalHidden);
        return () => {
            if (onShown) {
                modalElement.removeEventListener("shown.bs.modal", onShown);
            }
            modalElement.removeEventListener("hidden.bs.modal", onModalHidden);
        };
    }, [ onShown, onHidden ]);

    useEffect(() => {
        if (show && modalRef.current) {
            elementToFocus.current = document.activeElement;
            openDialog($(modalRef.current), !stackable, {
                focus: !noFocus
            }).then(($widget) => {
                modalInstanceRef.current = BootstrapModal.getOrCreateInstance($widget[0]);
            })
        } else {
            modalInstanceRef.current?.hide();
        }
    }, [ show, modalRef.current, noFocus ]);

    // Memoize styles to prevent recreation on every render
    const dialogStyle = useMemo<CSSProperties>(() => {
        const style: CSSProperties = {};
        if (zIndex) {
            style.zIndex = zIndex;
        }
        return style;
    }, [zIndex]);

    const documentStyle = useMemo<CSSProperties>(() => {
        const style: CSSProperties = {};
        if (maxWidth) {
            style.maxWidth = `${maxWidth}px`;
        }
        if (minWidth) {
            style.minWidth = minWidth;
        }
        return style;
    }, [maxWidth, minWidth]);

    return (
        <div className={`modal fade mx-auto ${className}`} tabIndex={-1} style={dialogStyle} role="dialog" ref={modalRef}>
            {(show || keepInDom) && <div className={`modal-dialog modal-${size} ${scrollable ? "modal-dialog-scrollable" : ""}`} style={documentStyle} role="document">
                <div className="modal-content">
                    <div className="modal-header">
                        {!title || typeof title === "string" ? (
                            <h5 className="modal-title">{title ?? <>&nbsp;</>}</h5>
                        ) : (
                            title
                        )}
                        {header}
                        {helpPageId && (
                            <button className="help-button" type="button" data-in-app-help={helpPageId} title={t("modal.help_title")}>?</button>
                        )}

                        {titleBarButtons?.filter((b) => b !== null).map((titleBarButton) => (
                            <button type="button"
                                    className={clsx("custom-title-bar-button bx", titleBarButton.iconClassName)}
                                    title={titleBarButton.title}
                                    onClick={titleBarButton.onClick}>
                            </button>
                        ))}

                        <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label={t("modal.close")}></button>

                    </div>

                    {onSubmit ? (
                        <form ref={formRef} onSubmit={(e) => {
                            e.preventDefault();
                            onSubmit();
                        }}>
                            <ModalInner footer={footer} bodyStyle={bodyStyle} footerStyle={footerStyle} footerAlignment={footerAlignment}>{children}</ModalInner>
                        </form>
                    ) : (
                        <ModalInner footer={footer} bodyStyle={bodyStyle} footerStyle={footerStyle} footerAlignment={footerAlignment}>
                            {children}
                        </ModalInner>
                    )}
                </div>
            </div>}
        </div>
    );
}

const ModalInner = memo(({ children, footer, footerAlignment, bodyStyle, footerStyle: _footerStyle }: Pick<ModalProps, "children" | "footer" | "footerAlignment" | "bodyStyle" | "footerStyle">) => {
    // Memoize footer style
    const footerStyle = useMemo<CSSProperties>(() => {
        const style: CSSProperties = _footerStyle ?? {};
        if (footerAlignment === "between") {
            style.justifyContent = "space-between";
        }
        return style;
    }, [_footerStyle, footerAlignment]);

    return (
        <>
            <div className="modal-body" style={bodyStyle}>
                {children}
            </div>

            {footer && (
                <div className="modal-footer" style={footerStyle}>
                    {footer}
                </div>
            )}
        </>
    );
});
