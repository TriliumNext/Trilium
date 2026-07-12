import type Turnish from "turnish";
import type { Rule, TurnishOptions } from "turnish";

var indexOf = Array.prototype.indexOf
var every = Array.prototype.every
var rules: Record<string, Rule> = {}
var alignMap: Record<string, string> = { left: ':---', right: '---:', center: ':---:' };

let isCodeBlock_: ((node: Node) => boolean) | null = null;
let options_: TurnishOptions | null = null;

// We need to cache the result of tableShouldBeSkipped() as it is expensive.
// Caching it means we went from about 9000 ms for rendering down to 90 ms.
// Fixes https://github.com/laurent22/joplin/issues/6736
const tableShouldBeSkippedCache_ = new WeakMap<HTMLTableElement, boolean>();

function getAlignment(node: HTMLElement | null): string {
  return node ? (node.getAttribute('align') || node.style.textAlign || '').toLowerCase() : '';
}

function getBorder(alignment: string): string {
  return alignment ? alignMap[alignment] : '---';
}

function getColumnAlignment(table: HTMLTableElement, columnIndex: number): string {
  var votes: Record<string, number> = {
    left: 0,
    right: 0,
    center: 0,
    '': 0,
  };

  var align = '';

  for (var i = 0; i < table.rows.length; ++i) {
    var row = table.rows[i];
    if (columnIndex < row.childNodes.length) {
      var cellAlignment = getAlignment(row.childNodes[columnIndex] as HTMLElement);
      ++votes[cellAlignment];

      if (votes[cellAlignment] > votes[align]) {
        align = cellAlignment;
      }
    }
  }

  return align;
}

rules.tableCell = {
  filter: ['th', 'td'],
  replacement: function (content: string, node) {
    if (tableShouldBeSkipped(nodeParentTable(node))) return content;
    return cell(content, node)
  }
}

rules.tableRow = {
  filter: 'tr',
  replacement: function (content: string, node) {
    const parentTable = nodeParentTable(node);
    if (!parentTable || tableShouldBeSkipped(parentTable)) return content;

    var borderCells = ''

    if (isHeadingRow(node)) {
      const colCount = tableColCount(parentTable);
      for (var i = 0; i < colCount; i++) {
        const childNode = i < node.childNodes.length ? node.childNodes[i] : null;
        var border = getBorder(getColumnAlignment(parentTable, i));
        borderCells += cell(border, childNode, i);
      }
    }
    return '\n' + content + (borderCells ? '\n' + borderCells : '')
  }
}

rules.table = {
  filter: function (node) {
    return node.nodeName === 'TABLE';
  },

  replacement: function (content: string, node) {
    // Only convert tables that can result in valid Markdown
    // Other tables are kept as HTML using `keep` (see below).
    if (tableShouldBeHtml(node, options_)) {
      return prettyPrintTable(node);
    } else {
      if (tableShouldBeSkipped(node)) return content;

      // Ensure there are no blank lines
      content = content.replace(/\n+/g, '\n')

      // A table reaching this branch always has a real heading row (otherwise
      // `tableShouldBeHtml` would have kept it as HTML), so the rendered content
      // already starts with a header + divider and no synthetic header is needed.
      const captionContent = node.caption ? node.caption.textContent || '' : '';
      const caption = captionContent ? `${captionContent}\n\n` : '';
      const tableContent = content.trimStart();
      return `\n\n${caption}${tableContent}\n\n`;
    }
  }
}

rules.tableCaption = {
  filter: ['caption'],
  replacement: () => '',
};

rules.tableColgroup = {
  filter: ['colgroup', 'col'],
  replacement: () => '',
};

rules.tableSection = {
  filter: ['thead', 'tbody', 'tfoot'],
  replacement: function (content: string) {
    return content
  }
}

