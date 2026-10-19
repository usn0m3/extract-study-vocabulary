import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
// @oai/artifact-tool ships with the Codex runtime and is not on npm. Outside a project that can
// resolve it, point ARTIFACT_TOOL_PATH at its dist/artifact_tool.mjs.
let artifactTool;
try {
  artifactTool = await import("@oai/artifact-tool");
} catch {
  const bundled = process.env.ARTIFACT_TOOL_PATH;
  if (!bundled) {
    throw new Error("Cannot load @oai/artifact-tool. Run inside Codex, or set ARTIFACT_TOOL_PATH to its dist/artifact_tool.mjs.");
  }
  artifactTool = await import(pathToFileURL(bundled).href);
}
const { FileBlob, SpreadsheetFile, Workbook } = artifactTool;

const args = process.argv.slice(2);
const arg = (name, fallback = undefined) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const entriesPath = arg("--entries");
const sourcePath = arg("--source");
const outputPath = arg("--output", process.env.VOCAB_WORKBOOK || "英语学习词库.xlsx");
if (!entriesPath || !sourcePath) throw new Error("Usage: update_workbook.mjs --entries entries.json --source prepared.json --output workbook.xlsx");

const entries = JSON.parse(await fs.readFile(entriesPath, "utf8"));
const prepared = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const source = prepared.source;
const now = new Date().toISOString().slice(0, 10);
const summaryHeaders = ["词汇/短语", "词性", "中文释义", "入选类型", "累计词频", "来源材料数", "代表例句", "例句翻译", "来源位置", "首次收录", "最近收录", "掌握程度", "复习日期", "个人笔记"];
const detailHeaders = ["来源指纹", "材料", "词汇/短语", "词频", "语境释义", "例句", "例句翻译", "来源位置", "收录日期"];

let workbook;
try {
  workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
} catch {
  workbook = Workbook.create();
}
const getOrAdd = (name) => {
  const existing = workbook.worksheets.items.find((sheet) => sheet.name === name);
  return existing || workbook.worksheets.add(name);
};
const summary = getOrAdd("词汇总表");
const details = getOrAdd("来源明细");
const readRows = (sheet) => {
  const used = sheet.getUsedRange(true);
  return used ? (used.values || []) : [];
};
let summaryRows = readRows(summary);
let detailRows = readRows(details);
if (!summaryRows.length || String(summaryRows[0][0] || "") !== summaryHeaders[0]) summaryRows = [summaryHeaders];
if (!detailRows.length || String(detailRows[0][0] || "") !== detailHeaders[0]) detailRows = [detailHeaders];
const detailSourceSet = new Set(detailRows.slice(1).map((row) => String(row[0] || "")).filter(Boolean));
if (detailSourceSet.has(source.sha256)) {
  console.log(JSON.stringify({ skipped: true, reason: "source-already-seen", sha256: source.sha256 }));
  process.exit(0);
}

const keyOf = (term, pos, meaning) => `${String(term).trim().toLowerCase()}|${String(pos || "").trim().toLowerCase()}|${String(meaning || "").trim()}`;
const existing = new Map();
summaryRows.slice(1).forEach((row, index) => existing.set(keyOf(row[0], row[1], row[2]), { row, index: index + 1 }));
let added = 0;
let updated = 0;
for (const item of entries) {
  const categories = Array.isArray(item.category) ? item.category.join("、") : String(item.category || "关键词");
  const count = Number(item.count || 1);
  const key = keyOf(item.term, item.pos, item.translation);
  const hit = existing.get(key);
  if (hit) {
    hit.row[3] = [...new Set([String(hit.row[3] || ""), categories].flatMap((value) => value.split("、").map((part) => part.trim()).filter(Boolean)))].join("、");
    hit.row[4] = Number(hit.row[4] || 0) + count;
    hit.row[5] = Number(hit.row[5] || 0) + (String(hit.row[5] || "").includes(source.title) ? 0 : 1);
    if (!hit.row[6] && item.example) hit.row[6] = item.example;
    if (!hit.row[7] && item.example_translation) hit.row[7] = item.example_translation;
    hit.row[8] = [hit.row[8], item.location].filter(Boolean).join("；");
    hit.row[10] = now;
    updated += 1;
  } else {
    const row = [item.term, item.pos || "", item.translation || "待核实", categories, count, 1, item.example || "", item.example_translation || "", item.location || "", now, now, "未学", "", ""];
    summaryRows.push(row);
    existing.set(key, { row, index: summaryRows.length - 1 });
    added += 1;
  }
  detailRows.push([source.sha256, source.title, item.term, count, item.translation || "待核实", item.example || "", item.example_translation || "", item.location || "", now]);
}

const writeSheet = (sheet, rows, headers, tableName) => {
  const lastCol = String.fromCharCode(64 + headers.length);
  sheet.getRange(`A1:${lastCol}${rows.length}`).values = rows;
  sheet.getRange(`A1:${lastCol}1`).format = { fill: "#1F4E78", font: { bold: true, color: "#FFFFFF" }, wrapText: true };
  sheet.getRange(`A1:${lastCol}${rows.length}`).format.wrapText = true;
  sheet.getRange(`A1:${lastCol}${rows.length}`).format.verticalAlignment = "center";
  sheet.freezePanes.freezeRows(1);
  sheet.showGridLines = false;
  const hasTable = (sheet.tables?.items || []).some((table) => table.name === tableName);
  if (!hasTable) sheet.tables.add(`A1:${lastCol}${Math.max(2, rows.length)}`, true, tableName);
};
writeSheet(summary, summaryRows, summaryHeaders, "VocabularyTable");
writeSheet(details, detailRows, detailHeaders, "VocabularySourcesTable");
summary.getRange("A:A").format.columnWidth = 22;
summary.getRange("B:B").format.columnWidth = 10;
summary.getRange("C:C").format.columnWidth = 22;
summary.getRange("D:D").format.columnWidth = 16;
summary.getRange("E:F").format.columnWidth = 12;
summary.getRange("G:H").format.columnWidth = 32;
summary.getRange("I:I").format.columnWidth = 18;
summary.getRange("J:K").format.columnWidth = 13;
summary.getRange("L:N").format.columnWidth = 14;
details.getRange("A:A").format.columnWidth = 68;
details.getRange("B:C").format.columnWidth = 22;
details.getRange("D:D").format.columnWidth = 10;
details.getRange("E:G").format.columnWidth = 28;
details.getRange("H:I").format.columnWidth = 18;
workbook.recalculate();
await fs.mkdir(path.dirname(outputPath), { recursive: true });
try {
  await fs.access(outputPath);
  await fs.copyFile(outputPath, `${outputPath}.bak-${Date.now()}`);
} catch {}
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ skipped: false, added, updated, source: source.title, workbook: outputPath }));
