import { useContext, useEffect, useRef, useMemo } from "preact/hooks";
import { t } from "../../services/i18n";
import { ComponentChildren } from "preact";
import type { CSSProperties, RefObject } from "preact/compat";
import { openDialog } from "../../services/dialog";
import { ParentComponent } from "./react_utils";
import { Modal as BootstrapModal } from "bootstrap";
import { memo } from "preact/compat";
import { useSyncedRef } from "./hooks";

interface ModalProps {
    className: string;
    title: string | ComponentChildren;
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
}

export default function Modal({ children, className, size, title, header, footer, footerStyle, footerAlignment, onShown, onSubmit, helpPageId, minWidth, maxWidth, zIndex, scrollable, onHidden: onHidden, modalRef: externalModalRef, formRef, bodyStyle, show, stackable }: ModalProps) {
    const modalRef = useSyncedRef<HTMLDivElement>(externalModalRef);
    const modalInstanceRef = useRef<BootstrapModal>();
    const parentWidget = useContext(ParentComponent);
    const elementToFocus = useRef<Element | null>();

    useEffect(() => {
        const modalElement = modalRef.current;
        if (!modalElement) {
            return;
        }
        if (onShown) {
            modalElement.addEventListener("shown.bs.modal", onShown);
        }
        modalElement.addEventListener("hidden.bs.modal", () => {
            onHidden();
            if (elementToFocus.current && "focus" in elementToFocus.current) {
                (elementToFocus.current as HTMLElement).focus();
            }
        });
        return () => {
            if (onShown) {
                modalElement.removeEventListener("shown.bs.modal", onShown);
            }
            modalElement.removeEventListener("hidden.bs.modal", onHidden);
        };
    }, [ onShown, onHidden ]);

    useEffect(() => {
        if (!parentWidget) {
            return;
        }
        if (show) {
            elementToFocus.current = document.activeElement;
            openDialog(parentWidget.$widget, !stackable).then(($widget) => {
                modalInstanceRef.current = BootstrapModal.getOrCreateInstance($widget[0]);
            })
        } else {
            modalInstanceRef.current?.hide();
        }
    }, [ show ]);

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
            {show && <div className={`modal-dialog modal-${size} ${scrollable ? "modal-dialog-scrollable" : ""}`} style={documentStyle} role="document">
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