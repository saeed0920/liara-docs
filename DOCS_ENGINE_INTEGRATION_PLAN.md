# Docs Engine Integration Plan

این سند در برنامه نهایی زیر ادغام شده است:

[`project-plan-ai-docs-assistant.md`](./project-plan-ai-docs-assistant.md)

مرجع نهایی معماری، migration، AvalAI، admin، proxy، UI، امنیت، performance، تست و rollout همان فایل است.

## تصمیم‌های قطعی engine

- `../deepdocsengine` repository و deployment جدا می‌ماند؛ کپی یا submodule نمی‌شود.
- engine فقط ingestion/retrieval را انجام می‌دهد؛ AvalAI completion در Next.js اجرا می‌شود تا key و model موجود در admin یک source of truth داشته باشند.
- endpoint داخلی جدید `/retrieve` با `ENGINE_API_TOKEN` اضافه می‌شود.
- `/ingest`, `/documents`, `/query` و `/retrieve` private می‌شوند؛ فقط `/health` عمومی می‌ماند.
- CORS permissive حذف می‌شود.
- Qdrant storage persistent و collection با embedding model/version نسخه‌گذاری می‌شود.
- UI فقط `POST /api/docs-query` را فراخوانی می‌کند و مستقیم به engine یا AvalAI وصل نمی‌شود.

در هر تعارض، `project-plan-ai-docs-assistant.md` اولویت دارد.
