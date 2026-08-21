# Docs Engine Integration Plan

این سند در برنامه نهایی زیر ادغام شده است. نسخه انگلیسی مرجع canonical اجرا است:

[`project-plan-ai-docs-assistant.md`](./project-plan-ai-docs-assistant.md)

[`project-plan-ai-docs-assistant.en.md`](./project-plan-ai-docs-assistant.en.md)

مرجع نهایی معماری، migration، AvalAI، admin، proxy، UI، امنیت، performance، تست و rollout همان فایل است.

## تصمیم‌های قطعی engine

- `../deepdocsengine` repository و deployment جدا می‌ماند؛ کپی یا submodule نمی‌شود.
- engine فقط ingestion/retrieval را انجام می‌دهد؛ AvalAI completion در Next.js اجرا می‌شود تا key و model موجود در admin یک source of truth داشته باشند.
- endpoint داخلی جدید `/retrieve` با `ENGINE_API_TOKEN` اضافه می‌شود.
- `/ingest`, `/documents`, `/query` و `/retrieve` private می‌شوند؛ فقط `/health` عمومی می‌ماند.
- CORS permissive حذف می‌شود.
- Qdrant storage persistent و collection با embedding model/version نسخه‌گذاری می‌شود.
- UI فقط `POST /api/docs-query` را فراخوانی می‌کند و مستقیم به engine یا AvalAI وصل نمی‌شود.
- «پاسخ دقیق» یعنی پاسخ grounded و قابل ارزیابی، نه تضمین مطلق LLM: هر ادعای فنی citation معتبر دارد و در نبود منبع، assistant صریحاً abstain می‌کند.
- حالت‌های `normal`, `tutorial`, `command` فقط قالب پاسخ را تغییر می‌دهند؛ model، provider، prompt و retrieval limit در اختیار browser نیستند.
- metadata معتبر `title/url/anchor` هنگام build corpus از MDX در manifest ثبت می‌شود؛ حدس‌زدن anchor از Markdown تبدیل‌شده مجاز نیست.
- ingestion در startup سرویس query اجرا نمی‌شود و corpus خالی/ناموجود هرگز collection فعال را پاک نمی‌کند.
- hybrid retrieval باید dense و lexical candidateهای مستقل داشته باشد؛ rerank فقط روی نتایج dense، hybrid واقعی نیست.
- collection جدید با embedding/chunker/corpus version ساخته، ارزیابی و سپس با alias فعال می‌شود؛ collection فعال in-place بازنویسی نمی‌شود.
- contract نهایی browser شامل `meta`, `sources`, `delta`, `suggestions`, `done`, `error` است و mock و transport واقعی دقیقاً همین contract را مصرف می‌کنند.

در هر تعارض، `project-plan-ai-docs-assistant.en.md` اولویت دارد.
