import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
const assets = {};
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${item.name}`;
    if (item.isDirectory()) await walk(file);
    else {
      if (/\/(eagle\.png|map\.jpg|aisc-wordmark\.png)$/.test(file)) continue;
      assets["/" + file.slice(3)] = (await readFile(file)).toString("base64");
    }
  }
}
await walk("ui");
await mkdir("agent/lib/generated", { recursive: true });
await writeFile(
  "agent/lib/generated/ui.mjs",
  "export default " + JSON.stringify(assets) + ";\n",
);
