// Whether a matrix action applies where the caret currently is, and what MathLive calls it,
// asked of MathLive itself.
//
// The answer depends on the environment enclosing the caret and on its minimum and maximum shape
// — `cases` has a fixed column count, so its columns cannot be added to or removed — and none of
// that is public API. What *is* public is `menuItems`: it hands back the declarations of
// MathLive's own context menu, whose `visible`/`enabled`/`label` are closures already bound to
// this field. Reading them keeps our buttons in step with the menu they were lifted from, for
// free. The actions themselves go through `executeCommand()` with the documented command names,
// which is what the declarations do internally anyway.

/** The MathLive menu ids behind the matrix actions the balloon offers. */
export type MatrixActionId =
	| 'add-row-above'
	| 'add-row-below'
	| 'add-column-before'
	| 'add-column-after'
	| 'delete-row'
	| 'delete-column'
	| 'environment-no-border'
	| 'environment-parentheses'
	| 'environment-brackets'
	| 'environment-bar'
	| 'environment-braces';

export interface MatrixActionState {
	/** Whether the action applies at all; MathLive hides rather than disables these. */
	visible: boolean;

	/** Whether it can run — deleting the last row of a matrix cannot. */
	enabled: boolean;
}

/** Neither, for a field that has no menu to ask (not mounted yet, or already torn down). */
export const MATRIX_ACTION_UNAVAILABLE: MatrixActionState = { visible: false, enabled: false };

export function getMatrixActionState( field: MatrixMenuField, id: MatrixActionId ): MatrixActionState {
	const path = findMenuItem( readMenuItems( field ), id );

	if ( !path ) {
		return MATRIX_ACTION_UNAVAILABLE;
	}

	// Both default to true where a declaration leaves them out, as they do in MathLive's own
	// menu. A submenu's entries are reachable only through their parent, which is where the
	// borders group keeps its condition — the entries themselves declare none — so the whole
	// path has to agree. An invisible item is never reachable, so it is never enabled either.
	const visible = path.every( item => resolveDynamic( item.visible, true ) );
	return { visible, enabled: visible && path.every( item => resolveDynamic( item.enabled, true ) ) };
}

/**
 * What MathLive calls the action, or `null` where there is nothing to ask. Worth using for the
 * actions CKEditor has no wording of its own for: the label comes localized, and for the ones
 * that draw their own preview it is the preview.
 */
export function getMatrixActionLabel( field: MatrixMenuField, id: MatrixActionId ): string | null {
	const path = findMenuItem( readMenuItems( field ), id );
	const item = path?.[ path.length - 1 ];

	return item ? resolveDynamic( item.label, null ) : null;
}

/**
 * The part of a `<math-field>` this module needs. MathLive's own `MenuItem` type is not exported
 * from the package, so the declarations are described structurally.
 */
export interface MatrixMenuField {
	readonly menuItems?: readonly MathLiveMenuItem[];
}

interface MathLiveMenuItem {
	id?: string;
	label?: DynamicValue<string>;
	visible?: DynamicValue<boolean>;
	enabled?: DynamicValue<boolean>;
	submenu?: readonly MathLiveMenuItem[];
}

/** MathLive re-evaluates these per menu opening, optionally against the keyboard modifiers. */
type DynamicValue<T> = T | ( ( modifiers: KeyboardModifiers ) => T );

interface KeyboardModifiers {
	alt: boolean;
	control: boolean;
	shift: boolean;
	meta: boolean;
}

/** No modifier is held: the balloon's buttons have no alternate, modifier-held behaviour. */
const NO_MODIFIERS: KeyboardModifiers = { alt: false, control: false, shift: false, meta: false };

function readMenuItems( field: MatrixMenuField ): readonly MathLiveMenuItem[] {
	try {
		// Throws ("Mathfield not mounted") when read too early or after teardown, and builds the
		// default menu on first access.
		return field.menuItems ?? [];
	} catch {
		return [];
	}
}

/** The item of that id and every submenu it sits under, outermost first. */
function findMenuItem(
	items: readonly MathLiveMenuItem[],
	id: string
): readonly MathLiveMenuItem[] | null {
	for ( const item of items ) {
		if ( item.id === id ) {
			return [ item ];
		}

		const nested = item.submenu && findMenuItem( item.submenu, id );
		if ( nested ) {
			return [ item, ...nested ];
		}
	}

	return null;
}

function resolveDynamic<T>( value: DynamicValue<T> | undefined, fallback: T ): T {
	if ( value === undefined ) {
		return fallback;
	}
	return typeof value === 'function' ? ( value as ( modifiers: KeyboardModifiers ) => T )( NO_MODIFIERS ) : value;
}
