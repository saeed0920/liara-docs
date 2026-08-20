# برنامه اجرایی AI Docs Assistant لیارا

> وضعیت سند: آماده برای شروع فاز صفر
>
> آخرین بازبینی: ۲۰ اوت ۲۰۲۶

## 1. هدف

یک دستیار فارسی برای مستندات لیارا که داخل سایت فعلی در دسترس باشد، پاسخ را به‌صورت streaming نمایش دهد، فقط بر اساس مستندات پاسخ دهد و برای هر ادعای فنی citation قابل کلیک ارائه کند.

معیار موفقیت MVP، رسیدن سریع کاربر به یک پاسخ مستند است؛ طولانی‌تر شدن مکالمه معیار موفقیت نیست.

## 2. وضعیت واقعی پروژه

این برنامه بر اساس وضعیت فعلی repository نوشته شده و جایگزین فرض‌های نسخه قبلی است.

| بخش | وضعیت فعلی |
|---|---|
| Framework | Next.js با Pages Router و فایل‌های `src/pages` |
| خروجی production | static export با `output: "export"` و Nginx |
| زبان کد | JavaScript/JSX، بدون TypeScript اپلیکیشن |
| UI | Tailwind CSS 3.4، کامپوننت‌های اختصاصی و RTL |
| محتوای مستندات | بیش از ۱۱۰۰ فایل MDX در `src/pages` |
| محتوای مناسب LLM | Markdown تولیدشده در `public/llms` و catalog در `public/all-links-llms.txt` |
| جستجو | Meilisearch با index فعلی `docs` و crawler جدا در `indexer` |
| Backend/API | وجود ندارد؛ `src/pages/api` نیز وجود ندارد |
| Database/Auth | وجود ندارد؛ سایت عمومی و anonymous است |
| AI runtime | وجود ندارد؛ فقط نمونه‌های آموزشی داخل MDX وجود دارند |
| Dark mode | موجود و مبتنی بر `localStorage` |
| میانبر `Cmd/Ctrl+K` | در اختیار جستجوی فعلی است |
| تست و lint | تست وجود ندارد؛ script فعلی lint با Next.js 16 کار نمی‌کند |

### ناسازگاری‌های مهم قبل از پیاده‌سازی

- `package.json` در worktree روی Next.js 16 و React 19 قرار گرفته، اما نسخه committed پروژه Next.js 14 و React 18 بوده است.
- Next.js 16 به Node.js جدیدتر نیاز دارد، ولی `Dockerfile` هنوز از Node.js 18 استفاده می‌کند.
- `packageManager` به Yarn اشاره می‌کند، اما README، CI، Docker و lockfile از npm استفاده می‌کنند.
- scriptهای `generate-llms` به پوشه‌ی غایب `mdx-to-md-converter` وابسته‌اند؛ pipeline تولید corpus از fresh clone قابل تکرار نیست.
- فایل `components.json` به‌تنهایی به معنی نصب shadcn نیست؛ `cmdk`، Radix و `components/ui` فعلاً وجود ندارند.
- توضیحات فعلی سرویس AI لیارا می‌گوید prompt و response ذخیره نمی‌شوند. ذخیره‌ی conversation log نیازمند تصمیم حقوقی، consent، retention و redaction است.

## 3. تصمیم‌های معماری برای MVP

این تصمیم‌ها baseline پیشنهادی برای شروع هستند و جلوی بزرگ‌شدن بی‌دلیل scope را می‌گیرند.

