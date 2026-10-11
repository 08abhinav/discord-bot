// Turns the share card's SVG into a PNG. This is the only file that touches
// the WebAssembly rasterizer and the font files, so everything else (and the
// tests) can stay plain TypeScript. src/index.ts loads it on demand.
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import plexSans from "../assets/fonts/IBMPlexSans-Medium.ttf";
import jetbrainsMono from "../assets/fonts/JetBrainsMono-Bold.ttf";
import { CARD_WIDTH } from "./card";

let ready: Promise<void> | undefined;

export async function renderPng(svg: string): Promise<Uint8Array> {
  // The module is compiled once per isolate.
  ready ??= initWasm(resvgWasm);
  await ready;
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: CARD_WIDTH },
    font: {
      fontBuffers: [new Uint8Array(jetbrainsMono), new Uint8Array(plexSans)],
      loadSystemFonts: false,
      defaultFontFamily: "IBM Plex Sans",
    },
  });
  const image = resvg.render();
  try {
    return image.asPng();
  } finally {
    image.free();
    resvg.free();
  }
}

/** A contributor's GitHub avatar as a data: URI, or undefined when it can't be fetched. */
export async function fetchAvatar(login: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://github.com/${encodeURIComponent(login)}.png?size=360`, {
      headers: { "User-Agent": "codercops-discord-bot" },
    });
    const type = res.headers.get("Content-Type") ?? "";
    if (!res.ok || !/^image\/(png|jpeg|gif|webp)/.test(type)) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // An avatar is a few dozen kilobytes. Refuse anything that isn't.
    if (bytes.length > 1_000_000) return undefined;
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type.split(";")[0]};base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}
