// The markdown pack: the prose between tables and code, split into what the skin draws
// itself (GitHub alerts, task lists, headings, plain paragraphs with their numbers, paths
// and versions picked out) and what stays Claude Code's own markdown.

export type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export type Task = { done: boolean; depth: number; text: string }

// A line of a paragraph the skin draws: a bullet keeps its own row, prose joins up.
export type Line = { bullet: string | null; depth: number; runs: Run[] }

export type Block =
  | { kind: 'markdown'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'alert'; type: AlertType; body: string }
  | { kind: 'tasks'; items: Task[] }
  | { kind: 'paragraph'; lines: Line[] }

export type RunStyle = 'plain' | 'bold' | 'italic' | 'strike' | 'code' | 'number' | 'version' | 'path' | 'duration' | 'url' | 'link'

// A `link` run carries where its label points.
export type Run = { style: RunStyle; text: string; href?: string }

const HEADING = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/
const ALERT = /^\s*>\s*\[!(note|tip|important|warning|caution)\]\s*(.*)$/i
const QUOTE = /^\s*>\s?(.*)$/
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/
const BULLET = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/

// Anything here is markdown the skin does not draw: images, html, footnotes, escapes,
// quotes, rules, indented code, maths, and any link `LINK` does not read.
const FOREIGN = /<|\\|\||!\[|\]\(|\]\[|\[\^|&[a-z#\d]+;|\$\$|^\s*(>|#|[-*_]{3,}\s*$)|^ {4}|^\t/m
const FENCE = /^\s*(```|~~~)/

// An inline link, `[label](url)` or `[label](url "title")`; not an image. The label holds
// no bracket, the URL no space and at most one level of balanced parentheses
// (`/wiki/Foo_(bar)`), and the title, in either quote, is dropped. Reference links
// (`[label][1]`) are not read.
const LINK_SOURCE = String.raw`(?<!!)\[([^\[\]\n]+)\]\([ \t]*((?:[^()\s]|\([^()\s]*\))+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?[ \t]*\)`
const LINK = new RegExp(LINK_SOURCE, 'g')

const MARKS = /\*\*|__|~~|`/g

const EMPHASIS = /(`+)([^`]+?)\1|\*\*(?=\S)(.+?)(?<=\S)\*\*|__(?=\S)(.+?)(?<=\S)__|~~(?=\S)(.+?)(?<=\S)~~|(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])|(?<![\w_])_(?=\S)(.+?)(?<=\S)_(?![\w_])/

// Code and emphasis, then a link: its label and its URL are the last two groups.
const INLINE = new RegExp(`${EMPHASIS.source}|${LINK_SOURCE}`, 'g')

// Ordered so a URL wins over the path inside it, and a path over its version or number. A
// path keeps a `:line` or `:line:col` after it.
const HIGHLIGHT: readonly (readonly [RunStyle, RegExp])[] = [
  ['url', /\bhttps?:\/\/[^\s<>()"'`]*[^\s<>()"'`.,;:!?]/],
  ['path', /(?:(?:[A-Za-z]:[\\/]|~\/|\.{1,2}\/|(?<![\w)])\/(?=[\w.@-]+\/))[\w.@-]+(?:[\\/][\w.@-]+)*\/?|(?<![\w/.-])[\w@-]+(?:\/[\w.@-]+)*\/[\w-]+\.[A-Za-z][A-Za-z0-9]{0,5}\b)(?::\d+(?::\d+)?\b)?/],
  ['version', /(?<![\w.-])v\d+(?:\.\d+)*(?:-[\w.]+)?\b|(?<![\w.-])\d+\.\d+\.\d+(?:-[\w.]+)?\b/],
  ['duration', /(?<![\w.-])\d+(?:\.\d+)?(?:ns|µs|us|ms|s|min|h)\b/],
  ['number', /(?<![\w.-])\d[\d,_]*(?:\.\d+)?%?(?![\w])/],
]

// Splits plain text into runs, the earliest match of any kind taking each stretch.
function highlight(text: string): Run[] {
  const runs: Run[] = []
  let rest = text

  while (rest !== '') {
    let best: { style: RunStyle; index: number; length: number } | null = null

    for (const [style, pattern] of HIGHLIGHT) {
      const match = pattern.exec(rest)

      if (match !== null && match[0] !== '' && (best === null || match.index < best.index)) {
        best = { style, index: match.index, length: match[0].length }
      }
    }

    if (best === null) {
      runs.push({ style: 'plain', text: rest })
      break
    }

    if (best.index > 0) {
      runs.push({ style: 'plain', text: rest.slice(0, best.index) })
    }

    runs.push({ style: best.style, text: rest.slice(best.index, best.index + best.length) })
    rest = rest.slice(best.index + best.length)
  }

  return runs
}

// Inline code, emphasis and strike, with the plain stretches between them highlighted.
export function inlineRuns(text: string): Run[] {
  const runs: Run[] = []
  let last = 0

  for (const match of text.matchAll(INLINE)) {
    runs.push(...highlight(text.slice(last, match.index)))

    const [, , code, bold, under, strike, star, low, label, href] = match
    last = match.index + match[0].length

    if (label !== undefined && href !== undefined) {
      runs.push({ style: 'link', text: label.replace(MARKS, ''), href })
      continue
    }

    const inner = code ?? bold ?? under ?? strike ?? star ?? low ?? ''
    const style: RunStyle = code !== undefined ? 'code' : bold !== undefined || under !== undefined ? 'bold' : strike !== undefined ? 'strike' : 'italic'

    if (style === 'code') {
      runs.push({ style, text: inner.trim() })
      continue
    }

    // Emphasis inside emphasis keeps the outer style, its marks dropped; a link inside
    // stays a link.
    let rest = 0

    for (const link of inner.matchAll(LINK)) {
      runs.push({ style, text: inner.slice(rest, link.index).replace(MARKS, '') }, { style: 'link', text: (link[1] ?? '').replace(MARKS, ''), href: link[2] ?? '' })
      rest = link.index + link[0].length
    }

    runs.push({ style, text: inner.slice(rest).replace(MARKS, '') })
  }

  runs.push(...highlight(text.slice(last)))

  return runs.filter(run => run.text !== '')
}

const depthOf = (indent: string): number => Math.floor(indent.replace(/\t/g, '  ').length / 2)

// A paragraph the skin can draw, or null to leave it to Claude Code's markdown.
function paragraphOf(text: string): Line[] | null {
  // A link `LINK` reads is drawn; its label and URL are checked like any other text, behind
  // a letter so a label opening a line (`[#12](…)`) is not read as a heading or a quote.
  if (FOREIGN.test(text.replace(LINK, 'x$1 $2'))) {
    return null
  }

  const lines: Line[] = []
  let prose: string[] = []

  const flush = () => {
    if (prose.length > 0) {
      lines.push({ bullet: null, depth: 0, runs: inlineRuns(prose.join(' ')) })
    }

    prose = []
  }

  for (const line of text.split('\n')) {
    const bullet = BULLET.exec(line)

    if (bullet !== null) {
      flush()
      const [, indent = '', mark = '', body = ''] = bullet
      lines.push({ bullet: /\d/.test(mark) ? mark : '•', depth: depthOf(indent), runs: inlineRuns(body) })
    } else if (lines.at(-1)?.bullet != null && prose.length === 0 && /^\s+\S/.test(line)) {
      // A wrapped bullet continues its item.
      const item = lines.at(-1)
      item?.runs.push({ style: 'plain', text: ' ' }, ...inlineRuns(line.trim()))
    } else {
      prose.push(line.trim())
    }
  }

  flush()

  return lines
}

export type BlockOptions = {
  // Headings and paragraphs drawn by the skin; off, they stay markdown.
  prose: boolean
}

// `text` split into blocks; every stretch the skin does not draw is a markdown block,
// adjacent ones joined so Claude Code sees them whole.
export function splitBlocks(text: string, options: BlockOptions): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let pending: string[] = []

  const markdown = (chunk: string) => {
    const last = blocks.at(-1)

    if (last?.kind === 'markdown') {
      blocks[blocks.length - 1] = { kind: 'markdown', text: `${last.text}\n\n${chunk}` }
    } else {
      blocks.push({ kind: 'markdown', text: chunk })
    }
  }

  const flush = () => {
    const chunk = pending.join('\n')
    pending = []

    if (chunk.trim() === '') {
      return
    }

    const paragraph = options.prose ? paragraphOf(chunk) : null

    if (paragraph === null) {
      markdown(chunk)
    } else {
      blocks.push({ kind: 'paragraph', lines: paragraph })
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''

    // A fence, closed or still streaming, is Claude Code's to draw.
    if (FENCE.test(line)) {
      flush()
      const close = lines.findIndex((other, j) => j > i && FENCE.test(other) && other.trim().replace(/[`~]/g, '') === '')
      const end = close === -1 ? lines.length - 1 : close
      markdown(lines.slice(i, end + 1).join('\n'))
      i = end
      continue
    }

    const alert = ALERT.exec(line)

    if (alert !== null) {
      flush()
      const body = alert[2] === '' || alert[2] === undefined ? [] : [alert[2]]

      while (i + 1 < lines.length && QUOTE.test(lines[i + 1] ?? '')) {
        i++
        body.push(QUOTE.exec(lines[i] ?? '')?.[1] ?? '')
      }

      blocks.push({ kind: 'alert', type: (alert[1] ?? 'note').toLowerCase() as AlertType, body: body.join('\n').trim() })
      continue
    }

    if (TASK.test(line)) {
      flush()
      const items: Task[] = []

      for (; i < lines.length; i++) {
        const task = TASK.exec(lines[i] ?? '')

        if (task === null) {
          i--
          break
        }

        items.push({ done: task[2] !== ' ', depth: depthOf(task[1] ?? ''), text: task[3] ?? '' })
      }

      blocks.push({ kind: 'tasks', items })
      continue
    }

    const heading = options.prose ? HEADING.exec(line) : null

    if (heading !== null) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: (heading[2] ?? '').replace(/\*\*|__|`/g, '') })
      continue
    }

    if (line.trim() === '') {
      flush()
      continue
    }

    pending.push(line)
  }

  flush()

  return blocks
}

// Whether a reply holds anything the pack draws on a surface without prose drawing.
export const hasBlocks = (text: string): boolean => /^\s*>\s*\[!(note|tip|important|warning|caution)\]|^\s*[-*+]\s+\[[ xX]\]\s/im.test(text)

// Whether the pack would draw any of `text` itself on `surface`.
export const drawsBlocks = (text: string, surface: string): boolean =>
  splitBlocks(text, { prose: surface === 'terminal' }).some(block => block.kind !== 'markdown')
