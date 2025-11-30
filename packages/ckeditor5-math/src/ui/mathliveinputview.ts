import { View, type Locale } from 'ckeditor5';
import 'mathlive'; // Import side-effects only (registers the <math-field> tag)

/**
 * Interface describing the custom <math-field> element.
 */
interface MathFieldElement extends HTMLElement {
    value: string;
    readOnly: boolean;
    mathVirtualKeyboardPolicy: string;
    // Interface includes the shortcuts property
    inlineShortcuts: Record<string, string>;
}

/**
 * A wrapper for the MathLive <math-field> component.
 */
export default class MathLiveInputView extends View {
    /**
     * The current LaTeX value.
     * @observable
     */
    public declare value: string | null;

    /**
     * Read-only state.
     * @observable
     */
    public declare isReadOnly: boolean;

    /**
     * Reference to the DOM element.
     * Typed as MathFieldElement | null for proper TS support.
     */
    public mathfield: MathFieldElement | null = null;

    constructor( locale: Locale ) {
        super( locale );

        this.set( 'value', null );
        this.set( 'isReadOnly', false );

        this.setTemplate( {
            tag: 'div',
            attributes: {
                class: [ 'ck', 'ck-mathlive-input' ]
            }
        } );
    }

    public override render(): void {
        super.render();

        // 1. Create element with the specific type
        const mathfield = document.createElement( 'math-field' ) as MathFieldElement;

        // 2. Configure Options
        mathfield.mathVirtualKeyboardPolicy = 'manual';

        //Disable differential D
        mathfield.addEventListener( 'mount', () => {
            mathfield.inlineShortcuts = {
                ...mathfield.inlineShortcuts, // Safe to read now
                dx: 'dx',
                dy: 'dy',
                dt: 'dt'
            };
        } );


        // Disable sounds safely
        const MathfieldConstructor = customElements.get( 'math-field' );
        if ( MathfieldConstructor ) {
            const proto = MathfieldConstructor as any;
            if ( proto.soundsDirectory !== null ) proto.soundsDirectory = null;
            if ( proto.plonkSound !== null ) proto.plonkSound = null;
        }

        // 3. Set Initial State
        mathfield.value = this.value ?? '';
        mathfield.readOnly = this.isReadOnly;

        // 4. Bind Events (DOM -> Observable)
        mathfield.addEventListener( 'input', () => {
            const val = mathfield.value;
            this.value = val.length ? val : null;
        } );

        // 5. Bind Events (Observable -> DOM)
        this.on( 'change:value', ( _evt, _name, nextValue ) => {
            if ( mathfield.value !== nextValue ) {
                mathfield.value = nextValue ?? '';
            }
        } );

        this.on( 'change:isReadOnly', ( _evt, _name, nextValue ) => {
            mathfield.readOnly = nextValue;
        } );

        // 6. Mount to the wrapper view
        this.element?.appendChild( mathfield );
        this.mathfield = mathfield;
    }

    public focus(): void {
        this.mathfield?.focus();
    }

    public override destroy(): void {
        if ( this.mathfield ) {
            this.mathfield.remove();
            this.mathfield = null;
        }
        super.destroy();
    }
}