1. سایت مستندات static باقی می‌ماند.
2. یک سرویس Node.js جدا با نام منطقی `assistant-api` مسئول retrieval، prompt، ارتباط با LLM، streaming و rate limiting می‌شود.
3. provider اولیه، API سازگار با OpenAI سرویس هوش مصنوعی لیارا است.
4. کاربران MVP مهمان هستند؛ شناسه‌ی rate limit از IP و یک `anonymous_session_id` تصادفی ساخته می‌شود.
5. conversation فقط در `sessionStorage` مرورگر نگهداری می‌شود و در backend ذخیره نمی‌شود.
6. retrieval اولیه از Meilisearch موجود استفاده می‌کند. pgvector فقط در صورت اثبات ضعف کیفیت retrieval اضافه می‌شود.
7. UI با الگوی فعلی پروژه و Tailwind 3 ساخته می‌شود؛ مهاجرت به App Router، Tailwind 4 یا shadcn جزو MVP نیست.
8. `Cmd/Ctrl+K` برای search باقی می‌ماند و دستیار با `Cmd/Ctrl+I` باز می‌شود.
9. تنها حالت desktop در MVP، `dock-right` است و زیر breakpoint `768px` به bottom sheet تبدیل می‌شود.
10. admin dashboard، auth، tutor mode، سه موقعیت chatbox و vector DB بعد از MVP هستند.

## 4. معماری هدف MVP

```text
┌─────────────────────────────────────────────────────────────┐
│ docs.liara.ir                                               │
│ Next.js Pages Router + static export                        │
│                                                             │
│ AssistantProvider در src/pages/_app.js                      │
│ Assistant UI در src/components/Assistant                    │
│ - dock-right در desktop                                     │
│ - bottom sheet در mobile                                    │
│ - sessionStorage برای thread                                │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS + SSE/data stream
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ assistant-api (سرویس Node.js جدا)                           │
│ - validation و CORS allowlist                               │
│ - token-bucket rate limit                                   │
│ - query expansion/retrieval                                 │
│ - system prompt و citation contract                         │
│ - stream پاسخ Liara AI                                     │
└──────────────────┬──────────────────────┬───────────────────┘
                   │                      │
                   ▼                      ▼
          Meilisearch index `docs`       Liara AI API
          title/body/url/element         LLM streaming
```

### چرا API جدا است؟

در production فعلی هیچ process مربوط به Node.js اجرا نمی‌شود و Nginx فقط پوشه‌ی `out` را سرو می‌کند. بنابراین Next.js API route در این repository بعد از static export در دسترس نخواهد بود. سرویس جدا کم‌ریسک‌ترین مسیر است و deployment فعلی docs را تغییر نمی‌دهد.

## 5. محدوده MVP

### داخل MVP

- launcher و chatbox در همه صفحات مستندات
- empty state با ۳ سوال پیشنهادی
- ارسال سوال و نمایش token-by-token پاسخ
- دکمه‌ی توقف generation و retry خطا
- پاسخ Markdown شامل heading، list، link، inline code و code block
- حداکثر ۵ citation شامل عنوان، URL و anchor
- کلیک citation، navigation به صفحه و highlight موقت section
- حفظ thread هنگام navigation در همان tab
- نمایش context صفحه‌ی فعلی به backend
- feedback محلی thumbs up/down بدون ذخیره‌ی متن مکالمه
- rate limit و پیام قابل فهم برای `429`
- light/dark mode، keyboard navigation و mobile bottom sheet

### خارج از MVP

- login و sync مکالمه بین deviceها
- ذخیره یا replay متن conversation
- pgvector و embedding pipeline
- reranker مبتنی بر مدل جدا
- admin dashboard کامل
- tutor mode و checklist پایدار
- command palette اختصاصی و command registry
- edit/branch/quote پیام
- سه variant مربوط به dock-left، dock-right و island
- voice، haptic و notification

## 6. قرارداد اولیه API

### Endpoint

`POST /v1/chat`

### Request

```json
{
  "sessionId": "anonymous-uuid",
  "message": "چطور دامنه را به برنامه متصل کنم؟",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "page": {
    "path": "/paas/nodejs/how-tos/add-domain/",
    "title": "اتصال دامنه"
  }
}
```

قواعد request:

- `message`: حداکثر ۲۰۰۰ کاراکتر
- `history`: حداکثر ۱۰ پیام آخر و حداکثر ۱۲۰۰۰ کاراکتر
- `sessionId`: UUID تولیدشده در client؛ هویت کاربر محسوب نمی‌شود
- server باید URL و roleها را validate کند و مقادیر اضافی را نپذیرد

