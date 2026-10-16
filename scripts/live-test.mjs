if (process.env.CONFIRM_PAID_TEST !== "true")
  throw Error(
    "Set CONFIRM_PAID_TEST=true only after approving the provider cost.",
  );
import { createApp } from "../preview-server.mjs";
import { Store } from "../lib/store.mjs";
import { research } from "../lib/research.mjs";
import { Client } from "eve/client";
import { writeFileSync, mkdirSync } from "node:fs";
const name = process.argv[2];
const cases = {
  us: {
    mode: "discover",
    region: "United States",
    url: "",
    includePast: false,
    focus:
      "Find up to 3 upcoming industrial events with official speaker or agenda evidence for operations, turnaround or fabrication leaders. Prefer refinery/chemical turnarounds and pipe fabrication. Return partial honest results within budget.",
  },
  canada: {
    mode: "discover",
    region: "Canada",
    url: "",
    includePast: false,
    focus:
      "Find up to 3 upcoming Canadian industrial events with official speaker or agenda evidence for refinery/chemical maintenance, turnaround or industrial fabrication leaders. Return partial honest results within budget.",
  },
  speakers: {
    mode: "speakers",
    region: "United States + Canada",
    url: "https://www.fabtechexpo.com/attend/conference/speakers",
    includePast: false,
    focus:
      "Research up to 3 named speakers relevant to industrial fabrication operations or production-progress visibility. Include company, role, actual session topic, eventName, sources, LinkedIn only if corroborated, and a draft with unapproved product/pilot claims bracketed.",
  },
};
if (!cases[name]) throw Error("Choose us, canada or speakers");
const dir = ".local/live-tests";
mkdirSync(dir, { recursive: true });
const client = new Client({ host: "http://127.0.0.1:2000" });
const original = client.sessions.create.bind(client.sessions);
client.sessions.create = async (...args) => {
  const c = await original(...args);
  console.log("Agent session accepted:", c.session.id || c.response.sessionId);
  const collect = c.response.result.bind(c.response);
  c.response.result = async () => {
    const result = await collect();
    writeFileSync(`${dir}/${name}-trace.json`, JSON.stringify(result, null, 2));
    console.log("Agent final status:", result.status);
    return result;
  };
  return c;
};
const store = new Store(dir);
const app = createApp({
  store,
  enabled: true,
  dailyLimit: 4,
  run: (input, opts) => research(input, { ...opts, client }),
});
await new Promise((r) => app.listen(14318, "127.0.0.1", r));
try {
  const response = await fetch("http://127.0.0.1:14318/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cases[name]),
  });
  const job = await response.json();
  if (!response.ok) throw Error(job.error);
  console.log("Live test started:", name, job.id);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const latest = await (
      await fetch("http://127.0.0.1:14318/api/jobs/" + job.id)
    ).json();
    if (latest.status !== "running") {
      writeFileSync(
        `${dir}/${name}-result.json`,
        JSON.stringify(latest, null, 2),
      );
      console.log(JSON.stringify(latest));
      break;
    }
    if (i % 10 === 0) console.log("Research still running");
  }
} finally {
  await new Promise((r) => app.close(r));
}
