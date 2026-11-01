// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// Syntax colouring for KerfScript. Unlike the lexer it never throws, so it
// works on unfinished code while someone is typing. It works one line at a
// time with a small state, which is what editors such as CodeMirror need.
// The categories follow the TextMate grammar in editors/vscode.

export type HighlightKind =
  | 'comment'
  | 'section'
  | 'control'
  | 'string'
  | 'number'
  | 'keyword'
  | 'constant'
  | 'definition'
  | 'builtin'
  | 'layer'
  | 'call'
  | 'special'
  | 'modifier'
  | 'plain';

export interface HighlightToken {
  kind: HighlightKind;
  text: string;
}

// Carried from one line to the next
export interface HighlightState {
  inBlock: boolean;
}

const KEYWORDS = new Set([
  'module',
  'function',
  'if',
  'else',
  'for',
  'let',
  'each',
  'use',
  'include',
]);

const CONSTANTS = new Set(['true', 'false', 'undef', 'PI']);

export const LAYERS = new Set(['cut', 'score', 'engrave', 'guide', 'layer']);

export const BUILTINS = new Set(
  (
    'rect square circle ellipse regular_polygon star polygon path line polyline arc text ' +
    'translate rotate scale mirror multmatrix union group difference intersection hull offset ' +
    'stroke outline part material children echo assert finger_rect finger_holes tslot ' +
    'living_hinge ' +
    // Modules in the standard library
    'box divider kerf_gauge slot_gauge joint_test slotted_divider grid_dividers enclosure ' +
    'enclosure_cutouts vents keyhole keyholes hanging_hole hanging_loop flex_rect flex_box ' +
    'flex_panel tabs slots tab_rect ' +
    'abs sign floor ceil round sqrt pow exp ln log sin cos tan asin acos atan atan2 min max clamp ' +
    'lerp norm cross len concat reverse sum slice str chr ord upper lower split join search ' +
    'contains lookup is_num is_string is_bool is_list is_undef is_function type_of rands ' +
    'text_width text_metrics finger_count'
  ).split(' '),
);

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const WORD = /\$?[A-Za-z_][A-Za-z0-9_]*/y;
const CALL = /\s*\(/y;
const PATH = /<[^>]*>?/y;
// /* [Size] */ starts a customizer group
const SECTION = /\/\*\s*\[[^\]]*\]\s*\*\//y;
// width = 120; // [40:5:400] gives a setting its control
const CONTROL = /\/\/\s*\[[^\]]*\]\s*$/y;
// * disables a module call, # and % move it to the guide layer
const MODIFIER = /[*#%](?=\s*[A-Za-z_$])/y;

const at = (re: RegExp, line: string, i: number) => {
  re.lastIndex = i;
  return re.exec(line)?.[0] ?? null;
};

export function highlightLine(line: string, state: HighlightState): HighlightToken[] {
  const out: HighlightToken[] = [];
  const push = (kind: HighlightKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  // The word before, for `use <path>` and the name after `module`
  let prev = '';
  // Whether a statement can start here, where *, # and % are modifiers
  let start = true;
  while (i < line.length) {
    const c = line[i];
    let m: string | null;
    if (state.inBlock) {
      const end = line.indexOf('*/', i);
      const stop = end < 0 ? line.length : end + 2;
      push('comment', line.slice(i, stop));
      if (end >= 0) state.inBlock = false;
      i = stop;
    } else if ((m = at(SECTION, line, i))) {
      push('section', m);
      i += m.length;
    } else if ((m = at(CONTROL, line, i))) {
      const open = m.indexOf('[');
      push('comment', m.slice(0, open));
      push('control', m.slice(open).trimEnd());
      push('plain', m.slice(open + m.slice(open).trimEnd().length));
      i += m.length;
    } else if (line.startsWith('//', i)) {
      push('comment', line.slice(i));
      i = line.length;
    } else if (line.startsWith('/*', i)) {
      state.inBlock = true;
      push('comment', '/*');
      i += 2;
    } else if (c === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j += line[j] === '\\' ? 2 : 1;
      push('string', line.slice(i, j + 1));
      i = j + 1;
      prev = '';
      start = false;
    } else if ((prev === 'use' || prev === 'include') && c === '<' && (m = at(PATH, line, i))) {
      push('string', m);
      i += m.length;
      prev = '';
    } else if (start && (m = at(MODIFIER, line, i))) {
      push('modifier', m);
      i += m.length;
    } else if (c === '#') {
      push('modifier', c);
      i++;
    } else if ((m = at(NUMBER, line, i))) {
      push('number', m);
      i += m.length;
      prev = '';
      start = false;
    } else if ((m = at(WORD, line, i))) {
      const call = at(CALL, line, i + m.length) !== null;
      if (m[0] === '$') push('special', m);
      else if ((prev === 'module' || prev === 'function') && !KEYWORDS.has(m))
        push('definition', m);
      else if (KEYWORDS.has(m)) push('keyword', m);
      else if (CONSTANTS.has(m)) push('constant', m);
      else if (call && LAYERS.has(m)) push('layer', m);
      else if (call && BUILTINS.has(m)) push('builtin', m);
      else if (call) push('call', m);
      else push('plain', m);
      prev = m;
      i += m.length;
      start = false;
    } else {
      push('plain', c);
      if (!/\s/.test(c)) {
        prev = '';
        start = c === ';' || c === '{' || c === '}';
      }
      i++;
    }
  }
  return out;
}

// One list of tokens per line
export function highlightLines(src: string): HighlightToken[][] {
  const state = { inBlock: false };
  return src.split('\n').map((line) => highlightLine(line, state));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// HTML with a `t-<kind>` span per token. Spans never cross a line break, so
// the result can be split into lines.
export function highlight(src: string): string {
  return highlightLines(src)
    .map((tokens) =>
      tokens
        .map((t) =>
          t.kind === 'plain' ? esc(t.text) : `<span class="t-${t.kind}">${esc(t.text)}</span>`,
        )
        .join(''),
    )
    .join('\n');
}
