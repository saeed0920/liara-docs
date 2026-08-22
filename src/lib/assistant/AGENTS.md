# Assistant prompt-engineering rule: always ground in page context

The docs assistant must never answer as a generic chatbot. Every request carries
the page the user is actually looking at, and both retrieval and the prompt
must use it:

1. **Retrieval is page-aware.** `transport.mjs` sends `page.path` in every
   request; `docs-query-handler.mjs` passes it to `retrieveDocs()`
   (`engine-client.mjs`), which forwards `page_path` to the search engine so
   results can be biased toward the current page. Never strip or make this
   optional.
2. **The prompt states the page explicitly.** `buildPromptV1()` in
   `prompt.mjs` injects `CURRENT_PAGE_PATH` and instructs the model to prefer
   citing sources that match/nest under it over unrelated matches. Keep that
   instruction when editing the system prompt — it's why "how do I set env
   vars" answers with the *current* framework's docs instead of a random one.
3. **Grounding still wins over page bias.** Page context ranks relevance, it
   never overrides the "only answer from CURRENT_SOURCES, cite real source
   IDs" rule. If the page has no matching source, fall back to the best
   retrieved source normally — do not force-cite the current page.
4. **Mode changes formatting only** (`normal`/`tutorial`/`command` in
   `MODE` map) — never touch grounding/citation rules. Don't fork a new mode
   without also updating `docs-query-request.mjs`'s `MODES` allowlist and the
   UI's `MODES` array in `components/Assistant/index.jsx` — all three must
   agree or requests get silently rejected as `INVALID_REQUEST`.

Checklist for adding assistant features: does it still send `page.path`
through retrieval, does the model still see `CURRENT_PAGE_PATH`, and does it
still cite only from `CURRENT_SOURCES`? If any answer is no, it's a
regression of this rule, not a new feature.
