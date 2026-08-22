import { createEventSequenceValidator } from "./contract.mjs";

export const DOMAIN_SOURCE = {
  id: "S1",
  title: "اضافه کردن دامنه خریداری شده به برنامه",
  url: "/paas/domains/add-domain/",
  anchor: "connect-using-cloudflare",
  snippet: "دامنه را اضافه کنید و رکوردهای DNS نمایش‌داده‌شده را تنظیم کنید.",
};

export const SSL_SOURCE = {
  id: "S2",
  title: "فعال‌سازی SSL دامنه",
  url: "/paas/domains/enable-ssl/",
  anchor: "",
  snippet: "پس از تأیید رکوردها، وضعیت SSL دامنه را بررسی کنید.",
};

export const DEPLOY_SOURCE = {
  id: "S1",
  title: "استقرار برنامه Node.js",
  url: "/paas/nodejs/how-tos/deploy-app/",
  anchor: "",
  snippet: "برنامه را با Liara CLI و نام برنامه مقصد مستقر کنید.",
};

export const DATABASE_SOURCE = {
  id: "S1",
  title: "اتصال Node.js به PostgreSQL",
  url: "/dbaas/postgresql/how-tos/connect-via-platform/nodejs/",
  anchor: "",
  snippet: "اطلاعات اتصال دیتابیس را از پنل بگیرید و در متغیرهای محیطی برنامه قرار دهید.",
};

const answers = {
  success: "از بخش **دامنه‌ها**، دامنه را اضافه کنید و سه رکورد `DNS` نمایش‌داده‌شده را در سرویس DNS خود تنظیم کنید. سپس «بررسی وضعیت رکوردها» را بزنید.",
  slow: "برای اتصال دامنه، ابتدا دامنه را در پنل اضافه کنید. سپس رکوردهای DNS را ثبت کنید و منتظر تأیید وضعیت بمانید.",
  empty: "منبع کافی پیدا نشد",
  "rich-content": `## اتصال دامنه

مراحل پیشنهادی:

1. دامنه را در پنل اضافه کنید.
2. رکوردهای \`CNAME\` و \`TXT\` را تنظیم کنید.

\`\`\`bash
liara deploy --app my-app
\`\`\`

| وضعیت | اقدام |
| --- | --- |
| قرمز | DNS را بررسی کنید |
| سبز | اتصال کامل است |

[مستندات داخلی](/paas/domains/add-domain/) و [Cloudflare](https://www.cloudflare.com/)

<div onclick="alert('xss')">این HTML باید فقط متن دیده شود.</div>`,
  "long-thread": "این پاسخ بلند برای بررسی scroll، نگهداری پیام‌ها و حذف قدیمی‌ترین پیام پس از عبور از سقف storage است. ".repeat(16),
};

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });

function chunks(text, size = 22) {
  return Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
    text.slice(index * size, (index + 1) * size),
  );
}

function tailoredAnswer(message, mode) {
  const text = message.toLowerCase();
  const guided = /شروع|راهنمایی/.test(text);
  const deploy = /deploy|مستقر|استقرار|راه.?انداز/.test(text);
  const database = /postgres|دیتابیس|database/.test(text);
  const normal = guided
    ? "برای ساختن سؤال دقیق‌تر، یکی از گزینه‌های زیر را انتخاب کنید."
    : deploy
    ? "برای استقرار، داخل پوشه پروژه دستور `liara deploy --app my-app` را اجرا کنید و `my-app` را با نام برنامه خود عوض کنید."
    : database
      ? "اطلاعات اتصال `PostgreSQL` را از پنل دیتابیس بردارید، در متغیرهای محیطی برنامه قرار دهید و با کتابخانه PostgreSQL زبان خود متصل شوید."
      : answers.success;

  if (mode === "command") {
    return deploy
      ? "```bash\nliara deploy --app my-app\n```"
      : `**دستور مستقیمی برای این درخواست وجود ندارد؛ پاسخ معمولی نمایش داده شد.**\n\n${normal}`;
  }
  if (mode === "tutorial") {
    if (deploy) return "## استقرار قدم‌به‌قدم\n\n1. وارد پوشه پروژه شوید.\n2. نام برنامه مقصد را جای `my-app` بگذارید.\n3. دستور زیر را اجرا کنید.\n\n```bash\nliara deploy --app my-app\n```";
    if (database) return "## اتصال قدم‌به‌قدم PostgreSQL\n\n1. اطلاعات اتصال را از پنل کپی کنید.\n2. آن‌ها را به‌صورت متغیر محیطی ثبت کنید.\n3. اتصال را با درایور PostgreSQL برنامه بسازید.\n\nروی منبع بزنید تا صفحه دقیق باز شود.";
    return "## اتصال قدم‌به‌قدم دامنه\n\n1. دامنه را در پنل اضافه کنید.\n2. رکوردهای `CNAME` و `TXT` را در DNS ثبت کنید.\n3. وضعیت رکوردها را بررسی کنید.\n\nروی منبع بزنید تا بخش دقیق مستندات با راهنما باز شود.";
  }
  return normal;
}

