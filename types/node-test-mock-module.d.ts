// `mock.module()` renamed its named-exports option from `namedExports` to
// `exports`. Node 24 (this repo's runtime) emits
// "DeprecationWarning: mock.module(): options.namedExports is deprecated.
// Use options.exports instead." but package.json pins @types/node ^20.19.39,
// whose MockModuleOptions predates the rename.
//
// Declare the option the runtime already accepts so tests can use the
// non-deprecated name. Delete this file once @types/node is bumped past 22 —
// `exports` is declared upstream from there on.
import "node:test";

declare module "node:test" {
  namespace test {
    interface MockModuleOptions {
      /**
       * An object whose keys and values are used to create the named exports
       * of the mock module. Replaces the deprecated `namedExports`.
       */
      exports?: object | undefined;
    }
  }
}
