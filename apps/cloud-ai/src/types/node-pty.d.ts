// node-pty is an optional native dependency loaded at runtime
declare module 'node-pty' {
  export function spawn(file: string, args: string[], options: any): any;
}
