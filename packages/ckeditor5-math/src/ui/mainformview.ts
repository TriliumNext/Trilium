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

		this.saveButtonView = this._createButton( t( 'Save' ), IconCheck, 'ck-button-save' );
		this.saveButtonView.type = 'submit';

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
	 * Sets up split handlers for synchronization.
	 */
	private _setupInputSync( previewEnabled: boolean ): void {
		// Handler 1: MathLive -> Raw LaTeX
		this.mathLiveInputView.on( 'change:value', () => {
			let eq = ( this.mathLiveInputView.value ?? '' ).trim();

			// Delimiter Normalization
			if ( hasDelimiters( eq ) ) {
				const params = extractDelimiters( eq );
				eq = params.equation;
				this.displayButtonView.isOn = params.display;

				// UX Fix: If we stripped delimiters, update the source
				// so the visual editor doesn't show them.
				if ( this.mathLiveInputView.value !== eq ) {
					this.mathLiveInputView.value = eq;
				}
			}

			// Sync to Raw LaTeX
			if ( this.rawLatexInputView.value !== eq ) {
				this.rawLatexInputView.value = eq;
			}

			// Sync to Preview
			if ( previewEnabled && this.mathView && this.mathView.value !== eq ) {
				this.mathView.value = eq;
			}
		} );

		// Handler 2: Raw LaTeX -> MathLive
		this.rawLatexInputView.on( 'change:value', () => {
			const eq = ( this.rawLatexInputView.value ?? '' ).trim();
			const normalized = eq.length ? eq : null;

			// Sync to MathLive
			if ( this.mathLiveInputView.value !== normalized ) {
				this.mathLiveInputView.value = normalized;
			}

			// Sync to Preview
			if ( previewEnabled && this.mathView && this.mathView.value !== eq ) {
				this.mathView.value = eq;
			}
		} );
	}

	private _createButton( label: string, icon: string, className: string ): ButtonView {
		const btn = new ButtonView( this.locale );
		btn.set( { label, icon, tooltip: true } );
		btn.extendTemplate( { attributes: { class: className } } );
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
