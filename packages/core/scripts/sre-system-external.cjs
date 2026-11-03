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
SystemExternal.fs = null;
SystemExternal.url = variables.Variables.url;
SystemExternal.jsonPath = '';
SystemExternal.WGXpath = variables.Variables.WGXpath;
SystemExternal.wgxpath = null;
exports.SystemExternal = SystemExternal;
exports.default = SystemExternal;
