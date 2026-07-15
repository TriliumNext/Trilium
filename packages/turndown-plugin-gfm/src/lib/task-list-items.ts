import type Turnish from "turnish";

export default function taskListItems (turndownService: Turnish) {
  turndownService.addRule('taskListItems', {
    filter: function (node) {
      // `node` is turnish's ExtendedNode (Element + extra props), which doesn't overlap
      // HTMLInputElement directly, so cast through `unknown` to read the input `type`.
      return (node as unknown as HTMLInputElement).type === 'checkbox' && node.parentNode?.nodeName === 'LI'
    },
    replacement: function (content: string, node) {
      return (node.checked ? '[x]' : '[ ]') + ' '
    }
  })
}
