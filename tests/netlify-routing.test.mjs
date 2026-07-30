import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("known SPA routes precede a real 404 fallback", async () => {
  const config = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
  const fallback = config.lastIndexOf('from = "/*"');

  assert.ok(config.indexOf('from = "/login"') < fallback);
  assert.ok(config.indexOf('from = "/admin/*"') < fallback);
  assert.match(config.slice(fallback), /to = "\/404\.html"\s+status = 404/);

  for (const scannerPath of ["wp", "wordpress", "wp-admin", "backup", "old", "new"]) {
    const ruleStart = config.indexOf(`from = "/${scannerPath}/*"`);
    assert.ok(ruleStart >= 0 && ruleStart < fallback, `${scannerPath} rule must precede the fallback`);
    assert.match(config.slice(ruleStart, config.indexOf("[[redirects]]", ruleStart + 1)), /status = 404/);
  }

});

test("SEO files contain crawlable production URLs", async () => {
  const [robots, sitemap, notFound] = await Promise.all([
    readFile(new URL("../public/robots.txt", import.meta.url), "utf8"),
    readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8"),
    readFile(new URL("../public/404.html", import.meta.url), "utf8")
  ]);

  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Sitemap: https:\/\/telecomstore\.net\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/telecomstore\.net\/<\/loc>/);
  assert.match(notFound, /<meta name="robots" content="noindex"/);
  assert.match(notFound, /Telecom Store/);
});

test("the PHP scanner edge guard handles root and nested paths", async () => {
  const { config, default: blockPhp } = await import("../netlify/edge-functions/block-php.js");
  const matcher = new RegExp(config.pattern);

  assert.equal(matcher.test("/random.php"), true);
  assert.equal(matcher.test("/nested/random.PHP"), true);
  assert.equal(matcher.test("/asset.php/extra"), true);
  assert.equal(matcher.test("/assets/app.js"), false);

  const response = blockPhp();
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Telecom Store/);
});
