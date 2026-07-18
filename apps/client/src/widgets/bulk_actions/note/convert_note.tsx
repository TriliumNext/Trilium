import { NOTE_CONVERSION_IDS, NoteConversionId, RISKY_NOTE_CONVERSION_IDS } from "@triliumnext/commons";
import { useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import FormSelect from "../../react/FormSelect";
import AbstractBulkAction, { ActionDefinition } from "../abstract_bulk_action";
import BulkAction from "../BulkAction";

function ConvertNoteBulkActionComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition }) {
    const [ conversion, setConversion ] = useState<string>(actionDef.conversion ?? "");

    // Evaluate labels on render so they follow runtime language changes.
    const conversionOptions: { value: NoteConversionId | ""; title: string }[] = [
        { value: "", title: t("convert_note.choose_conversion") },
        ...NOTE_CONVERSION_IDS.map((value) => ({ value, title: t(`convert_note.conversion_${value}`) }))
    ];

    // Update the in-memory action immediately (not debounced) so the confirmation prompt and the
    // executed payload both use the live choice, without waiting for the async label save to
    // round-trip through the server.
    function onChange(value: string) {
        setConversion(value);
        bulkAction.actionDef.conversion = value;
        void bulkAction.saveAction({ conversion: value });
    }

    return (
        <BulkAction
            bulkAction={bulkAction}
            label={t("convert_note.convert_note_to")}
            helpText={<p>{t("convert_note.help_text")}</p>}
        >
            <FormSelect
                values={conversionOptions}
                keyProperty="value"
                titleProperty="title"
                currentValue={conversion}
                onChange={onChange}
            />
        </BulkAction>
    );
}

export default class ConvertNoteBulkAction extends AbstractBulkAction {

    doRender() {
        return <ConvertNoteBulkActionComponent bulkAction={this} actionDef={this.actionDef} />;
    }

    getConfirmationMessage() {
        // Only warn once a conversion has actually been selected.
        const { conversion } = this.actionDef;
        if (!conversion) {
            return null;
        }
        return RISKY_NOTE_CONVERSION_IDS.includes(conversion as NoteConversionId)
            ? t("convert_note.warning_risky")
            : t("convert_note.warning");
    }

    static get actionName() {
        return "convertNote";
    }

    static get actionTitle() {
        return t("convert_note.convert_note");
    }
}
