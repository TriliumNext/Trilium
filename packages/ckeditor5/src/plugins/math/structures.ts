// The structures the equation balloon offers as galleries, grouped as OneNote's equation ribbon
// groups its own eleven. MathLive's insert menu covers a handful of these and leaves the rest to
// be typed — `/` for a fraction, `^` for a script, `(` for a bracket. Typing them is faster once
// you know; nothing in the editor ever tells you, which is the same case the symbol gallery makes.
//
// Two forms of each entry, the way MathLive describes its own insert menu:
//
// - `insert` is typed into the field, with `#?` marking each placeholder for the caret to land in
//   and `Tab` to walk between.
// - `preview` is what the entry draws, written out with named letters rather than empty boxes —
//   `\sqrt[n]{x}`, not `\sqrt[■]{■}`. That is MathLive's own convention for these
//   (`\int_a^b f(x)\,\mathrm{d}x`), and it is also the entry's tooltip: real LaTeX for the thing
//   as drawn, and the same in every language.
//
// Accent and Matrix are OneNote's other two galleries. They are not here because the balloon
// already has something better for each: MathLive's accents redraw around the current selection,
// and the matrix picker is a grid rather than a handful of fixed sizes.

export type MathStructureSectionId =
	| 'fraction'
	| 'script'
	| 'radical'
	| 'integral'
	| 'largeop'
	| 'bracket'
	| 'function'
	| 'limitlog'
	| 'operator';

export interface MathStructure {
	/** Typed at the caret; each `#?` is a placeholder to fill in. */
	insert: string;

	/** What the entry draws, and what it is called: the same LaTeX with letters in the slots. */
	preview: string;
}

export interface MathStructureSection {
	id: MathStructureSectionId;

	/** The face of the section's toolbar button, as plain text — a dropdown label is a text node. */
	glyph: string;

	structures: readonly MathStructure[];
}

