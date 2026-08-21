import Head from "next/head";
import { useRouter } from "next/router";
import Layout from "@/components/Layout";
import { SCENARIOS } from "@/lib/assistant/contract.mjs";

const labels = {
  success: "پاسخ موفق",
  slow: "پاسخ آهسته و Stop",
  empty: "بدون منبع کافی",
  "rate-limit": "محدودیت درخواست",
  "provider-error": "خطای سرویس",
  "broken-stream": "قطع stream",
  "rich-content": "محتوای فنی کامل",
  "long-thread": "پاسخ بلند",
};

export function getStaticProps() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ASSISTANT_DEMO !== "true") {
    return { notFound: true };
  }
  return { props: {} };
}

export default function AssistantDemo() {
  const router = useRouter();
  const active = SCENARIOS.includes(router.query.scenario) ? router.query.scenario : "success";

  return (
    <Layout>
      <Head><title>دموی دستیار مستندات لیارا</title></Head>
      <div className="mx-auto max-w-[900px] py-8">
        <span className="font-mono text-xs text-emerald-700">UI LAB / MOCK ONLY</span>
        <h1 className="mt-3 font-bold">دموی دستیار مستندات</h1>
        <p className="mt-2 max-w-[650px] text-gray-500">هر سناریو داده ثابت دارد و هیچ درخواست شبکه‌ای، API یا LLM اجرا نمی‌کند. پنل سمت چپ را باز نگه دارید و حالت‌ها را بررسی کنید.</p>
        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario}
              onClick={() => router.replace({ pathname: router.pathname, query: { scenario } }, undefined, { shallow: true })}
              className={`flex min-h-[64px] items-center justify-between rounded-xl border p-4 text-right transition ${active === scenario ? "border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50" : "border-black/10 bg-white hover:border-black dark:border-white/10 dark:bg-[#222]"}`}
            >
              <span>{labels[scenario]}</span>
              <code dir="ltr" className="text-xs opacity-60">{scenario}</code>
            </button>
          ))}
        </div>
        <div className="mt-8 rounded-xl border border-dashed border-black/20 p-5 text-sm leading-8 dark:border-white/20">
          <strong>بررسی سریع:</strong> animation باز/بسته و backdrop، سه حالت معمولی/آموزش/فقط دستور، ارسال با Enter، توقف پاسخ آهسته، Retry، citation، حالت تاریک، موبایل و میانبر <code>Cmd/Ctrl+I</code>.
        </div>
      </div>
    </Layout>
  );
}
