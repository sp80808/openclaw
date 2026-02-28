```skill
---
name: parallel-multimodal-executor
description: Execute intensive prompts across multiple free backends in parallel and fuse consensus.
---

# parallel-multimodal-executor

Use this skill when prompts are intensive or multi-modal.

Pipeline:
- Fanout to 2-4 OpenRouter free models
- Run Gemini CLI in parallel
- Merge candidates into consensus output with disagreements preserved
```
