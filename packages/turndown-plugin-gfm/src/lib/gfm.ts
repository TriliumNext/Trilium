import type Turnish from "turnish";

import highlightedCodeBlock from './highlighted-code-block.js'
import { serializeStructuralHtml } from './serialize-structural-html.js'
import strikethrough from './strikethrough.js'
import tables from './tables.js'
import taskListItems from './task-list-items.js'

function gfm (turndownService: Turnish) {
  turndownService.use([
    highlightedCodeBlock,
    strikethrough,
    tables,
    taskListItems
  ])
}

export { gfm, highlightedCodeBlock, serializeStructuralHtml, strikethrough, tables, taskListItems }
