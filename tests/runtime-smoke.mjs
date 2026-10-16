import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const port = 14319;
const child = spawn(
  process.execPath,
  [
    "node_modules/eve/bin/eve.js",
    "start",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      EVE_DEV: "0",
      PORT: String(port),
      EVE_SERVICE_PASSWORD: randomBytes(32).toString("hex"),
    },
    stdio: "ignore",
  },
);
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/eve/v1/health`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw Error("Runtime did not become healthy");
  const denied = await fetch(`http://127.0.0.1:${port}/eve/v1/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (denied.status !== 401)
    throw Error(
      "Production runtime did not reject anonymous session: " + denied.status,
    );
  console.log(
    "PASS: compiled production runtime healthy; unauthenticated session rejected; no model turn created.",
  );
} finally {
  child.kill("SIGTERM");
}