// A tr is a heading row if:
// - the parent is a THEAD
// - or if its the first child of the TABLE or the first TBODY (possibly
//   following a blank THEAD)
// - and every cell is a TH
function isHeadingRow (tr: Node): boolean {
  var parentNode = tr.parentNode
  if (!parentNode) return false;
  return (
    parentNode.nodeName === 'THEAD' ||
    (
      parentNode.firstChild === tr &&
      (parentNode.nodeName === 'TABLE' || isFirstTbody(parentNode)) &&
      every.call(tr.childNodes, function (n) { return n.nodeName === 'TH' })
    )
  )
}

function isFirstTbody (element: Node): boolean {
  var previousSibling = element.previousSibling
  return (
    element.nodeName === 'TBODY' && (
      !previousSibling ||
      (
        previousSibling.nodeName === 'THEAD' &&
        /^\s*$/i.test(previousSibling.textContent || '')
      )
    )
  )
}

// Format table cells following MD060 compact style:
// Each cell has 1 space padding on left and right (prefix + content + ' |').
// Empty cells result in 2 spaces between pipes (1 left + 1 right padding).
function cell (content: string, node: any = null, index: number | null = null): string {
  if (index === null) index = indexOf.call(node.parentNode.childNodes, node)
  var prefix = ' '
  if (index === 0) prefix = '| '
  let filteredContent = content.trim().replace(/\n\r/g, '<br>').replace(/\n/g, "<br>");
  filteredContent = filteredContent.replace(/\|+/g, '\\|')
  if (node) filteredContent = handleColSpan(filteredContent, node, ' ');
  return prefix + filteredContent + ' |'
}

function nodeContainsTable(node: Node): boolean {
  if (!node.childNodes) return false;

  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeName === 'TABLE') return true;
    if (nodeContainsTable(child)) return true;
  }
  return false;
}

const nodeContains = (node: Node, types: string | string[]): boolean => {
  if (!node.childNodes) return false;

  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (types === 'code' && isCodeBlock_ && isCodeBlock_(child)) return true;
    if (types.includes(child.nodeName)) return true;
    if (nodeContains(child, types)) return true;
  }

  return false;
}

const tableShouldBeHtml = (tableNode: any, options: TurnishOptions | null): boolean => {
  const possibleTags = [
    'UL',
    'OL',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'HR',
    'BLOCKQUOTE',
    'PRE'
  ];

  // In general we should leave as HTML tables that include other tables. The
  // exception is with the Web Clipper when we import a web page with a layout
  // that's made of HTML tables. In that case we have this logic of removing the
  // outer table and keeping only the inner ones. For the Rich Text editor
  // however we always want to keep nested tables.
  if (options?.preserveNestedTables) possibleTags.push('TABLE');

  return nodeContains(tableNode, 'code') ||
    nodeContains(tableNode, possibleTags) ||
    // GFM tables must have a header row. A table with no heading row (or with
    // only heading columns) cannot be represented in Markdown without inventing
    // a phantom empty header, which reimports as a spurious blank row. Keep such
    // tables as raw HTML instead so they round-trip faithfully. Skippable tables
    // (e.g. a single cell) are rendered as paragraphs and are left untouched.
    (!tableShouldBeSkipped(tableNode) && !tableHasHeadingRow(tableNode));
}

// A table has a heading row when its first row qualifies as a heading row (its
// parent is a THEAD, or it is the first row and every cell is a TH). This is the
// row that produces the Markdown divider line; without it the table has no
// header and must be kept as HTML.
function tableHasHeadingRow(tableNode: HTMLTableElement): boolean {
  return !!tableNode.rows && tableNode.rows.length > 0 && isHeadingRow(tableNode.rows[0]);
}

// Various conditions under which a table should be skipped - i.e. each cell
// will be rendered one after the other as if they were paragraphs.
function tableShouldBeSkipped(tableNode: HTMLTableElement | null): boolean {
  if (!tableNode) return true;

  const cached = tableShouldBeSkippedCache_.get(tableNode);
  if (cached !== undefined) return cached;

  const result = tableShouldBeSkipped_(tableNode);

  tableShouldBeSkippedCache_.set(tableNode, result);
  return result;
}

