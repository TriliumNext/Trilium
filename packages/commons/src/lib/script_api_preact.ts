/**
 * Public type surface for the **Preact API** available to JSX render notes via
 * `import { … } from "trilium:preact"` (which the server rewrites to `api.preact`
 * at runtime).
 *
 * Single source of truth shared by the in-editor language service and the
 * `script-deployer`, mirroring `script_api.ts`. Following the same philosophy,
 * the genuinely useful props (enums, flags, callbacks) are typed precisely while
 * references into the heavy client widget graph (editor instances, bootstrap
 * options, note view scopes, …) are loosened to `unknown`/`Record`.
 *
 * Preact core (`h`, `Fragment`, …) and the hooks are NOT declared here — the
 * consumers re-export them straight from the real `preact` / `preact/hooks`
 * packages. This module only declares the Trilium-specific surface
 * (`defineWidget` + the bundled UI components), kept honest against the real
 * `preactAPI` by a drift guard in `frontend_script_api_preact.ts`.
 *
 * Components are `export declare const` (ambient — no runtime value); prop types
 * are intentionally module-private so the only *value* exports are the runtime
 * members, which keeps the drift guard's `keyof typeof` clean.
 */
import type { ComponentChild, ComponentChildren, FunctionComponent, RefObject, VNode } from "preact";

/** A CSS style object (loose: property names are not validated). */
type Css = Record<string, string | number>;
/** A Trilium command name (loosened from the client's `CommandNames` union). */
type Cmd = string;

interface WidgetDefinition {
    parent: "left-pane" | "center-pane" | "note-detail-pane" | "right-pane";
    render: () => VNode;
    position?: number;
}
export declare function defineWidget(definition: WidgetDefinition): WidgetDefinition & { type: "preact-widget" };
export declare function defineLauncherWidget(definition: { render: () => VNode }): { type: "preact-launcher-widget"; render: () => VNode };

interface ActionButtonProps {
    text: string;
    icon: string;
    className?: string;
    titlePosition?: "top" | "right" | "bottom" | "left";
    triggerCommand?: Cmd;
    noIconActionClass?: boolean;
    frame?: boolean;
    active?: boolean;
    disabled?: boolean;
    onClick?: (e: MouseEvent) => void;
    onAuxClick?: (e: MouseEvent) => void;
    onContextMenu?: (e: MouseEvent) => void;
    style?: Css;
}
export declare const ActionButton: FunctionComponent<ActionButtonProps>;

interface AdmonitionProps {
    type: "warning" | "note" | "caution";
    children?: ComponentChildren;
    className?: string;
    style?: Css;
}
export declare const Admonition: FunctionComponent<AdmonitionProps>;

interface ButtonProps {
    text: string;
    name?: string;
    buttonRef?: RefObject<HTMLButtonElement>;
    className?: string;
    icon?: string;
    keyboardShortcut?: string;
    onClick?: () => void;
    kind?: "primary" | "secondary" | "lowProfile";
    disabled?: boolean;
    size?: "normal" | "small" | "micro";
    style?: Css;
    triggerCommand?: Cmd;
    title?: string;
}
export declare const Button: FunctionComponent<ButtonProps>;

interface CKEditorApi {
    focus(): void;
    setText(text: string): void;
}
interface CKEditorProps {
    apiRef: RefObject<CKEditorApi | undefined>;
    currentValue?: string;
    className: string;
    tabIndex?: number;
    config: unknown;
    editor: unknown;
    disableNewlines?: boolean;
    disableSpellcheck?: boolean;
    onChange?: (newValue?: string) => void;
    onClick?: (e: MouseEvent, pos?: unknown) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    onBlur?: () => void;
    onInitialized?: (editorInstance: unknown) => void;
}
export declare const CKEditor: FunctionComponent<CKEditorProps>;

interface CollapsibleProps {
    title: string;
    children?: ComponentChildren;
    initiallyExpanded?: boolean;
    className?: string;
}
export declare const Collapsible: FunctionComponent<CollapsibleProps>;

