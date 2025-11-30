import { LabeledFieldView, createLabeledTextarea, type Locale, type TextareaView } from 'ckeditor5';

/**
 * A labeled textarea view for direct LaTeX code editing.
 */
export default class RawLatexInputView extends LabeledFieldView<TextareaView> {
    /**
     * The current LaTeX value.
     * @observable
     */
    public declare value: string;

    /**
     * Whether the input is in read-only mode.
     * @observable
     */
    public declare isReadOnly: boolean;

    constructor( locale: Locale ) {
        super( locale, createLabeledTextarea );

        this.set( 'value', '' );
        this.set( 'isReadOnly', false );

        const fieldView = this.fieldView;

        // 1. Sync: DOM (Textarea) -> Observable
        fieldView.on( 'input', () => {
            // We cast strictly to HTMLTextAreaElement to access '.value' safely
            const textarea = fieldView.element as HTMLTextAreaElement;
            if ( textarea ) {
                this.value = textarea.value;
            }
        } );

        // 2. Sync: Observable -> DOM (Textarea)
        this.on( 'change:value', () => {
            const textarea = fieldView.element as HTMLTextAreaElement;
            // Check for difference to avoid cursor jumping
            if ( textarea && textarea.value !== this.value ) {
                textarea.value = this.value;
            }
        } );

        // 3. Sync: ReadOnly State
        this.on( 'change:isReadOnly', ( _evt, _name, nextValue ) => {
            fieldView.isReadOnly = nextValue;
        } );
    }

    public override render(): void {
        super.render();
    }
}
