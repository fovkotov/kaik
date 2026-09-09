import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "public", "assets", "cards", "works");
const destDir = path.join(root, "public", "works", "files");
const catalogPath = path.join(root, "public", "works", "catalog.json");

const ENTRIES = [
  ["alena-1.svg", "Алёна", "alenuchotam", 810, 248],
  ["andrei-fresh.svg", "Андрей", "iamprpl", 812, 222],
  ["kira.svg", "Кира", "k1pk1p", 419, 197],
  ["nadya.svg", "Надя", "oh_narcy", 391, 198],
  ["masha.svg", "Маша", "mashaaaaaam", 812, 302],
  ["masha-polina.svg", "Маша Полина", "pelagieonmashaaaaaam", 419, 130],
  ["alena-2.svg", "Алёна", "alenuchotam", 389, 130],
  ["danil.svg", "Данил", "fursovdm", 419, 169],
  ["polina-pair.svg", "Полина", "pelagieon", 391, 169],
  ["polina-big.svg", "Полина", "pelagieon", 810, 512],
  ["kira-wide.svg", "Кира", "k1pk1p", 810, 125],
  ["storm-stencil.svg", "Андрей", "iamprpl", 419, 158],
  ["storm-tribal.svg", "Андрей", "iamprpl", 391, 158],
  ["storm-serif.svg", "Андрей", "iamprpl", 419, 148],
  ["storm-ornament.svg", "Андрей", "iamprpl", 391, 148],
  ["roma.svg", "Рома", "rameoky", 810, 350],
  ["andrei-fov.svg", "Андрей", "fovkotov", 419, 139],
  ["nadya-wide.svg", "Надя", "oh_narcy", 391, 139],
  ["ksusha-1.svg", "Ксюша", "dirigible4", 419, 156],
  ["ksusha-2.svg", "Ксюша", "dirigible4", 391, 156],
  ["bogdan.svg", "Богдан", "Ybludok47", 810, 460],
  ["alena-pichh.svg", "Алена", "alenapichh", 810, 138],
  ["katya.svg", "Катя", "hurujoi", 810, 526],
  ["nadya-3.svg", "Надя", "oh_narcy", 419, 126],
  ["yan.svg", "Ян", "l200kmhinthewronglane", 391, 127],
  ["nadya-mouth.svg", "Надя", "oh_narcy", 810, 285],
  ["ksusha-3.svg", "Ксюша", "dirigible4", 419, 129],
  ["nadya-plus.svg", "Надя", "oh_narcy", 391, 129],
  ["cluster.svg", "", "", 810, 331],
  ["anya-left.svg", "Аня", "dontcatchbirds", 419, 160],
  ["anya-right.svg", "Аня", "dontcatchbirds", 391, 161],
  ["anya-row-l.svg", "Аня", "dontcatchbirds", 420, 159],
  ["anya-row-r.svg", "Аня", "dontcatchbirds", 390, 158],
  ["alena-last.svg", "Алёна", "alenuchotam", 810, 157],
];

function workId(file) {
  return `wrk_${createHash("sha1").update(file).digest("hex").slice(0, 8)}`;
}

const base = Date.parse("2026-09-08T15:00:00.000Z");

await fs.mkdir(destDir, { recursive: true });

const items = [];
for (const [index, [file, author, nick, width, height]] of ENTRIES.entries()) {
  const id = workId(file);
  const destName = `${id}_0.svg`;
  await fs.copyFile(path.join(srcDir, file), path.join(destDir, destName));
  items.push({
    id,
    type: "lettering",
    author,
    nick,
    stream: "1",
    files: [destName],
    width,
    height,
    originalName: file,
    createdAt: new Date(base - index * 60_000).toISOString(),
  });
}

const catalog = {
  version: 1,
  updatedAt: new Date().toISOString(),
  items,
};

await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(`seeded ${items.length} works → ${catalogPath}`);
