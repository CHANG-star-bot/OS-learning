const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../lessons/five-states.fragment.html'), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];

function boot(bridge) {
  const elements = new Map();
  const globalsListeners = [];
  function element(key) {
    const handlers = {};
    const attributes = {};
    return {
      textContent: '', disabled: false, value: '', dataset: {}, style: {},
      classList: {add() {}, remove() {}, toggle() {}},
      addEventListener(name, handler) { handlers[name] = handler; },
      setAttribute(name, value) { attributes[name] = String(value); },
      getAttribute(name) { return attributes[name] ?? null; },
      trigger(name) { if (name === 'click' && this.disabled) return; handlers[name]?.({target: this}); },
      // The inline controller must not depend on a browser layout engine or SVG parser.
      get clientWidth() { throw new Error('layout measurement is unavailable'); },
      set innerHTML(_) { throw new Error('dynamic markup parsing is unavailable'); },
    };
  }
  const answers = ['run', 'ready', 'blocked'].map(answer => {
    const button = element(answer); button.dataset.answer = answer; return button;
  });
  const root = element('root');
  root.querySelector = selector => {
    if (!elements.has(selector)) elements.set(selector, element(selector));
    return elements.get(selector);
  };
  root.querySelectorAll = selector => selector === '[data-answer]' ? answers : [];
  const window = {openai: bridge, addEventListener(name, fn) { if (name === 'openai:set_globals') globalsListeners.push(fn); }};
  // No ResizeObserver is supplied. A saved state bridge may also be absent or synchronous.
  vm.runInNewContext(script, {document: {getElementById() { return root; }}, window}, {timeout: 1000});
  return {get: selector => elements.get(selector), answers, restore(state) {
    globalsListeners.forEach(fn => fn({detail: {globals: {widgetState: {privateContent: state}}}}));
  }};
}

const runtime = boot();
const expected = ['new', 'ready', 'run', 'ready', 'run', 'blocked', 'ready', 'run', 'exit'];
for (let step = 0; step < expected.length; step++) {
  assert.equal(runtime.get('[data-map]').getAttribute('data-state'), expected[step]);
  if (step === 5) assert.equal(runtime.get('[data-blocked]').textContent, 'A：等文件数据');
  if (step === 6) {
    assert.equal(runtime.get('[data-ready]').textContent, 'A');
    assert.equal(runtime.get('[data-cpu]').textContent, 'B：后台任务');
  }
  if (step < expected.length - 1) runtime.get('[data-next]').trigger('click');
}
assert.equal(runtime.get('[data-next]').disabled, true);
runtime.get('[data-prev]').trigger('click');
assert.equal(runtime.get('[data-map]').getAttribute('data-state'), 'run');

const saved = [];
const synchronous = boot({setWidgetState(snapshot) { saved.push(snapshot); }});
synchronous.get('[data-next]').trigger('click');
assert.equal(saved.at(-1).privateContent.step, 1);
for (const [quiz, answer, state] of [['timeout', 'ready', 'ready'], ['wait', 'blocked', 'blocked'], ['wake', 'ready', 'ready']]) {
  synchronous.get('[data-quiz]').value = quiz;
  synchronous.get('[data-quiz]').trigger('change');
  synchronous.answers.find(button => button.dataset.answer === answer).trigger('click');
  assert.match(synchronous.get('[data-feedback]').textContent, /判断正确/);
  assert.equal(synchronous.get('[data-map]').getAttribute('data-state'), state);
}
synchronous.restore({lesson: 'five-states', step: 5, quiz: '__proto__', answer: null});
assert.equal(synchronous.get('[data-quiz]').value, 'timeout');
synchronous.restore({lesson: 'five-states', step: 999, quiz: 'wait', answer: null});
assert.equal(synchronous.get('[data-map]').getAttribute('data-state'), 'blocked');

const throwingBridge = boot({setWidgetState() { throw new Error('host bridge unavailable'); }});
throwingBridge.get('[data-next]').trigger('click');
assert.equal(throwingBridge.get('[data-map]').getAttribute('data-state'), 'ready');
const asyncBridge = boot({setWidgetState() { return Promise.resolve(); }});
asyncBridge.get('[data-next]').trigger('click');
assert.equal(asyncBridge.get('[data-map]').getAttribute('data-state'), 'ready');
const rejectedBridge = boot({setWidgetState() { return Promise.reject(new Error('host rejected save')); }});
rejectedBridge.get('[data-next]').trigger('click');
assert.equal(rejectedBridge.get('[data-map]').getAttribute('data-state'), 'ready');
const inaccessibleState = {setWidgetState() {}};
Object.defineProperty(inaccessibleState, 'widgetState', {get() { throw new Error('state is unavailable'); }});
assert.equal(boot(inaccessibleState).get('[data-map]').getAttribute('data-state'), 'new');

console.log('PASS: limited DOM initialization, nine states, three quizzes, saved-state validation and optional host bridge.');
