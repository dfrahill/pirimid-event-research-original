import { eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn } from "eve/channels/auth";
import { createHash, timingSafeEqual } from "node:crypto";
const serviceAuth: AuthFn<Request> = (request) => {
  if (process.env.VERCEL && process.env.APP_RESEARCH_ENABLED !== "true")
    return null;
  const secret = process.env.EVE_SERVICE_PASSWORD;
  if (!secret || secret.length < 20) return null;
  const expected = "Basic " + Buffer.from("app:" + secret).toString("base64");
  const digest = (v: string) => createHash("sha256").update(v).digest();
  if (
    !timingSafeEqual(
      digest(request.headers.get("authorization") || ""),
      digest(expected),
    )
  )
    return null;
  return {
    attributes: {},
    authenticator: "private-service",
    principalId: "pirimid-app",
    principalType: "user",
  };
};
export default eveChannel({ auth: [serviceAuth, localDev()] });
