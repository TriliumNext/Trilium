// What MathLive's own context menu would say about the caret's surroundings: which of its
// actions apply, what it calls them, and — where we have no public command to call instead —
// running them.
//
// Whether an action applies depends on the environment enclosing the caret, on its minimum and
// maximum shape (`cases` has a fixed column count, so its columns cannot be added to or removed)
// and on the selection, none of which is public API. What *is* public is `menuItems`: it hands
// back the declarations of MathLive's own menu, whose `visible`/`enabled`/`label` are closures
// already bound to this field. Reading them keeps the balloon in step with the menu its actions
// were lifted from, for free — including the labels that render a preview of what the entry
// would insert.

/** The MathLive menu ids the balloon offers, by the group they belong to. */
export type MathLiveMenuItemId =
	// Rows and columns of an array.
	| 'add-row-above'
	| 'add-row-below'
	| 'add-column-before'
	| 'add-column-after'
	| 'delete-row'
	| 'delete-column'
	// The brackets around one.
	| 'environment-no-border'
	| 'environment-parentheses'
	| 'environment-brackets'
	| 'environment-bar'
	| 'environment-braces'
	// Structures to insert at the caret, and the group they sit in.
	| 'insert'
	| 'insert-abs'
	| 'insert-nth-root'
	| 'insert-log-base'
	| 'insert-derivative'
	| 'insert-nth-derivative'
	| 'insert-integral'
	| 'insert-sum'
	| 'insert-product'
	| 'insert-modulus'
	| 'insert-argument'
	| 'insert-real-part'
	| 'insert-imaginary-part'
	| 'insert-conjugate';

export interface MathLiveMenuItemState {
	/** Whether the action applies at all; MathLive hides rather than disables these. */
	visible: boolean;

	/** Whether it can run — deleting the last row of a matrix cannot. */
	enabled: boolean;
}

/** Neither, for a field that has no menu to ask (not mounted yet, or already torn down). */
export const MENU_ITEM_UNAVAILABLE: MathLiveMenuItemState = { visible: false, enabled: false };

export function getMenuItemState( field: MathLiveMenuField, id: MathLiveMenuItemId ): MathLiveMenuItemState {
	const path = findMenuItem( readMenuItems( field ), id );

	if ( !path ) {
		return MENU_ITEM_UNAVAILABLE;
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
 * actions CKEditor has no wording of its own to reuse: the label comes localized, and for the
 * ones that draw their own preview it *is* the preview — a fragment of HTML rather than text,
 * which is why the insert group renders its labels through {@link MathLiveLabelView}.
 */
export function getMenuItemLabel( field: MathLiveMenuField, id: MathLiveMenuItemId ): string | null {
	const item = lastOf( findMenuItem( readMenuItems( field ), id ) );

	return item ? resolveDynamic( item.label, null ) : null;
}

/** One entry of a submenu, as {@link getSubmenuEntries} reads it. */
export interface MathLiveSubmenuEntry {
	/** The heading's caption, or the entry's label — markup, for the ones that draw a preview. */
	label: string | null;

	/** A heading has no id and nothing to run: it captions the entries that follow it. */
	id: string | null;
	isHeading: boolean;
}

/**
 * A submenu's entries in the order MathLive lists them, headings included and dividers dropped.
 * Reading the group's shape rather than restating it keeps the captions localized and the
 * grouping upstream's — the insert group is MathLive's own three sections, its own order.
 */
export function getSubmenuEntries( field: MathLiveMenuField, id: MathLiveMenuItemId ): MathLiveSubmenuEntry[] {
	const parent = lastOf( findMenuItem( readMenuItems( field ), id ) );

	return ( parent?.submenu ?? [] )
		.filter( item => item.type !== 'divider' )
		.map( item => ( {
			label: resolveDynamic( item.label, null ),
			id: item.id ?? null,
			isHeading: item.type === 'heading'
		} ) );
}

/**
 * Runs the entry's own handler — the fallback for actions MathLive exposes no command for, such
 * as everything under `insert`, whose LaTeX lives only inside these closures. Prefer
 * `executeCommand()` wherever a documented command exists.
 *
 * @returns `false` when the field has no such entry to run.
 */
export function runMenuItem( field: MathLiveMenuField, id: MathLiveMenuItemId ): boolean {
	const item = lastOf( findMenuItem( readMenuItems( field ), id ) );

	if ( !item?.onMenuSelect ) {
		return false;
	}

	item.onMenuSelect( { target: undefined, modifiers: NO_MODIFIERS, id } );
	return true;
}

/**
 * The part of a `<math-field>` this module needs. MathLive's own `MenuItem` type is not exported
 * from the package, so the declarations are described structurally.
 */
export interface MathLiveMenuField {
	readonly menuItems?: readonly MathLiveMenuItem[];
}

interface MathLiveMenuItem {
	id?: string;

	/** Absent for a plain command; a submenu's own entries can also caption or separate. */
	type?: 'command' | 'divider' | 'heading' | 'submenu';
	label?: DynamicValue<string>;
	visible?: DynamicValue<boolean>;
	enabled?: DynamicValue<boolean>;
	submenu?: readonly MathLiveMenuItem[];
	onMenuSelect?: ( args: {
		target: EventTarget | undefined;
		modifiers: KeyboardModifiers;
		id?: string;
	} ) => void;
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

function readMenuItems( field: MathLiveMenuField ): readonly MathLiveMenuItem[] {
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

function lastOf( path: readonly MathLiveMenuItem[] | null ): MathLiveMenuItem | null {
	return path ? path[ path.length - 1 ] : null;
}

function resolveDynamic<T>( value: DynamicValue<T> | undefined, fallback: T ): T {
	if ( value === undefined ) {
		return fallback;
	}
	return typeof value === 'function' ? ( value as ( modifiers: KeyboardModifiers ) => T )( NO_MODIFIERS ) : value;
}