interface DropdownProps {
    id?: string;
    className?: string;
    buttonClassName?: string;
    buttonProps?: Record<string, unknown>;
    isStatic?: boolean;
    children?: ComponentChildren;
    title?: string;
    dropdownContainerStyle?: Css;
    dropdownContainerClassName?: string;
    dropdownContainerRef?: RefObject<HTMLDivElement | null>;
    hideToggleArrow?: boolean;
    iconAction?: boolean;
    noSelectButtonStyle?: boolean;
    noDropdownListStyle?: boolean;
    disabled?: boolean;
    text?: ComponentChildren;
    forceShown?: boolean;
    onShown?: () => void;
    onHidden?: () => void;
    dropdownOptions?: Record<string, unknown>;
    dropdownRef?: RefObject<unknown>;
    titlePosition?: "top" | "right" | "bottom" | "left";
    titleOptions?: Record<string, unknown>;
    mobileBackdrop?: boolean;
}
export declare const Dropdown: FunctionComponent<DropdownProps>;

interface FormCheckboxProps {
    name?: string;
    label: ComponentChildren;
    hint?: string;
    currentValue: boolean;
    disabled?: boolean;
    onChange(newValue: boolean): void;
    containerStyle?: Css;
}
export declare const FormCheckbox: FunctionComponent<FormCheckboxProps>;

interface FormDropdownListProps<T> extends Omit<DropdownProps, "children"> {
    values: T[];
    keyProperty: keyof T;
    titleProperty: keyof T;
    titleSuffixProperty?: keyof T;
    descriptionProperty?: keyof T;
    currentValue: string;
    onChange(newValue: string): void;
}
export declare function FormDropdownList<T>(props: FormDropdownListProps<T>): VNode<any>;

export declare const FormFileUploadButton: FunctionComponent<Omit<ButtonProps, "onClick"> & { onChange: (files: FileList | null) => void }>;
export declare const FormFileUploadActionButton: FunctionComponent<Omit<ActionButtonProps, "onClick"> & { onChange: (files: FileList | null) => void }>;

interface FormGroupProps {
    name: string;
    labelRef?: RefObject<HTMLLabelElement>;
    label?: string;
    title?: string;
    className?: string;
    error?: string;
    children: VNode<any>;
    description?: ComponentChildren;
    disabled?: boolean;
    style?: Css;
}
export declare const FormGroup: FunctionComponent<FormGroupProps>;

interface FormListItemProps {
    children?: ComponentChildren;
    icon?: string;
    value?: string;
    title?: string;
    active?: boolean;
    badges?: unknown[];
    disabled?: boolean;
    disabledTooltip?: string;
    checked?: boolean | null;
    selected?: boolean;
    container?: boolean;
    onClick?: (e: MouseEvent) => void;
    triggerCommand?: Cmd;
    description?: string;
    className?: string;
    rtl?: boolean;
    postContent?: ComponentChildren;
    itemRef?: RefObject<HTMLLIElement>;
}
export declare const FormListItem: FunctionComponent<FormListItemProps>;

export declare const FormDropdownDivider: FunctionComponent<{}>;

interface FormDropdownSubmenuProps {
    icon: string;
    title: ComponentChildren;
    children?: ComponentChildren;
    onDropdownToggleClicked?: () => void;
    dropStart?: boolean;
}
export declare const FormDropdownSubmenu: FunctionComponent<FormDropdownSubmenuProps>;

interface FormRadioGroupProps {
    name: string;
    currentValue?: string;
    values: ({ value: string; label: ComponentChildren; inlineDescription?: ComponentChildren } | false)[];
    onChange(newValue: string): void;
}
export declare const FormRadioGroup: FunctionComponent<FormRadioGroupProps>;

export declare const FormText: FunctionComponent<{ children?: ComponentChildren }>;

interface FormTextAreaProps {
    id?: string;
    currentValue: string;
    onChange?(newValue: string): void;
    onBlur?(newValue: string): void;
    inputRef?: RefObject<HTMLTextAreaElement>;
    className?: string;
    placeholder?: string;
    rows?: number;
    disabled?: boolean;
    readOnly?: boolean;
}
export declare const FormTextArea: FunctionComponent<FormTextAreaProps>;

