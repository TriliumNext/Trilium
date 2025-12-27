import { ButtonView, FocusCycler, FocusTracker, KeystrokeHandler, LabelView, submitHandler, SwitchButtonView, View, ViewCollection, type FocusableView, type Locale } from 'ckeditor5';
import IconCheck from "@ckeditor/ckeditor5-icons/theme/icons/check.svg?raw";
import IconCancel from "@ckeditor/ckeditor5-icons/theme/icons/cancel.svg?raw";
import { extractDelimiters, hasDelimiters } from '../utils.js';
import MathView, { type MathViewOptions } from './mathview.js';
import MathInputView from './mathinputview.js';
import '../../theme/mathform.css';

export default class MainFormView extends View {
	public saveButtonView: ButtonView;
	public cancelButtonView: ButtonView;
	public displayButtonView: SwitchButtonView;

	public mathInputView: MathInputView;
	public mathView?: MathView;

	public focusTracker = new FocusTracker();
	public keystrokes = new KeystrokeHandler();
	private _focusables = new ViewCollection<FocusableView>();
	private _focusCycler: FocusCycler;

	constructor(
		locale: Locale,
		mathViewOptions: MathViewOptions,
		previewEnabled = false,
		popupClassName: Array<string> = []
	) {
		super( locale );
		const t = locale.t;

		// Create views
		this.mathInputView = new MathInputView( locale );
		this.saveButtonView = this._createButton( t( 'Save' ), IconCheck, 'ck-button-save', 'submit' );
		this.cancelButtonView = this._createButton( t( 'Cancel' ), IconCancel, 'ck-button-cancel' );
		this.cancelButtonView.delegate( 'execute' ).to( this, 'cancel' );
		this.displayButtonView = this._createDisplayButton( t );

		// Build children

		const children: Array<View> = [
			this.mathInputView,
			this.displayButtonView
		];

		if ( previewEnabled ) {
			const previewLabel = new LabelView( locale );
			previewLabel.text = t( 'Equation preview' );

			this.mathView = new MathView( locale, mathViewOptions );
			this.mathView.bind( 'display' ).to( this.displayButtonView, 'isOn' );

			children.push( previewLabel, this.mathView );
		}

		this._setupSync( previewEnabled );

		this.setTemplate( {
			tag: 'form',
			attributes: {
				class: [
					'ck',
					'ck-math-form',
					...popupClassName
				],
				tabindex: '-1',
				spellcheck: 'false'
			},
			children: [
				{
					tag: 'div',
					attributes: {
						class: [
							'ck-math-view'
						]
					},
					children
				},
				{
					tag: 'div',
					attributes: {
						class: [
							'ck-math-button-row'
						]
					},
					children: [
						this.saveButtonView,
						this.cancelButtonView
					]
				}
			]
		} );

		this._focusCycler = new FocusCycler( {
			focusables: this._focusables,
			focusTracker: this.focusTracker,
			keystrokeHandler: this.keystrokes,
			actions: {
				focusPrevious: 'shift + tab',
				focusNext: 'tab'
			}
		} );
	}

	public override render(): void {
		super.render();

		// Prevent default form submit event & trigger custom 'submit'
		submitHandler( {
			view: this
		} );

		const focusableViews = [
			this.mathInputView.latexTextAreaView,
			this.displayButtonView,
			this.saveButtonView,
			this.cancelButtonView
		];

		focusableViews.forEach( v => {
			this._focusables.add( v );
			if ( v.element ) {
				this.focusTracker.add( v.element );
			}
		} );

		this.mathInputView.on( 'mathfieldReady', () => {
			const mathfieldView = this.mathInputView.mathFieldFocusableView;
			if ( mathfieldView.element ) {
				if ( this._focusables.has( mathfieldView ) ) {
					this._focusables.remove( mathfieldView );
				}
				this._focusables.add( mathfieldView, 0 );
				this.focusTracker.add( mathfieldView.element );
			}
		} );

		if ( this.element ) {
			this.keystrokes.listenTo( this.element );
		}
	}

	public get equation(): string {
		return this.mathInputView.value ?? '';
	}

	public set equation( equation: string ) {
		const norm = equation.trim();
		this.mathInputView.value = norm.length ? norm : null;
		if ( this.mathView ) {
			this.mathView.value = norm;
		}
	}

	public focus(): void {
		this._focusCycler.focusFirst();
	}

	private _setupSync( previewEnabled: boolean ): void {
		this.mathInputView.on( 'change:value', () => {
			let eq = ( this.mathInputView.value ?? '' ).trim();

			if ( hasDelimiters( eq ) ) {
				const params = extractDelimiters( eq );
				eq = params.equation;
				this.displayButtonView.isOn = params.display;

				if ( this.mathInputView.value !== eq ) {
					this.mathInputView.value = eq.length ? eq : null;
				}
			}

			if ( previewEnabled && this.mathView && this.mathView.value !== eq ) {
				this.mathView.value = eq;
			}
		} );
	}

	private _createButton( label: string, icon: string, className: string, type?: 'submit' | 'button' ): ButtonView {
		const button = new ButtonView( this.locale );

		button.set( {
			label,
			icon,
			tooltip: true
		} );

		button.extendTemplate( {
			attributes: {
				class: className
			}
		} );

		if ( type ) {
			button.type = type;
		}

		return button;
	}

	private _createDisplayButton( t: ( str: string ) => string ): SwitchButtonView {
		const switchButton = new SwitchButtonView( this.locale );

		switchButton.set( {
			label: t( 'Display mode' ),
			withText: true
		} );

		switchButton.extendTemplate( {
			attributes: {
				class: 'ck-button-display-toggle'
			}
		} );

		switchButton.on( 'execute', () => {
			switchButton.isOn = !switchButton.isOn;
		} );

		return switchButton;
	}

	public hideKeyboard(): void {
		this.mathInputView.hideKeyboard();
	}
}