### Stream eventها

| event | payload | کاربرد |
|---|---|---|
| `meta` | `requestId`, `model` | شروع request |
| `sources` | آرایه‌ی `id`, `title`, `url`, `anchor`, `snippet` | منابع بازیابی‌شده |
| `delta` | قطعه‌ی متن | ساخت تدریجی پاسخ |
| `suggestions` | ۲ یا ۳ سوال کوتاه | follow-up chips |
| `done` | `finishReason`, `usage` | پایان موفق |
| `error` | `code`, `message`, `retryable` | خطای کنترل‌شده |

### خطاهای عمومی

- `400`: ورودی نامعتبر
- `413`: متن یا history بیش از حد مجاز
- `429`: rate limit؛ همراه `Retry-After`
- `502`: خطای provider
- `504`: timeout upstream

## 7. Retrieval و citation

### منبع محتوا

- منبع اصلی ingestion، فایل‌های `public/llms/**/*.md` است؛ این فایل‌ها از JSX پاک شده‌اند و original URL دارند.
- تا زمان تعمیر converter، index فعلی Meilisearch که crawler آن HTML production را می‌خواند fallback است.
- هر chunk باید این metadata را داشته باشد: `title`, `body`, `url`, `anchor`, `product`, `updatedAt`.
- chunk بر اساس heading ساخته می‌شود، نه صرفاً تعداد ثابت token.

### مسیر MVP

1. query کاربر با عنوان و path صفحه‌ی فعلی ترکیب شود.
2. حداکثر ۸ نتیجه از Meilisearch گرفته شود.
3. نتایج تکراری یا بدون `body` حذف شوند.
4. حداکثر ۵ chunk با سقف context مشخص به prompt تزریق شوند.
5. مدل فقط مجاز است citation IDهای دریافت‌شده را استفاده کند.
6. backend citationهای ناشناخته را پیش از ارسال نهایی حذف یا request را fail کند.

### معیار عبور به pgvector

pgvector فقط وقتی وارد برنامه می‌شود که مجموعه ارزیابی نشان دهد keyword retrieval در کمتر از ۸۰٪ سوال‌ها یک منبع درست را در top-5 می‌آورد. تا قبل از اندازه‌گیری، database جدید اضافه نمی‌شود.

## 8. رفتار و طراحی UI

### ساختار

- provider در `src/pages/_app.js` mount می‌شود تا state هنگام navigation از بین نرود.
- UI در `src/components/Assistant/` قرار می‌گیرد.
- `Layout` فقط محل launcher/panel را فراهم می‌کند و مالک conversation state نیست.
- styling با utilityهای Tailwind 3 و الگوهای رنگی موجود انجام می‌شود.

### اصول بصری

- یک accent اصلی و باقی سطوح خنثی
- حداکثر سه اندازه‌ی typography داخل chatbox
- فاصله‌ی کافی میان پاسخ‌های فنی
- تفاوت user و assistant با alignment، icon و separator ظریف، نه bubbleهای سنگین
- transitionهای ۲۰۰ تا ۳۰۰ میلی‌ثانیه و احترام به `prefers-reduced-motion`

### تعامل

- launcher همیشه قابل دسترس باشد اما محتوای صفحه را نپوشاند.
- `Cmd/Ctrl+I` باز/بسته کردن، `Esc` بستن، و `Enter` ارسال است.
- `Shift+Enter` خط جدید ایجاد می‌کند.
- هنگام stream دکمه‌ی Stop همیشه دیده می‌شود.
- شروع stream یک skeleton کوتاه دارد؛ spinner طولانی استفاده نمی‌شود.
- بعد از پایان پاسخ ۲ یا ۳ follow-up suggestion نمایش داده می‌شود.
- navigation از citation، chat را باز نگه می‌دارد و target section را موقتاً highlight می‌کند.

### نمایش محتوای فنی

