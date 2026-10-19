# extract-study-vocabulary

An AI agent skill that turns English audio or documents into a Chinese–English study word list.

把英语录音或文档变成中英对照的生词表，并累积到一个 Excel 词库里，方便复习。

Give it a lecture recording, a podcast, a transcript, or a PDF, and the agent will:

1. Extract the text (or transcribe the audio locally with faster-whisper large-v3, with timestamps).
2. Pick out useful high-frequency words, fixed phrases, and key technical terms. Function words and fillers are skipped.
3. Translate each item into Chinese in the sense it's used in the material, with an example sentence and its translation.
4. Add everything to a cumulative Excel workbook. Repeated words get their counts merged, and the same material is never imported twice. Your own review columns (掌握程度、复习日期、个人笔记) are kept.

## Supported input

TXT, Markdown, DOCX, text-based PDF, MP3, WAV, M4A (plus AAC, FLAC, OGG), or pasted text.

## Install

Copy this folder into your agent's skills directory, for example:

- Claude Code: `~/.claude/skills/extract-study-vocabulary/`
- Codex: your Codex skills folder (`agents/openai.yaml` holds the Codex display metadata)

Python dependencies for `scripts/prepare_material.py`:

```bash
pip install -r requirements.txt
```

`python-docx` and `pypdf` are only needed for DOCX and PDF files. `faster-whisper` is only needed for audio. A CUDA GPU is used when available, otherwise the CPU.

## Configuration

All settings are optional environment variables.

| Variable | Used by | Purpose |
|---|---|---|
| `VOCAB_WORKBOOK` | skill, `update_workbook.mjs` | Path of the cumulative workbook. Without it, the agent asks once (default `英语学习词库.xlsx` in the workspace). |
| `WHISPER_MODEL` | `prepare_material.py` | faster-whisper model name or local path. Default `large-v3` (downloaded on first use). |
| `WHISPER_MODEL_DIR` | `prepare_material.py` | A Hugging Face cache folder that already contains `models--Systran--faster-whisper-large-v3`, to avoid downloading. |
| `WHISPER_PACKAGES_DIR` | `prepare_material.py` | Extra folder added to the Python path, for a faster-whisper install kept outside your main Python. |
| `ARTIFACT_TOOL_PATH` | `update_workbook.mjs` | Path to `@oai/artifact-tool`'s `dist/artifact_tool.mjs` when it can't be imported by name. |

## Workbook format

- **词汇总表**: 词汇/短语, 词性, 中文释义, 入选类型, 累计词频, 来源材料数, 代表例句, 例句翻译, 来源位置, 首次收录, 最近收录, 掌握程度, 复习日期, 个人笔记
- **来源明细**: one row per term per source, keyed by the source file's SHA-256 fingerprint

An existing workbook is backed up (`*.bak-<timestamp>`) before every write.

## Limitations

- `scripts/update_workbook.mjs` writes Excel through `@oai/artifact-tool`, which ships with the OpenAI Codex runtime and is **not published on npm**. Outside Codex, set `ARTIFACT_TOOL_PATH`, or adapt the script to another XLSX library.
- Scanned PDFs (images without a text layer) are not OCR'd.
- Translations come from the agent. Uncertain ones are marked `待核实` for you to check.

## Files

```
SKILL.md                     instructions the agent follows
agents/openai.yaml           Codex display metadata
scripts/prepare_material.py  text extraction / transcription + candidate word counts
scripts/update_workbook.mjs  merges entries into the Excel workbook
```
