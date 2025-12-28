import { Fragment, h, VNode } from "preact";
import * as hooks from "preact/hooks";

import ActionButton from "../widgets/react/ActionButton";
import Admonition from "../widgets/react/Admonition";
import Button from "../widgets/react/Button";
import CKEditor from "../widgets/react/CKEditor";
import Collapsible from "../widgets/react/Collapsible";
import Dropdown from "../widgets/react/Dropdown";
import FormCheckbox from "../widgets/react/FormCheckbox";
import FormDropdownList from "../widgets/react/FormDropdownList";
import { FormFileUploadActionButton, FormFileUploadButton } from "../widgets/react/FormFileUpload";
import FormGroup from "../widgets/react/FormGroup";
import { FormDropdownDivider, FormDropdownSubmenu, FormListItem } from "../widgets/react/FormList";
import FormRadioGroup from "../widgets/react/FormRadioGroup";
import FormText from "../widgets/react/FormText";
import FormTextArea from "../widgets/react/FormTextArea";
import FormTextBox from "../widgets/react/FormTextBox";
import FormToggle from "../widgets/react/FormToggle";
import * as triliumHooks from "../widgets/react/hooks";
import Icon from "../widgets/react/Icon";
import LinkButton from "../widgets/react/LinkButton";
import LoadingSpinner from "../widgets/react/LoadingSpinner";
import Modal from "../widgets/react/Modal";
import NoteAutocomplete from "../widgets/react/NoteAutocomplete";
import NoteLink from "../widgets/react/NoteLink";
import RawHtml from "../widgets/react/RawHtml";
import Slider from "../widgets/react/Slider";
import RightPanelWidget from "../widgets/sidebar/RightPanelWidget";

export interface WidgetDefinition {
    parent: "right-pane",
    render: () => VNode,
    position?: number,
}

export interface WidgetDefinitionWithType extends WidgetDefinition {
    type: "preact-widget"
}

export interface LauncherWidgetDefinitionWithType {
    type: "preact-launcher-widget"
    render: () => VNode
}

export const preactAPI = Object.freeze({
    // Core
    h,
    Fragment,

    /**
     * Method that must be run for widget scripts that run on Preact, using JSX. The method just returns the same definition, reserved for future typechecking and perhaps validation purposes.
     *
     * @param definition the widget definition.
     */
    defineWidget(definition: WidgetDefinition) {
        return {
            type: "preact-widget",
            ...definition
        };
    },

    defineLauncherWidget(definition: Omit<LauncherWidgetDefinitionWithType, "type">) {
        return {
            type: "preact-launcher-widget",
            ...definition
        };
    },

    // Basic widgets
    ActionButton,
    Admonition,
    Button,
    CKEditor,
    Collapsible,
    Dropdown,
    FormCheckbox,
    FormDropdownList,
    FormFileUploadButton, FormFileUploadActionButton,
    FormGroup,
    FormListItem, FormDropdownDivider, FormDropdownSubmenu,
    FormRadioGroup,
    FormText,
    FormTextArea,
    FormTextBox,
    FormToggle,
    Icon,
    LinkButton,
    LoadingSpinner,
    Modal,
    NoteAutocomplete,
    NoteLink,
    RawHtml,
    Slider,

    // Specialized widgets
    RightPanelWidget,

    ...hooks,
    ...triliumHooks
});
