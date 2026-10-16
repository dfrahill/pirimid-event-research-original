import { defineSandbox } from "eve/sandbox";
import { JustBashSandbox } from "eve/sandbox/just-bash";
// Research tools run in the app runtime; no shell/file tools are exposed.
export const environment = JustBashSandbox.environment();
export default defineSandbox(() => environment.open());
