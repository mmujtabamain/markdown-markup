// The maths engine: MathJax (TeX in, SVG out, no DOM) and the Speech Rule Engine (spoken text).
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { SerializedMmlVisitor } = require('mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js');
const { STATE } = require('mathjax-full/js/core/MathItem.js');
require('mathjax-full/js/input/tex/base/BaseConfiguration.js');
require('mathjax-full/js/input/tex/ams/AmsConfiguration.js');
require('mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js');
require('mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js');
require('mathjax-full/js/input/tex/cancel/CancelConfiguration.js');
require('mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js');
const sre = require('speech-rule-engine/js/common/system.js');

module.exports = {
  mathjax,
  TeX,
  SVG,
  liteAdaptor,
  RegisterHTMLHandler,
  SerializedMmlVisitor,
  STATE,
  sre: { setupEngine: sre.setupEngine, engineReady: sre.engineReady, toSpeech: sre.toSpeech },
  locales: {
    base: require('speech-rule-engine/lib/mathmaps/base.json'),
    en: require('speech-rule-engine/lib/mathmaps/en.json'),
  },
};
