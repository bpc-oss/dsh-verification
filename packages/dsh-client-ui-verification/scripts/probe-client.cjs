/* 浏览器端 apply/SettingsPanel 实证：stub slots/locale/effect + react-dom/server 渲染。 */
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const path = require('path');

const bundlePath = process.argv[2];
const code = require('fs').readFileSync(bundlePath, 'utf8');

// ── stubs ──
let sectionEntry = null;
let dockEntry = null;
const registered = [];
const ctxStub = {
  get(name) {
    if (name === 'slots') return slotsStub;
    if (name === 'locale') return localeStub;
    return undefined;
  },
  effect(fn) { fn(); }
};
const localeStub = {
  register(ns, dict) { console.log('locale.register', ns); return () => {}; },
  bind(ns) { return (key) => `${key}:${ns}`; }
};
const slotsStub = {
  register(opts, component) {
    const entry = { options: opts, component };
    registered.push({ opts, hasComponent: typeof component === 'function' || (component && typeof component.render === 'function') });
    if (opts.id === 'verification' && opts.name === 'settings.section') sectionEntry = entry;
    if (opts.id === 'verification' && opts.name === 'conversation.input.dock') dockEntry = entry;
    return () => {};
  },
  inject(name, fn) { fn(); }
};

// window stub + __ModuleLoader__
global.window = {};
window.__ModuleLoader__ = {
  load({ id, factory }) {
    const require = (spec) => requireCache[spec];
    const result = factory(require);
    window.__loadedModule = result;
  }
};
const requireCache = {
  'react/jsx-runtime': require('react/jsx-runtime'),
  'react': React
};

try {
  // eslint-disable-next-line no-eval
  new Function('window', code)(window);
} catch (error) {
  console.log('LOAD_ERROR', error && error.stack || error);
  process.exit(2);
}

const mod = window.__loadedModule;
console.log('module exports keys:', Object.keys(mod || {}));
console.log('has apply:', typeof mod?.apply, 'has inject:', Array.isArray(mod?.inject) && JSON.stringify(mod.inject), 'has name:', mod?.name);

// invoke apply with stubbed ctx
try {
  mod.apply(ctxStub);
} catch (error) {
  console.log('APPLY_ERROR', error && error.stack || error);
  process.exit(3);
}
console.log('settings.section registered:', !!sectionEntry, ' dock registered:', !!dockEntry);

// render SettingsPanel with { close, t } props (shell would pass inject props)
try {
  const Component = sectionEntry.component;
  const html = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Component, { close: () => {}, t: (k) => `[${k}]` })
  );
  console.log('SETTINGS_HTML:', JSON.stringify(html));
} catch (error) {
  console.log('RENDER_ERROR', error && error.stack || error);
  process.exit(4);
}
