import { spawn } from "node:child_process";
import { mkdirSync, existsSync, symlinkSync } from "node:fs";
import path from "node:path";
const data = process.env.APP_DATA_DIR;
if (
  !data ||
  !path.isAbsolute(data) ||
  !process.env.APP_ORIGIN ||
  !process.env.APP_PASSWORD ||
  !process.env.EVE_SERVICE_PASSWORD ||
  process.env.EVE_SERVICE_PASSWORD.length < 20
)
  throw Error(
    "Set persistent APP_DATA_DIR, HTTPS APP_ORIGIN, APP_PASSWORD and EVE_SERVICE_PASSWORD before starting.",
  );
if (
  process.env.APP_RESEARCH_ENABLED === "true" &&
  !process.env.AI_GATEWAY_API_KEY
)
  throw Error("Live research requires AI_GATEWAY_API_KEY.");
mkdirSync(data, { recursive: true });
mkdirSync(".eve", { recursive: true });
const workflow = path.join(data, "workflow");
mkdirSync(workflow, { recursive: true });
if (!existsSync(".eve/.workflow-data"))
  symlinkSync(workflow, ".eve/.workflow-data", "dir");
const base = { ...process.env, NODE_ENV: "production", EVE_DEV: "0" };
const agent = spawn(
  process.execPath,
  [
    "node_modules/eve/bin/eve.js",
    "start",
    "--host",
    "127.0.0.1",
    "--port",
    "2000",
  ],
  { env: { ...base, PORT: "2000" }, stdio: "inherit" },
);
const app = spawn(process.execPath, ["preview-server.mjs"], {
  env: { ...base, EVE_HOST: "http://127.0.0.1:2000" },
  stdio: "inherit",
});
let closing = false;
function stop(code) {
  if (closing) return;
  closing = true;
  agent.kill("SIGTERM");
  app.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1000).unref();
}
agent.on("exit", (code) => stop(code || 0));
app.on("exit", (code) => stop(code || 0));
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