- renderer باید raw HTML را غیرفعال یا sanitize کند.
- code block شامل language label، copy button و horizontal scroll است.
- table در container با horizontal scroll رندر می‌شود.
- لینک خارجی icon و `rel="noopener noreferrer"` دارد.
- citation به‌شکل chip است و با hover یا tap عنوان، section و snippet را نشان می‌دهد.

### responsive و accessibility

- desktop: panel با عرض تقریبی ۴۰۰ تا ۴۸۰ پیکسل در سمت راست
- mobile/tablet زیر `768px`: bottom sheet با حداکثر ارتفاع viewport
- touch target حداقل ۴۴ پیکسل
- focus trap هنگام باز بودن sheet و بازگشت focus به launcher هنگام بستن
- `aria-live="polite"` برای پاسخ؛ announcementها نباید با هر token screen reader را مختل کنند
- تمام actionها با keyboard قابل اجرا باشند
- `lang` سند از `en` به `fa` و direction به RTL اصلاح شود

## 9. امنیت، حریم خصوصی و عملیات

- کلید Liara AI فقط در `assistant-api` نگهداری می‌شود.
- CORS فقط originهای docs production، preview و local development را می‌پذیرد.
- rate limit اولیه: ۲۰ request در دقیقه و ۱۰۰ request در روز برای IP/session با token bucket.
- timeout provider حداکثر ۴۵ ثانیه و abort client به upstream منتقل شود.
- prompt injection داخل اسناد یا سوال نباید system instruction را override کند.
- پاسخ خارج از context باید صریحاً بگوید منبع کافی در مستندات پیدا نشده است.
- MVP متن سوال، پاسخ و history را در database یا log ذخیره نمی‌کند.
- log مجاز شامل `requestId`، زمان، latency، status، model، token count و hash غیرقابل بازگشت session است.
- logها نباید API key، Authorization header، prompt یا retrieved body داشته باشند.
- feedback MVP فقط aggregate و بدون متن مکالمه است؛ در صورت نبود storage حتی می‌تواند فقط event تحلیلی باشد.

### متغیرهای محیطی پیشنهادی سرویس

```bash
LIARA_AI_BASE_URL=
LIARA_AI_API_KEY=
LIARA_AI_MODEL=
MEILI_ROOT_URL=
MEILI_PRIVATE_KEY=
ALLOWED_ORIGINS=https://docs.liara.ir,http://localhost:3001
RATE_LIMIT_PER_MINUTE=20
RATE_LIMIT_PER_DAY=100
```

## 10. System prompt نسخه اول

prompt باید versioned باشد و حداقل این بخش‌ها را داشته باشد:

```text
[Role: دستیار فنی مستندات لیارا]
[Language and tone: فارسی، کوتاه، مستقیم و دقیق]
[Scope: فقط context بازیابی‌شده و اطلاعات صفحه فعلی]
[Retrieved sources with immutable IDs]
[Citation syntax]
[Unknown-answer behavior]
[Security and prompt-injection rules]
[Conversation history]
[Current user question]
```

قواعد پاسخ:

- پاسخ را با نتیجه‌ی اصلی شروع کن.
- برای مراحل چندگانه از فهرست شماره‌دار استفاده کن.
- command، port، status code و مقدار فنی را inline code نمایش بده.
- هر ادعای برگرفته از مستندات باید citation معتبر داشته باشد.
- URL یا citation ساختگی تولید نکن.
- اگر context کافی نیست، عدم قطعیت را شفاف بیان کن و کاربر را به search یا پشتیبانی هدایت کن.
- پایان پاسخ را با سوال مصنوعی طولانی نکن؛ suggestionها جداگانه تولید می‌شوند.

## 11. فازهای اجرایی

هر فاز باید معیار خروج خود را کامل کند؛ شروع هم‌زمان فازهای وابسته توصیه نمی‌شود.

### فاز 0: تثبیت پایه پروژه

هدف: ایجاد baseline قابل build و تصمیم‌گیری درباره runtime پیش از افزودن AI.

