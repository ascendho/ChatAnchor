import { build } from "esbuild";

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.cjs",
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode", "node:sqlite"],
  sourcemap: true,
  minify: false,
  logLevel: "info",
});
