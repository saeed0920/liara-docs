import "@/styles/globals.css";
import "@/styles/fonts.css";
import "@/styles/asciinema.css";
import "@/styles/dark.css";
import "@/styles/assistant.css";
import "highlight.js/styles/solarized-light.css";

import { MDXProvider } from "@mdx-js/react";
import Assistant from "@/components/Assistant";

export default function App({ Component, pageProps }) {
  return (
    <MDXProvider>
      <Component {...pageProps} />
      <Assistant />
    </MDXProvider>
  );
}
