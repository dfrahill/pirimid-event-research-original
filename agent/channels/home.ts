import { defineChannel, GET, POST, DELETE } from "eve/channels";
// @ts-expect-error App modules are plain JavaScript and tested separately.
import { cloudApp } from "../../lib/cloud-app.mjs";
// @ts-expect-error Generated at build time from ui/.
import assets from "../lib/generated/ui.mjs";
const handle = cloudApp({ assets });
export default defineChannel({
  routes: [
    GET("/", (req, ctx) => handle(req, ctx)),
    GET("/static/:asset", (req, ctx) => handle(req, ctx)),
    GET("/assets/:file", (req, ctx) => handle(req, ctx)),
    GET("/healthz", (req, ctx) => handle(req, ctx)),
    GET("/api/status", (req, ctx) => handle(req, ctx)),
    GET("/api/jobs", (req, ctx) => handle(req, ctx)),
    GET("/api/jobs/:id", (req, ctx) => handle(req, ctx)),
    GET("/api/jobs/:id/export", (req, ctx) => handle(req, ctx)),
    GET("/api/shortlist", (req, ctx) => handle(req, ctx)),

    POST("/api/research", (req, ctx) => handle(req, ctx)),
    POST("/api/shortlist", (req, ctx) => handle(req, ctx)),
    POST("/api/jobs/:id/cancel", (req, ctx) => handle(req, ctx)),
    DELETE("/api/shortlist/:id", (req, ctx) => handle(req, ctx)),
  ],
});
