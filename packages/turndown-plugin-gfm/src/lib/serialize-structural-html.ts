// Serializes an element into indented, multi-line HTML so raw-HTML blocks that
// Markdown has no native syntax for (tables kept as HTML, <details> disclosure
// widgets) stay readable inside the exported Markdown file.
//
// `containerTags` lists the tag names that are recursed into and laid out one
// child per line; every other element is a leaf whose inner HTML is emitted
// verbatim on a single line, so whitespace-significant content such as <pre>
// code survives untouched. No blank lines are produced, so the result stays a
// single raw-HTML block on reimport. Inter-element whitespace text nodes are
// dropped, which makes the output stable across repeated export/import cycles.
export function serializeStructuralHtml(node: Element, containerTags: string[], depth = 0): string {
  const indent = '    '.repeat(depth);
  const closeTag = '</' + node.nodeName.toLowerCase() + '>';

  // Use the DOM's own serializer for the opening tag so attribute quoting/escaping
  // matches the rest of the output. A shallow clone has no children, so its
  // outerHTML is exactly the opening tag plus (for non-void elements) the closing tag.
  const shallowHtml = (node.cloneNode(false) as Element).outerHTML;
  const isVoid = !shallowHtml.endsWith(closeTag);
  const openTag = isVoid ? shallowHtml : shallowHtml.slice(0, shallowHtml.length - closeTag.length);

  // A container with significant direct text (e.g. a pasted <details>text</details>)
  // is emitted verbatim so the text is not dropped when we recurse over elements only.
  const hasDirectText = hasSignificantTextChild(node);

  if (containerTags.indexOf(node.nodeName) === -1 || hasDirectText) {
    // Leaf element (td/th/caption/col, or a <details> body child): keep it on one line.
    return isVoid ? indent + openTag : indent + openTag + node.innerHTML.trim() + closeTag;
  }

  const lines = [indent + openTag];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 1) { // ELEMENT_NODE — whitespace-only text nodes are skipped
      lines.push(serializeStructuralHtml(child as Element, containerTags, depth + 1));
    }
  }
  lines.push(indent + closeTag);
  return lines.join('\n');
}

function hasSignificantTextChild(node: Element): boolean {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 3 && (child.textContent || '').trim() !== '') { // TEXT_NODE
      return true;
    }
  }
  return false;
}