- [ ] انتخاب و ثبت نسخه نهایی Next.js/React؛ پیشنهاد کم‌ریسک برای MVP، ماندن روی نسخه committed یعنی Next.js 14/React 18 است مگر upgrade جداگانه تأیید شود.
- [ ] یکسان‌کردن Node.js در local، CI و Docker؛ در صورت Next.js 16 حداقل Node.js 20.9.
- [ ] انتخاب npm و حذف declaration متناقض Yarn یا برعکس.
- [ ] جایگزینی `next lint` با ESLint CLI سازگار با نسخه انتخاب‌شده.
- [ ] افزودن build/lint به CI پیش از deploy.
- [ ] بازیابی `mdx-to-md-converter` یا ساخت script قابل تکرار برای `public/llms`.
- [ ] اصلاح `lang="fa"` و RTL در `_document.js`.
- [ ] تهیه حداقل ۳۰ سوال ارزیابی واقعی از بخش‌های AI، PaaS، DBaaS و Object Storage.

معیار خروج:

- `npm ci` و `npm run build` از fresh clone با runtime مستندشده اجرا می‌شوند.
- lint command معتبر است.
- corpus با یک command قابل بازتولید است.
- فایل ارزیابی شامل question، expected URL و expected anchor آماده است.

### فاز 1: Retrieval و backend عمودی

هدف: دریافت یک سوال با `curl` و گرفتن پاسخ streamشده با citation معتبر، بدون UI.

- [ ] ایجاد و deploy سرویس `assistant-api` با health endpoint.
- [ ] تعریف schema request/response مطابق بخش ۶.
- [ ] اتصال server-side به Meilisearch و قابل دریافت کردن `body` برای retrieval.
- [ ] پیاده‌سازی top-k، deduplication و context budget.
- [ ] اتصال streaming به Liara AI.
- [ ] افزودن prompt نسخه اول و validation مربوط به citation.
- [ ] پیاده‌سازی CORS، timeout، abort و token-bucket rate limit.
- [ ] افزودن structured metadata logs بدون ذخیره prompt/response.
- [ ] اجرای evaluation و ثبت recall@5 و citation validity.

معیار خروج:

- endpoint در local و محیط preview stream واقعی برمی‌گرداند.
- ۱۰۰٪ citationها URL موجود در retrieved sources دارند.
- recall@5 روی dataset اولیه حداقل ۸۰٪ است.
- secret در client bundle یا repository دیده نمی‌شود.
- خطاهای `400`، `429`، provider failure و abort تست شده‌اند.

### فاز 2: Chat UI MVP

هدف: تکمیل تجربه end-to-end داخل سایت فعلی.

- [ ] ساخت `AssistantProvider` و نگهداری state در `_app.js`.
- [ ] ساخت launcher، panel، thread، composer و empty state.
- [ ] اتصال stream و نمایش incremental پاسخ.
- [ ] Stop، Retry، follow-up suggestions و error states.
- [ ] renderer امن Markdown، code block، table و external link.
- [ ] citation chips، preview، navigation و highlight-on-navigate.
- [ ] persistence در `sessionStorage` با versioned schema و سقف حجم.
- [ ] dock-right در desktop و bottom sheet در mobile.
- [ ] میانبر `Cmd/Ctrl+I` بدون تداخل با search.
- [ ] accessibility، focus management و reduced motion.

معیار خروج:

- conversation هنگام navigation داخلی در همان tab باقی می‌ماند.
- UI در عرض‌های ۳۶۰، ۷۶۸ و ۱۴۴۰ پیکسل قابل استفاده است.
- dark/light mode، keyboard-only flow و touch actionها بررسی شده‌اند.
- هیچ raw HTML ناامن از پاسخ مدل اجرا نمی‌شود.
- build static سایت بدون تغییر معماری deploy موفق است.

### فاز 3: کیفیت و انتشار کنترل‌شده

هدف: سنجش کیفیت پیش از فعال‌سازی عمومی.

