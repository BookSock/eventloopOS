import { zodToJsonSchema } from "zod-to-json-schema";
import { ContractSchemas, type ContractName } from "./schemas.js";

export const ContractJsonSchemas = Object.fromEntries(
  Object.entries(ContractSchemas).map(([name, schema]) => [
    name,
    zodToJsonSchema(schema, {
      name,
      $refStrategy: "none"
    })
  ])
) as Record<ContractName, unknown>;

export function getContractJsonSchema(name: ContractName) {
  return ContractJsonSchemas[name];
}
