import { View, type Locale } from 'ckeditor5';

interface MathFieldElement extends HTMLElement {
    value: string;
    readOnly: boolean;
    mathVirtualKeyboardPolicy: string;
    inlineShortcuts?: Record<string, string>;
}

export default class MathLiveInputView extends View {
    public declare value: string | null;
    public declare isReadOnly: boolean;
    public mathfield: MathFieldElement | null = null;

    constructor(locale: Locale) {
        super(locale);
        this.set('value', null);
        this.set('isReadOnly', false);

        this.setTemplate({
            tag: 'div',
            attributes: {
                class: ['ck', 'ck-mathlive-input']
            }
        });
    }

    public override render(): void {
        super.render();
        this._loadMathLive();
    }

    private async _loadMathLive(): Promise<void> {
        try {
            await import('mathlive');
            await customElements.whenDefined('math-field');

            // Configure global MathLive settings
            const MathfieldClass = customElements.get( 'math-field' ) as any;
            if ( MathfieldClass ) {
                MathfieldClass.soundsDirectory = null;
                MathfieldClass.plonkSound = null;
            }

            if (!this.element) return;

            this._createMathField();
        } catch (error) {
            console.error('MathLive load failed:', error);
            if (this.element) {
                this.element.textContent = 'Math editor unavailable';
            }
        }
    }

    private _createMathField(): void {
        if (!this.element) return;

        const mathfield = document.createElement('math-field') as MathFieldElement;

        // Instance-level config (no prototype pollution)
        mathfield.mathVirtualKeyboardPolicy = 'manual';

        // Configure shortcuts after mount
        mathfield.addEventListener('mount', () => {
            mathfield.inlineShortcuts = {
                ...mathfield.inlineShortcuts,
                dx: 'dx',
                dy: 'dy',
                dt: 'dt'
            };
        }, { once: true });

        // Initial state
        mathfield.value = this.value ?? '';
        mathfield.readOnly = this.isReadOnly;

        // DOM -> Observable
        mathfield.addEventListener('input', () => {
            const val = mathfield.value;
            this.value = val.length ? val : null;
        });

        // Observable -> DOM
        this.on('change:value', (_evt, _name, nextValue) => {
            if (mathfield.value !== nextValue) {
                mathfield.value = nextValue ?? '';
            }
        });

        this.on('change:isReadOnly', (_evt, _name, nextValue) => {
            mathfield.readOnly = nextValue;
        });

        this.element.appendChild(mathfield);
        this.mathfield = mathfield;
    }

    public focus(): void {
        this.mathfield?.focus();
    }

    public override destroy(): void {
        if (this.mathfield) {
            this.mathfield.remove();
            this.mathfield = null;
        }
        super.destroy();
    }
}
