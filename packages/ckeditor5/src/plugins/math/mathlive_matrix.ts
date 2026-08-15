// Whether a matrix action applies where the caret currently is, asked of MathLive itself.
//
// The answer depends on the environment enclosing the caret and on its minimum and maximum shape
// — `cases` has a fixed column count, so its columns cannot be added to or removed — and none of
// that is public API. What *is* public is `menuItems`: it hands back the declarations of
// MathLive's own context menu, whose `visible`/`enabled` are closures already bound to this
// field. Reading them keeps our buttons in step with the menu they were lifted from, for free.
//
// The actions themselves go through `executeCommand()` with the documented command names, which
// is what the declarations do internally anyway.

/** The MathLive menu ids behind the matrix actions the balloon offers. */
export type MatrixActionId =
	| 'add-row-above'
	| 'add-row-below'
	| 'add-column-before'
	| 'add-column-after'
	| 'delete-row'
	| 'delete-column';

export interface MatrixActionState {
	/** Whether the action applies at all; MathLive hides rather than disables these. */
	visible: boolean;

	/** Whether it can run — deleting the last row of a matrix cannot. */
	enabled: boolean;
}

/** Neither, for a field that has no menu to ask (not mounted yet, or already torn down). */
export const MATRIX_ACTION_UNAVAILABLE: MatrixActionState = { visible: false, enabled: false };

export function getMatrixActionState( field: MatrixMenuField, id: MatrixActionId ): MatrixActionState {
	const item = readMenuItems( field ).find( candidate => candidate.id === id );

	if ( !item ) {
		return MATRIX_ACTION_UNAVAILABLE;
	}

	// Both default to true when the declaration leaves them out, as they do in MathLive's own
	// menu; an invisible item is never reachable, so it is never enabled either.
	const visible = resolveDynamic( item.visible );
	return { visible, enabled: visible && resolveDynamic( item.enabled ) };
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
	visible?: DynamicValue<boolean>;
	enabled?: DynamicValue<boolean>;
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

function resolveDynamic( value: DynamicValue<boolean> | undefined ): boolean {
	if ( value === undefined ) {
		return true;
	}
	return typeof value === 'function' ? value( NO_MODIFIERS ) : value;
}