function tableShouldBeSkipped_(tableNode: HTMLTableElement | null): boolean {
  if (!tableNode) return true;
  if (!tableNode.rows) return true;
  if (tableNode.rows.length === 1 && tableNode.rows[0].childNodes.length <= 1) return true; // Table with only one cell
  if (nodeContainsTable(tableNode)) return true;
  return false;
}

function nodeParentDiv(node: Node): HTMLElement | null {
  let parent = node.parentNode;
  while (parent && parent.nodeName !== 'DIV') {
    parent = parent.parentNode;
  }
  return parent as HTMLElement | null;
}

function nodeParentTable(node: Node): HTMLTableElement | null {
  let parent = node.parentNode;
  while (parent && parent.nodeName !== 'TABLE') {
    parent = parent.parentNode;
  }
  return parent as HTMLTableElement | null;
}

function handleColSpan(content: string, node: any, emptyChar: string): string {
  const colspan = node.getAttribute('colspan') || 1;
  for (let i = 1; i < colspan; i++) {
    content += ' |' + emptyChar;
  }
  return content
}

function tableColCount(node: HTMLTableElement): number {
  let maxColCount = 0;
  for (let i = 0; i < node.rows.length; i++) {
    const row = node.rows[i]
    const colCount = row.childNodes.length
    if (colCount > maxColCount) maxColCount = colCount
  }
  return maxColCount
}

// Structural table elements whose children are themselves structural and are
// therefore broken onto their own indented lines. Every other element (td, th,
// caption, col) is a leaf: its content is emitted verbatim on a single line.
var TABLE_CONTAINER_TAGS = ['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'COLGROUP'];

// Serializes a table that is kept as raw HTML into indented, multi-line markup so
// it stays readable inside the exported Markdown file. Only structural tags are
// placed on their own lines; cell contents are emitted verbatim (never re-indented)
// so whitespace-significant content such as <pre> code survives untouched. No blank
// lines are produced, so the result stays a single raw-HTML block on reimport.
// Inter-element whitespace text nodes are dropped, which makes the output stable
// across repeated export/import cycles.
function prettyPrintTable(node: Element): string {
  return serializeStructuralNode(node, 0);
}

function serializeStructuralNode(node: Element, depth: number): string {
  const indent = '    '.repeat(depth);
  const closeTag = '</' + node.nodeName.toLowerCase() + '>';

  // Use the DOM's own serializer for the opening tag so attribute quoting/escaping
  // matches the rest of the output. A shallow clone has no children, so its
  // outerHTML is exactly the opening tag plus (for non-void elements) the closing tag.
  const shallowHtml = (node.cloneNode(false) as Element).outerHTML;
  const isVoid = !shallowHtml.endsWith(closeTag);
  const openTag = isVoid ? shallowHtml : shallowHtml.slice(0, shallowHtml.length - closeTag.length);

  if (TABLE_CONTAINER_TAGS.indexOf(node.nodeName) === -1) {
    // Leaf structural element (td/th/caption/col): keep its content on one line.
    return isVoid ? indent + openTag : indent + openTag + node.innerHTML.trim() + closeTag;
  }

  const lines = [indent + openTag];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 1) { // ELEMENT_NODE — whitespace-only text nodes are skipped
      lines.push(serializeStructuralNode(child as Element, depth + 1));
    }
  }
  lines.push(indent + closeTag);
  return lines.join('\n');
}

export default function tables (turndownService: Turnish) {
  isCodeBlock_ = (turndownService as any).isCodeBlock ?? null;
  options_ = turndownService.options;

  turndownService.keep(function (node) {
    if (node.nodeName === 'TABLE' && tableShouldBeHtml(node, turndownService.options)) return true;
    return false;
  });
  for (var key in rules) turndownService.addRule(key, rules[key])
}
