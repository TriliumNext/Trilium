/**
 * exceljs exposes `Worksheet#dataValidations` at runtime — an instance of its `DataValidations`
 * class (`lib/doc/data-validations.js`) — but omits it from its published typings, where the field
 * is commented out of `WorksheetModel`. Declare it so the XLSX importer/exporter can read and write
 * validation rules without casting through `any`.
 *
 * This is a module rather than a free-floating `.d.ts` so that importing it pulls the augmentation
 * into the program; an unreferenced declaration file is only picked up by projects whose `include`
 * globs it, which is not every project that compiles these sources.
 */
import "exceljs";

declare module "exceljs" {
    interface DataValidations {
        /**
         * Validation config keyed by each token of a rule's `sqref`, a cell or a range; the patch in
         * `patches/exceljs@4.4.0.patch` stops exceljs from expanding a range into one key per cell.
         */
        model: Record<string, DataValidation | undefined>;
        add(address: string, validation: DataValidation): DataValidation;
        find(address: string): DataValidation | undefined;
        remove(address: string): void;
    }

    interface Worksheet {
        readonly dataValidations: DataValidations;
    }
}
