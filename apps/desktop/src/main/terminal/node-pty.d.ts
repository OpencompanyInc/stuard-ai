// Type shim for `node-pty`.
// We use dynamic require() with `any` typing in pty-manager.ts,
// so this keeps TypeScript happy without pulling in full typings.

declare module 'node-pty' {
  const pty: any;
  export = pty;
}

