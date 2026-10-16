import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../preview-server.mjs";
import { Store, csvCell } from "../lib/store.mjs";
import { input, report } from "../lib/schema.mjs";
import { research, promptFor } from "../lib/research.mjs";
const result = {
  summary: "Verified test",
  coverage: "Test fixture only",
  warnings: [],
  events: [],
  speakers: [],
};
async function withApp(options, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "aisc-test-"));
  const store = new Store(dir);
  const app = createApp({ ...options, store });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${app.address().port}`, store);
  } finally {
    await new Promise((r) => app.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
}
const payload = {
  mode: "discover",
  region: "United States + Canada",
  focus: "Industrial operations leaders",
  url: "",
  includePast: false,
};
const post = (url, data, headers = {}) =>
  fetch(url + "/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data),
  });
test("live runs are blocked before any provider call", async () => {
  let calls = 0;
  await withApp(
    {
      enabled: false,
      run: async () => {
        calls++;
        return result;
      },
    },
    async (url, store) => {
      assert.equal((await post(url, payload)).status, 409);
      assert.equal(calls, 0);
      assert.equal(store.jobs.length, 0);
    },
  );
});
test("Canadian and combined geography round-trip to the research worker", async () => {
  let received;
  await withApp(
    {
      enabled: true,
      run: async (p) => {
        received = p;
        return result;
      },
    },
    async (url, store) => {
      const r = await post(url, payload);
      assert.equal(r.status, 202);
      const job = await r.json();
      for (let i = 0; i < 20 && store.jobs[0].status === "running"; i++)
        await new Promise((r) => setTimeout(r, 10));
      assert.equal(received.region, "United States + Canada");
      const done = await (await fetch(url + "/api/jobs/" + job.id)).json();
      assert.equal(done.status, "completed");
      assert.equal(done.result.summary, "Verified test");
      const reread = new Store(store.dir);
      assert.equal(reread.jobs[0].status, "completed");
    },
  );
  assert.equal(input.parse({ ...payload, region: "Canada" }).region, "Canada");
});
test("private and non-HTTPS URLs cannot reach provider", async () => {
  await withApp(
    {
      enabled: true,
      run: () => {
        throw Error("must not run");
      },
    },
    async (url) => {
      for (const target of [
        "http://example.com",
        "https://localhost",
        "https://127.0.0.1",
        "https://foo.internal",
        "https://user:pass@example.com",
        "https://example.com:444",
      ])
        assert.equal(
          (await post(url, { ...payload, mode: "speakers", url: target }))
            .status,
          400,
          target,
        );
    },
  );
});
test("cross-origin POST is rejected", async () => {
  await withApp({ enabled: true }, async (url) =>
    assert.equal(
      (await post(url, payload, { Origin: "https://evil.example" })).status,
      403,
    ),
  );
});
test("single running job and daily cap prevent duplicate spending", async () => {
  let finish;
  await withApp(
    {
      enabled: true,
      dailyLimit: 1,
      run: () => new Promise((r) => (finish = r)),
    },
    async (url) => {
      assert.equal((await post(url, payload)).status, 202);
      assert.equal((await post(url, payload)).status, 429);
      finish(result);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal((await post(url, payload)).status, 429);
    },
  );
});
test("restart marks abandoned jobs interrupted", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aisc-"));
  try {
    const s = new Store(dir);
    s.add({ id: "x", status: "running" });
    assert.equal(new Store(dir).jobs[0].status, "interrupted");
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test("CSV guards formula execution and escapes quotes", () => {
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell("Smith, Jane"), '"Smith, Jane"');
});
test("provider adapter requests schema and validates final payload", async () => {
  let request;
  const makeClient = (data) => ({
    sessions: {
      create: async (r) => {
        request = r;
        return {
          session: { cancel: async () => {} },
          response: { result: async () => ({ data }) },
        };
      },
    },
  });
  assert.deepEqual(
    await research(payload, { client: makeClient(result) }),
    result,
  );
  assert.ok(request.outputSchema);
  assert.match(request.message, /United States \+ Canada/);
  assert.match(promptFor(payload, "2026-10-15"), /2026-10-15/);
  await assert.rejects(() =>
    research(payload, { client: makeClient({ broken: true }) }),
  );
});
test("source URLs cannot be javascript and missing names are rejected", () => {
  assert.equal(
    report.safeParse({
      ...result,
      speakers: [{ name: "", sourceUrl: "javascript:alert(1)" }],
    }).success,
    false,
  );
});
test("server shortlist persists edits, rejects demo, and removes records", async () => {
  await withApp({}, async (url, store) => {
    const person = {
      name: "Test Person",
      company: "Fixture Co",
      role: "Operations",
      topic: "Progress",
      kind: "Buyer",
      fit: "High",
      whyReachOut: "Fixture",
      question: "Fixture?",
      sourceUrl: "https://example.com/speakers",
      evidence: "Test fixture",
      linkedin: "",
      outreachMessage: "First draft",
    };
    const save = (record) =>
      fetch(url + "/api/shortlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      });
    assert.equal((await save({ ...person, demo: true })).status, 400);
    const record = await (await save(person)).json();
    assert.ok(record.id);
    await save({ ...person, outreachMessage: "Edited draft" });
    const loaded = new Store(store.dir);
    assert.equal(loaded.shortlist.length, 1);
    assert.equal(loaded.shortlist[0].outreachMessage, "Edited draft");
    await fetch(url + "/api/shortlist/" + record.id, { method: "DELETE" });
    assert.equal(store.shortlist.length, 0);
  });
});
test("private workspace rejects anonymous requests and accepts correct credentials", async () => {
  await withApp(
    { password: "a-long-test-password-for-auth", username: "dan" },
    async (url) => {
      assert.equal((await fetch(url + "/api/shortlist")).status, 401);
      assert.equal((await fetch(url + "/healthz")).status, 200);
      const authorization =
        "Basic " +
        Buffer.from("dan:a-long-test-password-for-auth").toString("base64");
      assert.equal(
        (await fetch(url + "/api/shortlist", { headers: { authorization } }))
          .status,
        200,
      );
      assert.equal(
        (
          await fetch(url + "/api/shortlist", {
            headers: { authorization: "Basic bad" },
          })
        ).status,
        401,
      );
    },
  );
});
test("hosted configuration fails closed without HTTPS and strong credentials", () => {
  assert.throws(() => createApp({ publicOrigin: "http://example.com" }));
  assert.throws(() =>
    createApp({ publicOrigin: "https://example.com", password: "short" }),
  );
});
test("adapter times out and asks the session to cancel", async () => {
  let cancelled = false;
  const client = {
    sessions: {
      create: async () => ({
        session: {
          cancel: async () => {
            cancelled = true;
          },
        },
        response: { result: () => new Promise(() => {}) },
      }),
    },
  };
  await assert.rejects(
    research(payload, { client, timeoutMs: 20 }),
    (e) => e.code === "RESEARCH_TIMEOUT",
  );
  assert.equal(cancelled, true);
});
test("cancellation propagates to worker and creates cancelled outcome", async () => {
  await withApp(
    {
      enabled: true,
      run: (_p, { signal }) =>
        new Promise((_r, reject) =>
          signal.addEventListener("abort", () => reject(Error("Cancelled"))),
        ),
    },
    async (url, store) => {
      const job = await (await post(url, payload)).json();
      assert.equal(
        (
          await fetch(url + "/api/jobs/" + job.id + "/cancel", {
            method: "POST",
          })
        ).status,
        202,
      );
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(store.jobs[0].status, "cancelled");
    },
  );
});
test("LinkedIn links without match evidence are removed", async () => {
  const person = {
    name: "Test Person",
    company: "Fixture Co",
    role: "Operations",
    topic: "Progress",
    kind: "Buyer",
    fit: "High",
    whyReachOut: "Fixture",
    question: "Fixture?",
    sourceUrl: "https://example.com/speakers",
    evidence: "Test fixture",
    linkedin: "https://www.linkedin.com/in/test-person/",
  };
  const client = {
    sessions: {
      create: async () => ({
        session: { cancel: async () => {} },
        response: {
          result: async () => ({ data: { ...result, speakers: [person] } }),
        },
      }),
    },
  };
  const out = await research(payload, { client });
  assert.equal(out.speakers[0].linkedin, "");
  assert.equal(out.warnings.length, 1);
});
test("billing rejection in waiting result becomes a specific provider error", async () => {
  const client = {
    sessions: {
      create: async () => ({
        session: { cancel: async () => {} },
        response: {
          result: async () => ({
            status: "waiting",
            events: [
              {
                type: "turn.failed",
                data: {
                  details: { upstreamType: "customer_verification_required" },
                },
              },
            ],
          }),
        },
      }),
    },
  };
  await assert.rejects(
    research(payload, { client }),
    (e) => e.code === "BILLING_REQUIRED",
  );
});

test("completed structured result is accepted when durable session waits for another turn", async () => {
  const client = {
    sessions: {
      create: async () => ({
        session: { cancel: async () => {} },
        response: {
          result: async () => ({
            status: "waiting",
            data: result,
            events: [
              { type: "result.completed", data: { result } },
              { type: "turn.completed" },
            ],
          }),
        },
      }),
    },
  };
  assert.deepEqual(await research(payload, { client }), result);
});
