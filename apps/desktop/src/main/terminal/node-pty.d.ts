// Compatibility shim for `node-pty` when installed via
// `npm:@homebridge/node-pty-prebuilt-multiarch`.
//
// The prebuilt package declares its types under
// `declare module '@homebridge/node-pty-prebuilt-multiarch'`, but our codebase
// imports `node-pty`. This bridges the module name for TypeScript.

declare module 'node-pty' {
  const pty: any;
  export = pty;
}

