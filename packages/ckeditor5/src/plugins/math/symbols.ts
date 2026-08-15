// The symbols the equation balloon offers as a gallery, grouped the way OneNote's equation ribbon
// groups its own: the categories a person browsing for a glyph already expects. MathLive's menu
// carries none of these — it offers structures, accents and styles — and its virtual keyboard,
// which does, is a touch surface we deliberately keep out of the way on the desktop.
//
// Each entry is the LaTeX that gets typed into the field, and is also what the entry is *called*:
// the button draws the symbol and names it `\nabla` in its tooltip. That is the name a maths
// writer wants (it is what they would type next time), and it is the same in every language, so
// unlike the section captions these need no translation.
//
// A glyph may appear in more than one section — `\perp` is both a relation and a piece of
// geometry — because a gallery is for looking things up, and the place someone looks first
// differs. Only repeats *within* a section are a mistake.

export type MathSymbolSectionId =
	| 'basic'
	| 'greek'
	| 'letterlike'
	| 'operators'
	| 'relations'
	| 'negated'
	| 'arrows'
	| 'logic'
	| 'geometry';

export interface MathSymbolSection {
	id: MathSymbolSectionId;

	/** The LaTeX of each symbol, in the order the section draws them. */
	symbols: readonly string[];
}

export const MATH_SYMBOL_SECTIONS: readonly MathSymbolSection[] = [
	{
		id: 'basic',
		symbols: [
			'\\pm', '\\mp', '\\times', '\\div', '\\cdot', '\\ast', '\\star', '\\circ',
			'\\bullet', '\\oplus', '\\ominus', '\\otimes', '\\oslash', '\\odot',
			'\\dagger', '\\ddagger', '\\infty', '\\partial', '\\nabla', '\\prime',
			'\\degree', '\\neg', '\\therefore', '\\because',
			'\\ldots', '\\cdots', '\\vdots', '\\ddots'
		]
	},
	{
		id: 'greek',
		symbols: [
			'\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\varepsilon', '\\zeta',
			'\\eta', '\\theta', '\\vartheta', '\\iota', '\\kappa', '\\lambda', '\\mu', '\\nu',
			'\\xi', '\\pi', '\\varpi', '\\rho', '\\varrho', '\\sigma', '\\varsigma', '\\tau',
			'\\upsilon', '\\phi', '\\varphi', '\\chi', '\\psi', '\\omega',
			'\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Xi', '\\Pi', '\\Sigma',
			'\\Upsilon', '\\Phi', '\\Psi', '\\Omega'
		]
	},
	{
		id: 'letterlike',
		symbols: [
			'\\mathbb{R}', '\\mathbb{N}', '\\mathbb{Z}', '\\mathbb{Q}', '\\mathbb{C}',
			'\\mathbb{P}', '\\aleph', '\\beth', '\\hbar', '\\ell', '\\wp', '\\Re', '\\Im',
			'\\mho', '\\imath', '\\jmath', '\\emptyset', '\\varnothing'
		]
	},
	{
		id: 'operators',
		symbols: [
			'\\sum', '\\prod', '\\coprod', '\\int', '\\iint', '\\iiint', '\\oint',
			'\\bigcup', '\\bigcap', '\\bigvee', '\\bigwedge', '\\bigoplus', '\\bigotimes',
			'\\bigodot', '\\biguplus', '\\bigsqcup'
		]
	},
	{
		id: 'relations',
		symbols: [
			'\\le', '\\ge', '\\ll', '\\gg', '\\equiv', '\\sim', '\\simeq', '\\approx',
			'\\cong', '\\propto', '\\doteq', '\\asymp', '\\prec', '\\succ', '\\preceq',
			'\\succeq', '\\subset', '\\supset', '\\subseteq', '\\supseteq', '\\sqsubseteq',
			'\\sqsupseteq', '\\in', '\\ni', '\\mid', '\\parallel', '\\perp'
		]
	},
	{
		id: 'negated',
		symbols: [
			'\\ne', '\\nless', '\\ngtr', '\\nleq', '\\ngeq', '\\nprec', '\\nsucc',
			'\\nsim', '\\ncong', '\\nmid', '\\nparallel', '\\notin', '\\nsubseteq',
			'\\nsupseteq', '\\subsetneq', '\\supsetneq'
		]
	},
	{
		id: 'arrows',
		symbols: [
			'\\leftarrow', '\\rightarrow', '\\uparrow', '\\downarrow', '\\leftrightarrow',
			'\\updownarrow', '\\Leftarrow', '\\Rightarrow', '\\Uparrow', '\\Downarrow',
			'\\Leftrightarrow', '\\Updownarrow', '\\longleftarrow', '\\longrightarrow',
			'\\longleftrightarrow', '\\Longleftarrow', '\\Longrightarrow',
			'\\Longleftrightarrow', '\\mapsto', '\\longmapsto', '\\hookleftarrow',
			'\\hookrightarrow', '\\nearrow', '\\searrow', '\\swarrow', '\\nwarrow',
			'\\leftharpoonup', '\\leftharpoondown', '\\rightharpoonup', '\\rightharpoondown',
			'\\rightleftharpoons', '\\curvearrowleft', '\\curvearrowright',
			'\\circlearrowleft', '\\circlearrowright', '\\twoheadrightarrow'
		]
	},
	{
		id: 'logic',
		symbols: [
			'\\cup', '\\cap', '\\setminus', '\\sqcup', '\\sqcap', '\\uplus', '\\complement',
			'\\forall', '\\exists', '\\nexists', '\\land', '\\lor', '\\lnot', '\\top',
			'\\bot', '\\vdash', '\\dashv', '\\models', '\\implies', '\\impliedby', '\\iff'
		]
	},
	{
		id: 'geometry',
		symbols: [
			'\\angle', '\\measuredangle', '\\sphericalangle', '\\perp', '\\parallel',
			'\\cong', '\\sim', '\\degree', '\\triangle', '\\square', '\\bigcirc',
			'\\diamond', '\\frown', '\\smile'
		]
	}
];
