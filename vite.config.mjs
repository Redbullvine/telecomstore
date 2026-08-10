import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const searchConsoleToken = String(env.VITE_GOOGLE_SITE_VERIFICATION || "").trim();

  return {
    // Mirrors the netlify.toml `/shop-images/*` proxy so supplier product images
    // resolve in local development too. The Petra bucket is http-only (its dotted
    // name cannot present a valid certificate), so it must be proxied rather than
    // linked directly from an https page.
    server: {
      proxy: {
        "/shop-images": {
          target: "http://petraimages.com.s3.amazonaws.com",
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/shop-images/, "/600x600"),
        },
      },
    },
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
