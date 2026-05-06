import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { ContractJsonSchemas } from "./json-schema.js";
import { getContractSchema } from "./schemas.js";

type FixtureEnvelope = {
  schema: string;
  valid?: boolean;
  data: unknown;
};

function usage(): never {
  throw new Error(
    "Usage: tsx src/cli.ts validate-fixtures <dir> | validate <schema> <json-file> | print-json-schema [schema]"
  );
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listJsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return listJsonFiles(path);
      return path.endsWith(".json") ? [path] : [];
    })
    .sort();
}

function formatIssues(error: unknown) {
  if (error && typeof error === "object" && "issues" in error) {
    return inspect((error as { issues: unknown }).issues, { depth: null, colors: false });
  }
  return String(error);
}

function validateEnvelope(file: string, rootDir: string) {
  const fixture = readJson(file) as FixtureEnvelope;
  if (!fixture.schema || !("data" in fixture)) {
    throw new Error(`${relative(rootDir, file)} must include schema and data`);
  }

  const result = getContractSchema(fixture.schema).safeParse(fixture.data);
  const expectedValid = fixture.valid !== false;
  if (expectedValid && !result.success) {
    throw new Error(`${relative(rootDir, file)} expected valid but failed:\n${formatIssues(result.error)}`);
  }
  if (!expectedValid && result.success) {
    throw new Error(`${relative(rootDir, file)} expected invalid but passed`);
  }
  return { file, schema: fixture.schema, valid: result.success, expectedValid };
}

export function validateFixtures(dir: string) {
  const files = listJsonFiles(dir);
  if (files.length === 0) {
    throw new Error(`No fixture JSON files found in ${dir}`);
  }
  return files.map((file) => validateEnvelope(file, dir));
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command) usage();

  if (command === "validate-fixtures") {
    const [dir] = args;
    if (!dir) usage();
    const results = validateFixtures(dir);
    for (const result of results) {
      console.log(`${result.expectedValid ? "valid" : "invalid"} fixture ok: ${relative(dir, result.file)} (${result.schema})`);
    }
    return;
  }

  if (command === "validate") {
    const [schemaName, file] = args;
    if (!schemaName || !file) usage();
    const result = getContractSchema(schemaName).safeParse(readJson(file));
    if (!result.success) {
      throw new Error(formatIssues(result.error));
    }
    console.log(`valid: ${schemaName} ${file}`);
    return;
  }

  if (command === "print-json-schema") {
    const [schemaName] = args;
    const output = schemaName ? ContractJsonSchemas[schemaName as keyof typeof ContractJsonSchemas] : ContractJsonSchemas;
    if (!output) throw new Error(`Unknown contract JSON Schema: ${schemaName}`);
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  usage();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
