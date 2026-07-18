import type Turnish from "turnish";

export default function strikethrough (turndownService: Turnish) {
  turndownService.addRule('strikethrough', {
    filter: ['del', 's', 'strike'],
    replacement: function (content: string) {
      return '~~' + content + '~~'
    }
  })
}
