import test from 'node:test';
import assert from 'node:assert/strict';

// controls.js imports the library from the page's assets folder, so point that
// import at the build, and give it a small stand-in for the page.
const { buildControls } = await import(
  `data:text/javascript,${encodeURIComponent(
    (await import('node:fs'))
      .readFileSync(new URL('../site/public/assets/controls.js', import.meta.url), 'utf8')
      .replace("'./kerfscript.js'", `'${new URL('../dist/index.js', import.meta.url)}'`),
  )}`
);

class Node {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.value = '';
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
    if (k === 'value') this.value = v;
  }
  append(...kids) {
    this.children.push(...kids.filter((k) => typeof k === 'object'));
  }
  replaceChildren() {
    this.children = [];
  }
  addEventListener(type, f) {
    this.listeners[type] = f;
  }
  all(tag) {
    return this.children.flatMap((c) => [...(c.tag === tag ? [c] : []), ...c.all(tag)]);
  }
  querySelectorAll(sel) {
    return this.all(sel);
  }
}
globalThis.document = { createElement: (tag) => new Node(tag) };

test('a vector control keeps numbers the code changed since it was made', () => {
  const container = new Node('div');
  const changes = [];
  const params = [{ name: 'size', group: 'G', caption: '', type: 'number', initial: [10, 20] }];
  buildControls(container, params, { size: [10, 20] }, (name, value) => changes.push(value));
  const [first, second] = container.all('input');
  // The code now says size = [30, 20]; the settings refresh shows it
  first.value = '30';
  second.value = '40';
  second.listeners.input();
  assert.deepEqual(changes.at(-1), [30, 40]);
});

test('a setting marked when shows only while its condition holds', async () => {
  const { parameters } = await import('../dist/index.js');
  const params = parameters(
    'mount = "wall"; // [wall, stand]\nclearance = 0.2; // [0:0.05:1] when mount == "stand"\n/* [Stand] */\nfeet = 2; // [1:4] when mount == "stand"',
  ).parameters;
  const container = new Node('div');
  const values = {};
  buildControls(container, params, values, () => {});
  const rows = container.all('div').filter((d) => d.attrs.class === 'control');
  const [, clearance, feet] = rows;
  const stand = container.all('fieldset')[1];
  assert.equal(clearance.hidden, true);
  assert.equal(feet.hidden, true);
  assert.equal(stand.hidden, true, 'a group with nothing shown is hidden');
  const select = container.all('select')[0];
  select.value = 'stand';
  select.listeners.change();
  assert.equal(clearance.hidden, false);
  assert.equal(stand.hidden, false);
});
