const NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>Page Not Found | Telecom Store</title>
    <style>
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; box-sizing: border-box; color: #14201d; background: #f4f6f4; font-family: Inter, system-ui, sans-serif; }
      main { width: min(620px, 100%); padding: 34px; background: #fff; border: 1px solid #e3e8e4; border-top: 5px solid #c8182e; border-radius: 8px; box-shadow: 0 16px 36px rgba(20, 32, 29, .12); box-sizing: border-box; }
      .brand { margin-bottom: 30px; font-weight: 800; } .code { color: #c8182e; font: 700 14px/1.2 ui-monospace, monospace; letter-spacing: .08em; }
      h1 { margin: 0 0 12px; font-size: clamp(30px, 7vw, 46px); line-height: 1.05; } p { color: #5b6472; line-height: 1.6; }
      a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 18px; color: #fff; background: #c8182e; border-radius: 7px; font-weight: 800; text-decoration: none; }
    </style>
  </head>
  <body><main><div class="brand">Telecom Store</div><p class="code">404 / PAGE NOT FOUND</p><h1>That page is not in inventory.</h1><p>Return to the storefront to browse available telecom materials.</p><a href="/">Back to Telecom Store</a></main></body>
</html>`;

export default function blockPhpScannerPath() {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "text/html; charset=UTF-8",
      "x-robots-tag": "noindex"
    }
  });
}

export const config = {
  pattern: "^/.*\\.[pP][hH][pP](?:/.*)?$"
};