interface FormTextBoxProps {
    id?: string;
    currentValue?: string;
    onChange?(newValue: string, validity: ValidityState): void;
    onBlur?(newValue: string): void;
    inputRef?: RefObject<HTMLInputElement>;
    type?: string;
    className?: string;
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    autoFocus?: boolean;
    name?: string;
}
export declare const FormTextBox: FunctionComponent<FormTextBoxProps>;

interface FormToggleProps {
    currentValue: boolean | null;
    onChange(newValue: boolean): void;
    switchOnName?: string;
    switchOnTooltip?: string;
    switchOffName?: string;
    switchOffTooltip?: string;
    helpPage?: string;
    disabled?: boolean;
    afterName?: ComponentChildren;
    id?: string;
}
export declare const FormToggle: FunctionComponent<FormToggleProps>;

interface IconProps {
    icon?: string;
    className?: string;
    onClick?: (e: MouseEvent) => void;
    title?: string;
    style?: Css;
}
export declare const Icon: FunctionComponent<IconProps>;

interface LinkButtonProps {
    onClick?: () => void;
    text: ComponentChild;
    triggerCommand?: Cmd;
}
export declare const LinkButton: FunctionComponent<LinkButtonProps>;

export declare const LoadingSpinner: FunctionComponent<{}>;

interface ModalProps {
    className: string;
    title?: ComponentChildren;
    customTitleBarButtons?: ({ title: string; iconClassName: string; onClick: (e: MouseEvent) => void } | null)[];
    size: "xl" | "lg" | "md" | "sm";
    children?: ComponentChildren;
    header?: ComponentChildren;
    footer?: ComponentChildren;
    footerStyle?: Css;
    footerAlignment?: "right" | "between";
    minWidth?: string;
    maxWidth?: number;
    zIndex?: number;
    scrollable?: boolean;
    onSubmit?: () => void;
    onShown?: () => void;
    onHidden: () => void;
    helpPageId?: string;
    modalRef?: RefObject<HTMLDivElement>;
    formRef?: RefObject<HTMLFormElement>;
    bodyStyle?: Css;
    show: boolean;
    stackable?: boolean;
    keepInDom?: boolean;
    noFocus?: boolean;
    sidebar?: ComponentChildren;
    isFullPageOnMobile?: boolean;
}
export declare const Modal: FunctionComponent<ModalProps>;

interface NoteAutocompleteProps {
    id?: string;
    inputRef?: RefObject<HTMLInputElement>;
    text?: string;
    placeholder?: string;
    container?: RefObject<HTMLElement | null | undefined>;
    containerStyle?: Css;
    opts?: Record<string, unknown>;
    onChange?: (suggestion: unknown) => void;
    onTextChange?: (text: string) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    onBlur?: (newValue: string) => void;
    noteIdChanged?: (noteId: string) => void;
    noteId?: string;
}
export declare const NoteAutocomplete: FunctionComponent<NoteAutocompleteProps>;

interface NoteLinkProps {
    className?: string;
    containerClassName?: string;
    notePath: string | string[];
    showNotePath?: boolean;
    showNoteIcon?: boolean;
    style?: Css;
    noPreview?: boolean;
    noTnLink?: boolean;
    highlightedTokens?: string[] | null;
    title?: string;
    viewScope?: unknown;
    noContextMenu?: boolean;
    onContextMenu?: (e: MouseEvent) => void;
}
export declare const NoteLink: FunctionComponent<NoteLinkProps>;

interface RawHtmlProps {
    className?: string;
    html?: string | HTMLElement;
    style?: Css;
    onClick?: (e: MouseEvent) => void;
    tabindex?: number;
    dir?: string;
    containerRef?: RefObject<HTMLSpanElement>;
}
export declare const RawHtml: FunctionComponent<RawHtmlProps>;

interface SliderProps {
    value: number;
    onChange(newValue: number): void;
    min?: number;
    max?: number;
    step?: number;
    title?: string;
}
export declare const Slider: FunctionComponent<SliderProps>;

interface RightPanelWidgetProps {
    id: string;
    title: string;
    children?: ComponentChildren;
    buttons?: ComponentChildren;
    containerRef?: RefObject<HTMLDivElement>;
    contextMenuItems?: unknown[];
    grow?: boolean;
}
export declare const RightPanelWidget: FunctionComponent<RightPanelWidgetProps>;
