---
name: extract-study-vocabulary
description: Use when the user uploads or pastes English audio, a transcript, text, TXT, Markdown, DOCX, extractable PDF, MP3, WAV, or M4A and asks for high-frequency vocabulary, keywords, Chinese translations, or a review word list.
---

# Extract Study Vocabulary

Turn an English recording or document into useful study vocabulary and keep a cumulative Excel workbook. The workbook path is `$VOCAB_WORKBOOK` when that environment variable is set; otherwise ask the user once where to keep it (default: `英语学习词库.xlsx` in the current workspace) and reuse that path.

## Workflow

1. Identify the uploaded file or pasted text and give it a stable material title. Run `scripts/prepare_material.py --input <path> --json` for files. For pasted text, write a temporary UTF-8 text file in the workspace first. The script extracts TXT/Markdown, DOCX, and text-based PDF; for MP3/WAV/M4A it uses the faster-whisper large-v3 model, CUDA first and CPU fallback, and returns timestamped segments. See the README for the optional `WHISPER_MODEL`, `WHISPER_MODEL_DIR` and `WHISPER_PACKAGES_DIR` settings.
2. If the script reports no usable text, an unreadable file, or an unreliable/empty transcript, explain the issue and stop without changing the workbook.
3. Use the returned text and candidates to select study items. Exclude function words, fillers, and fragments. Keep useful frequent content words, fixed phrases, and content-critical technical terms even when they occur once. Normalize obvious word forms for frequency, but preserve the source phrase. A term can have both `高频词` and `关键词` labels.
4. For every selected item, produce JSON with these fields: `term`, `pos`, `translation`, `category` (string or array), `count`, `example`, `example_translation`, `location`, and optional `confidence`. Use the meaning in this material; mark uncertain translations with `待核实`.
5. Save that JSON array and invoke `scripts/update_workbook.mjs --entries <entries.json> --source <prepared.json> --output <workbook.xlsx>`. When running in Codex, before the first create/edit operation, run the spreadsheet skill's `container_tools/mark_artifact_operation_started.mjs` once with `--operation-kind create` for a new workbook or `edit` for an existing one.
6. Report the number of new and updated items and link the workbook. Do not paste a full transcript unless asked; mention that the prepared transcript is retained only as a processing artifact.

## Workbook contract

`词汇总表` has: 词汇/短语, 词性, 中文释义, 入选类型, 累计词频, 来源材料数, 代表例句, 例句翻译, 来源位置, 首次收录, 最近收录, 掌握程度, 复习日期, 个人笔记. `来源明细` records source fingerprint, material, term, count, meaning, example, translation, location, and collection date. The updater backs up an existing workbook, skips an already-seen source fingerprint, preserves manual review fields, and keeps separate rows for different contextual senses.

## Failure handling

Never invent a translation, frequency, timestamp, or source. If Excel is locked, keep the generated entries and source JSON in the workspace and tell the user the workbook must be closed before retrying. Do not overwrite a workbook after a failed export or verification.
