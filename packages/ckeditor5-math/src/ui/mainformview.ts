import {
	ButtonView,
	FocusCycler,
	LabelView,
	submitHandler,
	SwitchButtonView,
	View,
	ViewCollection,
	type FocusableView,
	Locale,
	FocusTracker,
	KeystrokeHandler
} from 'ckeditor5';
import IconCheck from '@ckeditor/ckeditor5-icons/theme/icons/check.svg?raw';
import IconCancel from '@ckeditor/ckeditor5-icons/theme/icons/cancel.svg?raw';
import { extractDelimiters, hasDelimiters } from '../utils.js';
import MathView, { type MathViewOptions } from './mathview.js';
import MathLiveInputView from './mathliveinputview.js';
import RawLatexInputView from './rawlatexinputview.js';
import '../../theme/mathform.css';

export default class MainFormView extends View {
	public saveButtonView: ButtonView;
	public cancelButtonView: ButtonView;
	public displayButtonView: SwitchButtonView;

	public mathLiveInputView: MathLiveInputView;
	public rawLatexInputView: RawLatexInputView;
	public mathView?: MathView;

	public focusTracker = new FocusTracker();
	public keystrokes = new KeystrokeHandler();
	private _focusables = new ViewCollection<FocusableView>();
	private _focusCycler: FocusCycler;

	constructor(
		locale: Locale,
		mathViewOptions: MathViewOptions,
		previewEnabled = false,
		popupClassName: string[] = []
	) {
		super( locale );
		const t = locale.t;

		// --- 1. View Initialization ---

		this.mathLiveInputView = new MathLiveInputView( locale );
		this.rawLatexInputView = new RawLatexInputView( locale );
		this.rawLatexInputView.label = t( 'LaTeX' );

		this.saveButtonView = this._createButton( t( 'Save' ), IconCheck, 'ck-button-save', 'submit' );

		this.cancelButtonView = this._createButton( t( 'Cancel' ), IconCancel, 'ck-button-cancel' );
		this.cancelButtonView.delegate( 'execute' ).to( this, 'cancel' );

		this.displayButtonView = this._createDisplayButton( t );

		// --- 2. Construct Children & Preview ---

		const children: View[] = [
			this.mathLiveInputView,
			this.rawLatexInputView,
			this.displayButtonView
		];

		if ( previewEnabled ) {
			const previewLabel = new LabelView( locale );
			previewLabel.text = t( 'Equation preview' );

			// Clean instantiation using the options object
			this.mathView = new MathView( locale, mathViewOptions );

			// Bind display mode: When button flips, preview updates automatically
			this.mathView.bind( 'display' ).to( this.displayButtonView, 'isOn' );

			children.push( previewLabel, this.mathView );
		}

		// --- 3. Sync Logic ---
		this._setupInputSync( previewEnabled );

		// --- 4. Template Setup ---
		this.setTemplate( {
			tag: 'form',
			attributes: {
				class: [ 'ck', 'ck-math-form', ...popupClassName ],
				tabindex: '-1',
				spellcheck: 'false'
			},
			children: [
				{
					tag: 'div',
					attributes: { class: [ 'ck-math-scroll' ] },
					children: [ { tag: 'div', attributes: { class: [ 'ck-math-view' ] }, children } ]
				},
				{
					tag: 'div',
					attributes: { class: [ 'ck-math-button-row' ] },
					children: [ this.saveButtonView, this.cancelButtonView ]
				}
			]
		} );

		// --- 5. Accessibility ---
		this._focusCycler = new FocusCycler( {
			focusables: this._focusables,
			focusTracker: this.focusTracker,
			keystrokeHandler: this.keystrokes,
			actions: { focusPrevious: 'shift + tab', focusNext: 'tab' }
		} );
	}

	public override render(): void {
		super.render();

		submitHandler( { view: this } );

		// Register focusables
		[
			this.mathLiveInputView,
			this.rawLatexInputView,
			this.displayButtonView,
			this.saveButtonView,
			this.cancelButtonView
		].forEach( v => {
			if ( v.element ) {
				this._focusables.add( v );
				this.focusTracker.add( v.element );
			}
		} );

		if ( this.element ) this.keystrokes.listenTo( this.element );
	}

	public get equation(): string {
		return this.mathLiveInputView.value ?? '';
	}

	public set equation( equation: string ) {
		const norm = equation.trim();
		// Direct updates to the "source of truth"
		this.mathLiveInputView.value = norm.length ? norm : null;
		this.rawLatexInputView.value = norm;
		if ( this.mathView ) this.mathView.value = norm;
	}

	public focus(): void {
		this._focusCycler.focusFirst();
	}

	/**
	 * Checks if a view currently has focus.
	 */
	private _isViewFocused(view: View): boolean {
		const el = view.element;
		const active = document.activeElement;
		return !!(el && active && el.contains(active));
	}

	/**
	 * Sets up synchronization with Focus Gating.
	 */
	private _setupInputSync(previewEnabled: boolean): void {
		const updatePreview = (eq: string) => {
			if (previewEnabled && this.mathView && this.mathView.value !== eq) {
				this.mathView.value = eq;
			}
		};

		// Handler 1: MathLive -> Raw LaTeX + Preview
		this.mathLiveInputView.on('change:value', () => {
			let eq = (this.mathLiveInputView.value ?? '').trim();

			// Strip delimiters if present (e.g. pasted content)
			if (hasDelimiters(eq)) {
				const params = extractDelimiters(eq);
				eq = params.equation;
				this.displayButtonView.isOn = params.display;

				// Only strip delimiters if not actively editing
				if (!this._isViewFocused(this.mathLiveInputView) && this.mathLiveInputView.value !== eq) {
					this.mathLiveInputView.value = eq;
				}
			}

			// Sync to Raw LaTeX only if user isn't typing there
			if (!this._isViewFocused(this.rawLatexInputView) && this.rawLatexInputView.value !== eq) {
				this.rawLatexInputView.value = eq;
			}

			updatePreview(eq);
		});

		// Handler 2: Raw LaTeX -> MathLive + Preview
		this.rawLatexInputView.on('change:value', () => {
			const eq = (this.rawLatexInputView.value ?? '').trim();
			const normalized = eq.length ? eq : null;

			// Sync to MathLive only if user isn't interacting with it
			if (!this._isViewFocused(this.mathLiveInputView) && this.mathLiveInputView.value !== normalized) {
				this.mathLiveInputView.value = normalized;
			}

			updatePreview(eq);
		});
	}

	private _createButton( label: string, icon: string, className: string, type?: 'submit' | 'button' ): ButtonView {
		const btn = new ButtonView( this.locale );
		btn.set( { label, icon, tooltip: true } );
		btn.extendTemplate( { attributes: { class: className } } );
		if (type) btn.type = type;
		return btn;
	}

	private _createDisplayButton( t: ( str: string ) => string ): SwitchButtonView {
		const btn = new SwitchButtonView( this.locale );
		btn.set( { label: t( 'Display mode' ), withText: true } );
		btn.extendTemplate( { attributes: { class: 'ck-button-display-toggle' } } );

		btn.on( 'execute', () => {
			btn.isOn = !btn.isOn;
			// mathView updates automatically via bind()
		} );
		return btn;
	}
}
