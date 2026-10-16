import test from "node:test";
import assert from "node:assert/strict";
import { cloudApp } from "../lib/cloud-app.mjs";
import { CloudStore } from "../lib/cloud-store.mjs";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync("ui/demo.json"));
const password = "fixture-password-long-enough";
const env = {
  APP_PASSWORD: password,
  APP_USERNAME: "dan",
  APP_RESEARCH_ENABLED: "true",
  EVE_SERVICE_PASSWORD: password,
  APP_DAILY_RUN_LIMIT: "3",
};
const req = (
  path,
  method = "GET",
  data,
  auth = true,
  origin = "https://app.example.org",
) =>
  new Request("https://app.example.org" + path, {
    method,
    headers: {
      ...(auth
        ? {
            authorization:
              "Basic " + Buffer.from("dan:" + password).toString("base64"),
          }
        : {}),
      origin,
      "content-type": "application/json",
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
function setup() {
  let state = { jobs: [], shortlist: [] };
  let pending = [];
  const store = {
    async read() {
      return { state: structuredClone(state) };
    },
    async mutate(fn) {
      return fn(state);
    },
  };
  const run = async () => ({
    summary: "fixture",
    coverage: "",
    warnings: [],
    events: [],
    speakers: [fixture.speakers[0]],
  });
  const app = cloudApp({
    store,
    run,
    env,
    assets: { "/index.html": Buffer.from("private page").toString("base64") },
  });
  return {
    app,
    ctx: { waitUntil: (p) => pending.push(p) },
    finish: () => Promise.all(pending),
    state: () => state,
    store,
  };
}
test("hosted UI, assets and data reject anonymous access; missing password fails closed", async () => {
  const { app, ctx } = setup();
  for (const path of ["/", "/api/jobs", "/api/shortlist", "/static/demo.json"])
    assert.equal((await app(req(path, "GET", null, false), ctx)).status, 401);
  assert.equal((await app(req("/"), ctx)).status, 200);
  assert.equal((await cloudApp({ env: {} })(req("/"), ctx)).status, 503);
});
test("hosted research persists results, draft edits and export; rejects CSRF and demo writes", async () => {
  const s = setup();
  assert.equal(
    (
      await s.app(
        req("/api/research", "POST", {}, true, "https://evil.org"),
        s.ctx,
      )
    ).status,
    403,
  );
  const r = await s.app(
    req("/api/research", "POST", {
      mode: "discover",
      focus: "Industrial fabricators",
    }),
    s.ctx,
  );
  assert.equal(r.status, 202);
  await s.finish();
  assert.equal(s.state().jobs[0].status, "completed");
  const { demo, ...record } = fixture.speakers[0];
  assert.equal(
    (
      await s.app(
        req("/api/shortlist", "POST", { ...record, demo: true }),
        s.ctx,
      )
    ).status,
    400,
  );
  const saved = await (
    await s.app(
      req("/api/shortlist", "POST", {
        ...record,
        outreachMessage: "Edited draft",
      }),
      s.ctx,
    )
  ).json();
  assert.equal(
    (await (await s.app(req("/api/shortlist"), s.ctx)).json())[0]
      .outreachMessage,
    "Edited draft",
  );
  assert.equal(
    (await s.app(req("/api/jobs/" + s.state().jobs[0].id + "/export"), s.ctx))
      .status,
    200,
  );
  await s.app(req("/api/shortlist/" + saved.id, "DELETE"), s.ctx);
  assert.equal(s.state().shortlist.length, 0);
});
test("hosted disabled research never calls provider", async () => {
  let called = false;
  const app = cloudApp({
    env: { ...env, APP_RESEARCH_ENABLED: "false" },
    run: async () => {
      called = true;
    },
  });
  assert.equal(
    (
      await app(
        req("/api/research", "POST", {
          mode: "discover",
          focus: "Industrial fabrication",
        }),
        {},
      )
    ).status,
    409,
  );
  assert.equal(called, false);
});
test("private blob conditional writes retry conflicts without losing records", async () => {
  let state = { jobs: [], shortlist: [] },
    version = 0;
  const store = new CloudStore({
    read: async () => ({
      statusCode: 200,
      blob: { etag: String(version) },
      stream: new Blob([JSON.stringify(state)]).stream(),
    }),
    write: async (path, text, opts) => {
      await new Promise((r) => setTimeout(r, 2));
      if (opts.ifMatch !== String(version))
        throw Object.assign(Error(), { name: "BlobPreconditionFailedError" });
      state = JSON.parse(text);
      version++;
    },
  });
  await Promise.all([
    store.mutate((s) => s.jobs.push({ id: "a" })),
    store.mutate((s) => s.jobs.push({ id: "b" })),
  ]);
  assert.equal(state.jobs.length, 2);
});