export function mockEnabled(pathname, {
  nodeEnv = process.env.NODE_ENV,
  deploymentEnv = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV,
} = {}) {
  // Force real transport for development and production
  // Only use mock on /assistant-demo page in preview mode
  return deploymentEnv === "preview" && pathname === "/assistant-demo";
}

export async function* mockTransport(request, { signal, scenario = "success", mode = "normal" } = {}) {
  const delay = scenario === "slow" ? 280 : 45;
  const requestId = `mock-${scenario}`;
  const sequence = createEventSequenceValidator();
  yield sequence.push({ type: "meta", requestId, model: "mock-v1" });

  if (scenario === "rate-limit") {
    yield sequence.push({ type: "error", code: "RATE_LIMITED", requestId, retryable: true });
    sequence.end();
    return;
  }
  if (scenario === "provider-error") {
    yield sequence.push({ type: "error", code: "PROVIDER_UNAVAILABLE", requestId, retryable: true });
    sequence.end();
    return;
  }

  const message = request?.message?.toLowerCase?.() ?? "";
  const guided = /شروع|راهنمایی/.test(message);
  const deploy = /deploy|مستقر|استقرار|راه.?انداز/.test(message);
  const database = /postgres|دیتابیس|database/.test(message);
  const guidedSources = [
    { ...DEPLOY_SOURCE, id: "S1" },
    { ...DOMAIN_SOURCE, id: "S2" },
    { ...DATABASE_SOURCE, id: "S3" },
  ];
  const sources = scenario === "empty" ? [] : guided ? guidedSources : scenario === "rich-content" ? [DOMAIN_SOURCE, SSL_SOURCE] : [deploy ? DEPLOY_SOURCE : database ? DATABASE_SOURCE : DOMAIN_SOURCE];
  yield sequence.push({ type: "sources", sources });
  const answer = ["success", "slow"].includes(scenario) ? tailoredAnswer(request?.message ?? "", mode) : answers[scenario] ?? answers.success;

  for (const [index, text] of chunks(answer).entries()) {
    await wait(delay, signal);
    yield sequence.push({ type: "delta", text });
    if (scenario === "broken-stream" && index === 2) {
      yield sequence.push({ type: "error", code: "UPSTREAM_STREAM_FAILED", requestId, retryable: true });
      sequence.end();
      return;
    }
  }

  if (mode !== "command" && scenario !== "empty") yield sequence.push({
    type: "suggestions",
    suggestions: guided
      ? ["می‌خواهم برنامه‌ام را مستقر کنم.", "می‌خواهم دامنه متصل کنم.", "می‌خواهم به PostgreSQL وصل شوم."]
      : deploy
        ? ["متغیرهای محیطی را چطور تنظیم کنم؟", "لاگ استقرار را کجا ببینم؟"]
        : ["رکوردهای DNS را کجا وارد کنم؟", "فعال شدن SSL چقدر زمان می‌برد؟"],
  });
  yield sequence.push({ type: "done", finishReason: "stop", usage: null });
  sequence.end();
}
