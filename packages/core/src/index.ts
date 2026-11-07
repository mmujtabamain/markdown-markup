// @mkp/core: the DOM-free compiler, evaluator, maths engine, Markdown writer and runtime.
// The runtime half (what drawing a compiled bundle needs) is ./renderer, built on its own as mkp-runtime.js.
export * from './renderer';
export * from './types';
export { CORE_MKP, REQUIRED_TOKENS } from './base';
export { parseMkp, parseExprString, parseValueString } from './syntax/mkp';
export { parseDoc } from './syntax/doc';
export { compile, Compiled, digest, stripPos, omitPos, type CompileOptions, type PackSource } from './build';
export { readZip, writeZip, loadPack, sanitizeSvg, safePath } from './pack';
export { markdownToNodes } from './markdown';
export { canonicalJson } from './util/jcs';
export { sha256 } from './util/sha256';
export { toBase64, fromBase64 } from './util/base64';
export { compilePixels, renderPixelsCpu, encodePng, pngDataUri, sampleMesh } from './gfx/compile';
export { writeMarkdown, canvasSvg, type MdToggle, type MdOptions, type MdResult } from './md';
export { expand } from './expand';
export { fixtureCases, caseDocument, compileCase, missingFixtures, fixtureShape, type FixtureCase, type FixtureFile, type PlayStep } from './fixtures';
export { MkpPrinter, DocPrinter, printFile, fileItems, valSrc, yamlText, type FileItem, type PrintContext } from './print';
export { canonical } from './syntax/canon';
export { IR_SCHEMAS, inputSchema, valueSchema, fixtureSchema } from './schemas';
export { indexLine, signatureText, copySource } from './catalog';
export { checkDocument } from './check/doc';
