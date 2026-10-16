const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    "/Users/martydytrych/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);
(async () => {
  const { createApp } = await import("../preview-server.mjs");
  const { Store } = await import("../lib/store.mjs");
  const { mkdtempSync, rmSync, readFileSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const path = require("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "aisc-browser-"));
  const store = new Store(dir);
  const fixture = JSON.parse(readFileSync("ui/demo.json", "utf8"));
  const clean = (r) => {
    const { demo, ...rest } = r;
    return rest;
  };
  const app = createApp({
    store,
    enabled: true,
    password: "fixture-secret-for-browser-testing",
    run: async (input) => ({
      summary: "Fixture",
      coverage: "Automated test fixture",
      warnings: [],
      events:
        input.mode === "discover"
          ? fixture.events
              .slice(0, 1)
              .map((r) => ({ ...clean(r), participation: "Confirmed speaker" }))
          : [],
      speakers:
        input.mode === "speakers"
          ? fixture.speakers.slice(0, 1).map(clean)
          : [],
    }),
  });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + app.address().port;
  const b = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const context = await b.newContext({
    httpCredentials: {
      username: "dan",
      password: "fixture-secret-for-browser-testing",
    },
    acceptDownloads: true,
  });
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.goto(url);
    await p.locator("#run-button").click();
    await p.locator(".event-card").first().waitFor();
    await p.locator(".details").first().click();
    await p.locator("#research-this-event").click();
    await p.locator("#run-button").click();
    await p.locator(".person-card").first().waitFor();
    await p.locator(".details").first().click();
    await p
      .locator("#outreach-draft")
      .fill("Edited message saved from the browser");
    await p.locator("#save-draft").click();
    await p.waitForFunction(() =>
      document.querySelector("#draft-status").textContent.includes("saved"),
    );
    await p.locator("#close-detail").click();
    await p.reload();
    await p.locator("[data-tab=saved]").click();
    await p.locator(".person-card").first().waitFor();
    await p.locator(".details").first().click();
    if (
      (await p.locator("#outreach-draft").inputValue()) !==
      "Edited message saved from the browser"
    )
      throw Error("Draft not persistent");
    await p.locator("#close-detail").click();
    const download = p.waitForEvent("download");
    await p.locator("#export").click();
    const d = await download;
    const text = readFileSync(await d.path(), "utf8");
    if (!text.includes("Edited message saved from the browser"))
      throw Error("CSV missed draft");
    const afterRestart = new Store(dir);
    if (
      afterRestart.shortlist[0].outreachMessage !==
      "Edited message saved from the browser"
    )
      throw Error("Restart lost draft");
    await p.locator("#load-example").click();
    await p.locator(".event-card").first().waitFor();
    if ((await p.locator(".event-card").count()) !== 6)
      throw Error("Demo discovery");
    await p.locator(".details").first().click();
    await p.locator("#research-this-event").click();
    await p.locator(".save").first().click();
    if (store.shortlist.length !== 1) throw Error("Demo contaminated server");
    await p.setViewportSize({ width: 390, height: 844 });
    if (
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    )
      throw Error("Mobile overflow");
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "PASS: authenticated browser discovery, speaker extraction fixture, saved edited draft, reload, restart, CSV, demo isolation, mobile. No provider calls.",
    );
  } finally {
    await b.close();
    await new Promise((r) => app.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
