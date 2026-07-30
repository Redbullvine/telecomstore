import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const searchConsoleToken = String(env.VITE_GOOGLE_SITE_VERIFICATION || "").trim();

  return {
    plugins: searchConsoleToken ? [{
      name: "search-console-verification",
      transformIndexHtml() {
        return [{
          tag: "meta",
          attrs: {
            name: "google-site-verification",
            content: searchConsoleToken
          },
          injectTo: "head"
        }];
      }
    }] : []
  };
});