export const MATH_STRUCTURE_SECTIONS: readonly MathStructureSection[] = [
	{
		id: 'fraction',
		glyph: '½',
		structures: [
			{ insert: '\\frac{#?}{#?}', preview: '\\frac{a}{b}' },
			{ insert: '#?/#?', preview: 'a/b' },
			{ insert: '\\frac{\\mathrm{d}#?}{\\mathrm{d}#?}', preview: '\\frac{\\mathrm{d}y}{\\mathrm{d}x}' },
			{ insert: '\\frac{\\partial #?}{\\partial #?}', preview: '\\frac{\\partial y}{\\partial x}' },
			{ insert: '\\frac{\\Delta #?}{\\Delta #?}', preview: '\\frac{\\Delta y}{\\Delta x}' },
			{ insert: '\\frac{1}{2}', preview: '\\frac{1}{2}' },
			{ insert: '\\frac{1}{3}', preview: '\\frac{1}{3}' },
			{ insert: '\\frac{1}{4}', preview: '\\frac{1}{4}' },
			{ insert: '\\frac{\\pi}{2}', preview: '\\frac{\\pi}{2}' }
		]
	},
	{
		id: 'script',
		glyph: 'xⁿ',
		structures: [
			{ insert: '#?^{#?}', preview: 'x^{n}' },
			{ insert: '#?_{#?}', preview: 'x_{n}' },
			{ insert: '#?_{#?}^{#?}', preview: 'x_{i}^{n}' },
			{ insert: '{}_{#?}^{#?}#?', preview: '{}_{a}^{b}x' },
			{ insert: '#?^{2}', preview: 'x^{2}' },
			{ insert: '#?^{3}', preview: 'x^{3}' },
			{ insert: '#?_{i,j}', preview: 'x_{i,j}' },
			{ insert: 'e^{#?}', preview: 'e^{x}' }
		]
	},
	{
		id: 'radical',
		glyph: '√',
		structures: [
			{ insert: '\\sqrt{#?}', preview: '\\sqrt{x}' },
			{ insert: '\\sqrt[3]{#?}', preview: '\\sqrt[3]{x}' },
			{ insert: '\\sqrt[4]{#?}', preview: '\\sqrt[4]{x}' },
			{ insert: '\\sqrt[#?]{#?}', preview: '\\sqrt[n]{x}' },
			{ insert: '\\sqrt{#?^2+#?^2}', preview: '\\sqrt{a^2+b^2}' }
		]
	},
	{
		id: 'integral',
		glyph: '∫',
		structures: [
			{ insert: '\\int #?\\,\\mathrm{d}#?', preview: '\\int f\\,\\mathrm{d}x' },
			{ insert: '\\int_{#?}^{#?}#?\\,\\mathrm{d}#?', preview: '\\int_{a}^{b} f\\,\\mathrm{d}x' },
			{ insert: '\\int_{0}^{\\infty}#?\\,\\mathrm{d}#?', preview: '\\int_{0}^{\\infty} f\\,\\mathrm{d}x' },
			{
				insert: '\\int_{-\\infty}^{\\infty}#?\\,\\mathrm{d}#?',
				preview: '\\int_{-\\infty}^{\\infty} f\\,\\mathrm{d}x'
			},
			{ insert: '\\iint #?\\,\\mathrm{d}#?', preview: '\\iint f\\,\\mathrm{d}A' },
			{ insert: '\\iiint #?\\,\\mathrm{d}#?', preview: '\\iiint f\\,\\mathrm{d}V' },
			{ insert: '\\oint #?\\,\\mathrm{d}#?', preview: '\\oint f\\,\\mathrm{d}s' }
		]
	},
	{
		id: 'largeop',
		glyph: '∑',
		structures: [
			{ insert: '\\sum_{#?}^{#?}#?', preview: '\\sum_{i=1}^{n} x_i' },
			{ insert: '\\sum_{#?}#?', preview: '\\sum_{i} x_i' },
			{ insert: '\\prod_{#?}^{#?}#?', preview: '\\prod_{i=1}^{n} x_i' },
			{ insert: '\\coprod_{#?}^{#?}#?', preview: '\\coprod_{i=1}^{n} x_i' },
			{ insert: '\\bigcup_{#?}^{#?}#?', preview: '\\bigcup_{i=1}^{n} A_i' },
			{ insert: '\\bigcap_{#?}^{#?}#?', preview: '\\bigcap_{i=1}^{n} A_i' },
			{ insert: '\\bigvee_{#?}^{#?}#?', preview: '\\bigvee_{i=1}^{n} p_i' },
			{ insert: '\\bigwedge_{#?}^{#?}#?', preview: '\\bigwedge_{i=1}^{n} p_i' },
			{ insert: '\\binom{#?}{#?}', preview: '\\binom{n}{k}' }
		]
	},
	{
		id: 'bracket',
		glyph: '()',
		structures: [
			{ insert: '\\left(#?\\right)', preview: '\\left(x\\right)' },
			{ insert: '\\left[#?\\right]', preview: '\\left[x\\right]' },
			{ insert: '\\left\\{#?\\right\\}', preview: '\\left\\{x\\right\\}' },
			{ insert: '\\left\\langle#?\\right\\rangle', preview: '\\left\\langle x\\right\\rangle' },
			{ insert: '\\left\\lceil#?\\right\\rceil', preview: '\\left\\lceil x\\right\\rceil' },
			{ insert: '\\left\\lfloor#?\\right\\rfloor', preview: '\\left\\lfloor x\\right\\rfloor' },
			{ insert: '\\left|#?\\right|', preview: '\\left|x\\right|' },
			{ insert: '\\left\\|#?\\right\\|', preview: '\\left\\|x\\right\\|' },
			{
				insert: '\\begin{cases}#? & #?\\\\#? & #?\\end{cases}',
				preview: '\\begin{cases}a & x<0\\\\b & x\\ge0\\end{cases}'
			}
		]
	},
	{
		id: 'function',
		glyph: 'ƒ',
		structures: [
			{ insert: '\\sin(#?)', preview: '\\sin(x)' },
			{ insert: '\\cos(#?)', preview: '\\cos(x)' },
			{ insert: '\\tan(#?)', preview: '\\tan(x)' },
			{ insert: '\\csc(#?)', preview: '\\csc(x)' },
			{ insert: '\\sec(#?)', preview: '\\sec(x)' },
			{ insert: '\\cot(#?)', preview: '\\cot(x)' },
			{ insert: '\\sin^{-1}(#?)', preview: '\\sin^{-1}(x)' },
			{ insert: '\\cos^{-1}(#?)', preview: '\\cos^{-1}(x)' },
			{ insert: '\\tan^{-1}(#?)', preview: '\\tan^{-1}(x)' },
			{ insert: '\\sinh(#?)', preview: '\\sinh(x)' },
			{ insert: '\\cosh(#?)', preview: '\\cosh(x)' },
			{ insert: '\\tanh(#?)', preview: '\\tanh(x)' }
		]
	},
	{
		id: 'limitlog',
		glyph: 'lim',
		structures: [
			{ insert: '\\lim_{#?\\to#?}#?', preview: '\\lim_{x\\to a} f(x)' },
			{ insert: '\\lim_{#?\\to\\infty}#?', preview: '\\lim_{n\\to\\infty} a_n' },
			{ insert: '\\min_{#?}#?', preview: '\\min_{i} x_i' },
			{ insert: '\\max_{#?}#?', preview: '\\max_{i} x_i' },
			{ insert: '\\ln(#?)', preview: '\\ln(x)' },
			{ insert: '\\log(#?)', preview: '\\log(x)' },
			{ insert: '\\log_{#?}(#?)', preview: '\\log_{b}(x)' },
			{ insert: '\\exp(#?)', preview: '\\exp(x)' }
		]
	},
	{
		id: 'operator',
		glyph: '≔',
		structures: [
			{ insert: '\\overset{#?}{#?}', preview: '\\overset{a}{b}' },
			{ insert: '\\underset{#?}{#?}', preview: '\\underset{a}{b}' },
			{ insert: '\\overset{\\text{def}}{=}', preview: '\\overset{\\text{def}}{=}' },
			{ insert: '\\stackrel{#?}{=}', preview: '\\stackrel{a}{=}' },
			{ insert: '\\xrightarrow{#?}', preview: '\\xrightarrow{f}' },
			{ insert: '\\xleftarrow{#?}', preview: '\\xleftarrow{f}' },
			{ insert: '\\coloneq', preview: '\\coloneq' },
			{ insert: '\\triangleq', preview: '\\triangleq' }
		]
	}
];