- [ ] فعال‌سازی پشت feature flag برای تیم داخلی.
- [ ] افزودن feedback مثبت/منفی بدون ذخیره متن مکالمه.
- [ ] افزودن dashboard حداقلی برای request count، error rate، p50/p95 latency، token usage و cost.
- [ ] اجرای evaluation regression در CI برای prompt/retrieval changes.
- [ ] بررسی prompt injection، XSS، abuse، CORS و secret exposure.
- [ ] تعریف budget و alert مصرف روزانه.
- [ ] rollout مرحله‌ای ۱۰٪، ۵۰٪ و ۱۰۰٪.

معیار خروج:

- citation validity حداقل ۹۸٪ است.
- نرخ پاسخ بدون منبع یا ساختگی در dataset صفر است.
- p95 زمان شروع stream در شرایط عادی کمتر از ۳ ثانیه است.
- rollback با خاموش‌کردن feature flag بدون deploy مجدد ممکن است.

### فاز 4: بهبود retrieval در صورت نیاز

این فاز فقط با داده‌ی فاز ۳ فعال می‌شود.

- [ ] تحلیل queryهای کم‌کیفیت بدون نگهداری متن خام یا با فرایند consent/redaction مصوب.
- [ ] اصلاح chunking و metadata محصولات.
- [ ] افزودن hybrid search یا pgvector در صورت پایین‌بودن recall.
- [ ] ارزیابی reranker سبک در برابر هزینه و latency.
- [ ] versioning index و zero-downtime reindex.

معیار خروج:

- بهبود measurable نسبت به baseline روی همان dataset حاصل شده باشد.
- افزایش هزینه و latency مستند و پذیرفته شده باشد.

### فاز 5: قابلیت‌های پیشرفته

- [ ] edit/regenerate/branch و quote پیام
- [ ] command registry تخصصی برای هر محصول
- [ ] tutor mode و checklist
- [ ] variantهای dock-left و island
- [ ] حساب کاربری و sync فقط در صورت نیاز محصول
- [ ] conversation logs/session replay فقط پس از تصویب policy حریم خصوصی
- [ ] admin panel کامل برای کیفیت، feedback و هزینه

## 12. ترتیب اولین ticketها

این ترتیب، critical path پیشنهادی برای شروع است:

1. `FOUNDATION-01`: تثبیت Next.js، React، Node.js و package manager.
2. `FOUNDATION-02`: تعمیر lint و افزودن build/lint به CI.
3. `CORPUS-01`: بازگرداندن pipeline قابل تکرار MDX به Markdown.
4. `EVAL-01`: ساخت dataset سی‌سوالی با expected citation.
5. `API-01`: scaffold سرویس جدا و `GET /health`.
6. `RETRIEVAL-01`: retrieval از Meilisearch با `body` و metadata استاندارد.
7. `API-02`: `POST /v1/chat` و stream mock.
8. `LLM-01`: اتصال Liara AI، prompt v1 و citation validation.
9. `SECURITY-01`: rate limit، CORS، timeout و metadata logging.
10. `UI-01`: provider، launcher و shell responsive.
11. `UI-02`: thread، composer، streaming، stop و retry.
12. `UI-03`: Markdown renderer و citation navigation/highlight.
13. `QA-01`: accessibility، responsive، security و evaluation gate.
14. `RELEASE-01`: feature flag، metrics و rollout داخلی.

## 13. ساختار فایل پیشنهادی

ساختار UI با conventions فعلی JavaScript پروژه هماهنگ است:

```text
src/
  components/
    Assistant/
      index.jsx
      AssistantProvider.jsx
      AssistantLauncher.jsx
      AssistantPanel.jsx
      AssistantThread.jsx
      AssistantMessage.jsx
      AssistantComposer.jsx
      CitationChip.jsx
      MarkdownContent.jsx
  hooks/
    useAssistantStream.js
  lib/
    assistant/
      storage.js
      stream.js
      types.js
```

سرویس backend می‌تواند در repository یا deployment جدا نگهداری شود، اما باید ownership و release مستقل داشته باشد:

```text
assistant-api/
  src/
    server.js
    routes/chat.js
    retrieval/meilisearch.js
    llm/liara.js
    prompts/docs-assistant-v1.js
    middleware/rateLimit.js
  test/
  package.json
  Dockerfile
```

