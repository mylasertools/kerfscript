// Copyright (c) 2026 MyLaserTools. SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-MyLaserTools-Commercial

// A small XML reader, enough for SVG files: elements, attributes, text,
// comments, CDATA and a DOCTYPE with an internal subset. Namespace prefixes
// stay in the names, as in "inkscape:label".

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

export interface XmlDocument {
  root: XmlElement;
  comments: string[];
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decode(s: string, custom: Record<string, string> = {}): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z_][\w.-]*);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? custom[e] ?? m;
  });
}

export function parseXml(src: string): XmlDocument {
  const comments: string[] = [];
  const entities: Record<string, string> = {};
  const top: XmlElement = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [top];
  let i = 0;
  const fail = (msg: string): never => {
    const line = src.slice(0, i).split('\n').length;
    throw new Error(`${msg} (line ${line})`);
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? src.length : lt;
    if (textEnd > i) stack[stack.length - 1].text += decode(src.slice(i, textEnd), entities);
    if (lt < 0) break;
    i = lt;
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end < 0) fail('Unclosed comment');
      comments.push(src.slice(i + 4, end));
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      if (end < 0) fail('Unclosed CDATA section');
      stack[stack.length - 1].text += src.slice(i + 9, end);
      i = end + 3;
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      if (end < 0) fail('Unclosed processing instruction');
      i = end + 2;
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE, maybe with [ ... ] holding entity definitions
      let depth = 0;
      let j = i + 2;
      for (; j < src.length; j++) {
        const c = src[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      const body = src.slice(i, j);
      for (const m of body.matchAll(/<!ENTITY\s+([\w.-]+)\s+(["'])([\s\S]*?)\2\s*>/g))
        entities[m[1]] = m[3];
      i = j + 1;
    } else if (src[i + 1] === '/') {
      const end = src.indexOf('>', i);
      if (end < 0) fail('Unclosed end tag');
      const name = src.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open || open === top || open.name !== name)
        fail(`</${name}> does not match <${open?.name ?? 'nothing'}>`);
      i = end + 1;
    } else {
      const m = /^<([^\s/>]+)/.exec(src.slice(i, i + 256));
      if (!m) fail('Bad tag');
      const el: XmlElement = { name: m![1], attrs: {}, children: [], text: '' };
      i += m![0].length;
      const attr = /\s*([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?>)/y;
      for (;;) {
        attr.lastIndex = i;
        const a = attr.exec(src);
        if (!a) fail(`Bad attribute in <${el.name}>`);
        i = attr.lastIndex;
        if (a![5]) {
          stack[stack.length - 1].children.push(el);
          if (a![5] === '>') stack.push(el);
          break;
        }
        el.attrs[a![1]] = decode(a![3] ?? a![4] ?? '', entities);
      }
    }
  }
  if (stack.length > 1) fail(`<${stack[stack.length - 1].name}> is not closed`);
  const root = top.children[0];
  if (!root) throw new Error('The file has no elements');
  return { root, comments };
}
