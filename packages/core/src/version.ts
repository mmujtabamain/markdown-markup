// MKP's version: the repository's VERSION file, put in by the build (scripts/dist.mjs and the CLI's
// build define __MKP_VERSION__). Run from source, as the tests do, it is "dev".
declare const __MKP_VERSION__: string | undefined;

export const VERSION: string = typeof __MKP_VERSION__ === 'string' ? __MKP_VERSION__ : 'dev';

/**
 * The release this source is, written into every bundle, lock and migrated source as its stamp. It
 * moves with the VERSION file (a test holds them together); VERSION above is what a build was told,
 * "dev" when run from source.
 */
export const RELEASE = '0.2.7';
