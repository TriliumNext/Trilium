// A balloon anchored to the equation currently being edited. It exists only while a MathLive
// field is mounted: {@link MathLiveEdit} announces the session, and the balloon follows the
// field it is pinned to. Placeholder content for now — this is where the equation's own actions
// will live, so that they are reachable without MathLive's built-in corner menu.
import { ContextualBalloon, Plugin, View, type Locale } from 'ckeditor5';
import MathLiveEdit, {
	type MathLiveSessionEndEvent,
	type MathLiveSessionStartEvent
} from './math_live_edit.js';

export default class MathLiveBalloon extends Plugin {
	public static get requires() {
		return [ ContextualBalloon, MathLiveEdit ] as const;
	}

	public static get pluginName() {
		return 'MathLiveBalloon' as const;
	}

	private _view: MathLiveBalloonView | null = null;

	public init(): void {
		const mathLiveEdit = this.editor.plugins.get( MathLiveEdit );

		this.listenTo<MathLiveSessionStartEvent>( mathLiveEdit, 'sessionStart', ( _evt, { mathfield } ) => {
			this._show( mathfield );
		} );

		this.listenTo<MathLiveSessionEndEvent>( mathLiveEdit, 'sessionEnd', () => {
			this._hide();
		} );
	}

	public override destroy(): void {
		super.destroy();
		this._view?.destroy();
	}

	private _show( mathfield: HTMLElement ): void {
		const balloon = this.editor.plugins.get( ContextualBalloon );
		const view = this._getView();

		/* v8 ignore next 3 -- a second `sessionStart` without an intervening `sessionEnd` cannot
		   happen: MathLiveEdit commits the previous session before mounting a new field */
		if ( balloon.hasView( view ) ) {
			return;
		}

		// Pinned to the field rather than to the widget, so the balloon tracks the equation as
		// it grows while typing.
		balloon.add( { view, position: { target: mathfield } } );
	}

	private _hide(): void {
		const balloon = this.editor.plugins.get( ContextualBalloon );
		const view = this._view;

		/* v8 ignore next 3 -- `sessionEnd` only follows a `sessionStart`, which always adds the
		   view to the balloon */
		if ( !view || !balloon.hasView( view ) ) {
			return;
		}

		balloon.remove( view );
	}

	private _getView(): MathLiveBalloonView {
		this._view ??= new MathLiveBalloonView( this.editor.locale );
		return this._view;
	}
}

/**
 * The balloon's contents. Deliberately untranslated for now: the placeholder text is about to be
 * replaced by real controls, and an entry in the editor's dictionary would have to be removed
 * again with it.
 */
class MathLiveBalloonView extends View {
	constructor( locale: Locale ) {
		super( locale );

		const bind = this.bindTemplate;

		this.setTemplate( {
			tag: 'div',
			attributes: {
				class: [ 'ck', 'ck-math-live-balloon' ],
				tabindex: '-1'
			},
			children: [ { text: 'Hello world' } ],
			on: {
				// Keeps a click on the balloon from blurring the field, which would commit the
				// equation and take the balloon down with it.
				mousedown: bind.to( ( evt: Event ) => evt.preventDefault() )
			}
		} );
	}
}