## 14. تست و ارزیابی

### تست backend

- validation ورودی و محدودیت اندازه
- ranking و deduplication retrieval
- citation فقط از sourceهای مجاز
- قطع upstream با abort کاربر
- rate limit و `Retry-After`
- provider timeout/failure
- عدم حضور secret و متن prompt در log

### تست frontend

- باز و بسته شدن با launcher و keyboard
- حفظ thread در navigation
- parsing eventهای stream ناقص یا چندتکه
- Stop و Retry
- نمایش امن Markdown و code
- citation preview/navigation/highlight
- session storage migration/corruption
- focus trap و screen-reader labels

### evaluation dataset

dataset باید ترکیبی از این حالت‌ها باشد:

- سوال با واژه‌ی دقیق موجود در سند
- سوال با بیان محاوره‌ای یا synonym فارسی/انگلیسی
- سوال نیازمند یک section مشخص
- سوال خارج از scope
- سوال adversarial برای prompt injection
- سوالی که سند پاسخ کافی برای آن ندارد

## 15. ریسک‌ها و راهکارها

| ریسک | راهکار |
|---|---|
| static بودن سایت | backend مستقل؛ عدم استفاده از Next API route |
| mismatch نسخه Node/Next | تکمیل فاز صفر قبل از feature work |
| کیفیت پایین corpus تولیدشده | تعمیر converter و evaluation روی URL/anchor واقعی |
| ضعف lexical retrieval | سنجش recall؛ سپس hybrid/vector فقط در صورت نیاز |
| citation ساختگی | source ID بسته، validation سمت server و evaluation gate |
| افشای کلید LLM | کلید فقط server-side و secret scan در CI |
| هزینه و abuse برای guest | token bucket، daily cap، context cap و feature flag |
| تداخل با search | حفظ `Cmd/Ctrl+K` و استفاده از `Cmd/Ctrl+I` |
| نقض ادعای عدم ذخیره داده | عدم ذخیره متن در MVP؛ policy review قبل از logs |
| XSS از خروجی مدل | Markdown renderer محدود و HTML خام غیرفعال |

## 16. تصمیم‌های باز و owner پیشنهادی

این موارد باید در فاز صفر بسته شوند، ولی مانع نوشتن ticketهای اولیه نیستند:

| تصمیم | پیشنهاد فعلی | owner |
|---|---|---|
| نسخه framework | Next.js 14/React 18 برای MVP یا تکمیل رسمی upgrade به 16/19 | Tech lead |
| محل repository سرویس API | همان monorepo برای سرعت hackathon، deploy مستقل | Tech lead/DevOps |
| model نهایی Liara AI | مدل با streaming و تعادل latency/cost | AI engineer |
| storage rate limit | Redis/Upstash یا Redis لیارا | DevOps |
| feature flag | config remote یا env-driven درصد rollout | Frontend/DevOps |
| analytics feedback | aggregate event بدون prompt | Product/Legal |
| retention آینده | بدون conversation storage تا تصویب policy | Product/Legal |

## 17. Definition of Done نهایی MVP

MVP زمانی آماده انتشار عمومی است که:

- کاربر در desktop و mobile بتواند سوال بپرسد، stream را متوقف کند و خطا را retry کند.
- پاسخ فارسی، قابل اسکن و همراه citation معتبر و قابل navigation باشد.
- thread هنگام جابه‌جایی بین صفحات در همان tab حفظ شود.
- هیچ LLM secret یا Meilisearch private key در bundle سایت نباشد.
- متن مکالمه در server log یا database ذخیره نشود.
- rate limit، timeout، CORS و feature flag فعال باشند.
- recall@5 حداقل ۸۰٪ و citation validity حداقل ۹۸٪ روی dataset توافق‌شده باشد.
- build static فعلی و جستجوی Meilisearch موجود بدون regression کار کنند.
- accessibility پایه، dark mode و breakpointهای اصلی تست شده باشند.
