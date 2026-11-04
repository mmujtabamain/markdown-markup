// Stands in for speech-rule-engine/js/common/system_external.js when the maths engine is bundled.
// The original finds an XML DOM through `window` or eval('require'), which fails under Hermes and in
// ES module test runners; this one imports @xmldom/xmldom and wicked-good-xpath directly, never
// touches the file system, and loads speech locales only through the custom loader.
const xmldom = require('@xmldom/xmldom');
const wgx = require('wicked-good-xpath');
const variables = require('speech-rule-engine/js/common/variables.js');

class SystemExternal {
  static nodeRequire() {
    return null;
  }
  static extRequire() {
    return null;
  }
}
SystemExternal.windowSupported = false;
SystemExternal.documentSupported = false;
SystemExternal.xmldom = xmldom;
SystemExternal.document = new xmldom.DOMImplementation().createDocument('', '', 0);
SystemExternal.xpath = (function () {
  const window = { document: {}, XPathResult: {} };
  wgx.install(window);
  window.document.XPathResult = window.XPathResult;
  return window.document;
})();
SystemExternal.mathmapsIePath = '';
// a read-only file system over the bundled locales, so the engine loads them the way it does in Node
const LOCALES = {
  base: require('speech-rule-engine/lib/mathmaps/base.json'),
  en: require('speech-rule-engine/lib/mathmaps/en.json'),
};
const localeOf = (file) => (/([A-Za-z-]+)\.json$/.exec(String(file)) || [])[1];
SystemExternal.fs = {
  readFileSync(file) {
    const l = LOCALES[localeOf(file)];
    if (l === undefined) throw new Error('no bundled locale for ' + file);
    return l;
  },
  readFile(file, _enc, cb) {
    const l = LOCALES[localeOf(file)];
    setTimeout(() => (l === undefined ? cb(new Error('no bundled locale for ' + file)) : cb(null, l)), 0);
  },
};
SystemExternal.locales = LOCALES;
SystemExternal.url = variables.Variables.url;
SystemExternal.jsonPath = '/mathmaps';
SystemExternal.WGXpath = variables.Variables.WGXpath;
SystemExternal.wgxpath = null;
exports.SystemExternal = SystemExternal;
exports.default = SystemExternal;
