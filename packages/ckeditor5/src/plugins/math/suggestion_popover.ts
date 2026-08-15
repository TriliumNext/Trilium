/**
 * Keeps MathLive's LaTeX suggestion popover on screen while a command is being typed.
 *
 * MathLive rebuilds the panel from scratch on every keystroke: it is a shared element, and each
 * update releases it — which takes the node out of the document — before asking for it again,
 * which builds a fresh one. The replacement arrives with no position and without the class that
 * shows it; MathLive only adds those from a 32ms timer. So between one letter and the next the
 * list blinks out of existence.
 *
 * Carrying the visible state and the position over to the replacement closes that gap: the new
 * panel appears where the old one stood, and the deferred pass the field's own render schedules
 * for the same keystroke moves it to where the caret has got to. MathLive's show timer then finds
 * the panel already visible and leaves it alone — including the scroll that keeps the highlighted
 * entry in view, which is why this does it too.
 */
const POPOVER_ID = 'mathlive-suggestion-popover';

/** Everything MathLive's positioning pass sets on the panel besides its coordinates. */
const CARRIED_CLASSES = [ 'is-visible', 'top-tip', 'bottom-tip', 'ML__popover--reverse-direction' ];

export function keepSuggestionPopoverSteady(): MutationObserver {
	const observer = new MutationObserver( records => {
		let removed: HTMLElement | null = null;
		let added: HTMLElement | null = null;

		for ( const record of records ) {
			removed = findPopover( record.removedNodes ) ?? removed;
			added = findPopover( record.addedNodes ) ?? added;
		}

		// A removal on its own is MathLive hiding the popover, which must stay hidden.
		if ( !removed || !added || added === removed || !removed.classList.contains( 'is-visible' ) ) {
			return;
		}

		for ( const className of CARRIED_CLASSES ) {
			added.classList.toggle( className, removed.classList.contains( className ) );
		}
		added.style.top = removed.style.top;
		added.style.left = removed.style.left;
		added.querySelector( '.ML__popover__current' )
			?.scrollIntoView( { block: 'nearest', inline: 'nearest' } );
	} );

	observer.observe( document.body, { childList: true } );
	return observer;
}

function findPopover( nodes: NodeList ): HTMLElement | null {
	for ( const node of nodes ) {
		if ( node instanceof HTMLElement && node.id === POPOVER_ID ) {
			return node;
		}
	}
	return null;
}
