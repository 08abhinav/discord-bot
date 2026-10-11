// Wrangler bundles these as binary data: .wasm as a compiled module, .ttf as
// an ArrayBuffer (see `rules` in wrangler.jsonc).
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

declare module "*.ttf" {
  const data: ArrayBuffer;
  export default data;
}
