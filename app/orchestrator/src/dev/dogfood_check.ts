import { pathToFileURL } from "node:url";
import { dogfoodCheckOptionsFromEnv, runDogfoodCheck } from "./dogfood_review.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await runDogfoodCheck(dogfoodCheckOptionsFromEnv(process.env));
  process.exitCode = exitCode;
}
