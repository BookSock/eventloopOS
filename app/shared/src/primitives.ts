import { z } from "zod";

const nonEmpty = z.string().min(1);
const schemaReference = z.union([nonEmpty, z.record(z.unknown())]);

export const PrimitiveHttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type PrimitiveHttpMethod = z.infer<typeof PrimitiveHttpMethodSchema>;

export const PrimitiveQueryParameterSchema = z
  .object({
    name: nonEmpty,
    in: z.literal("query").optional(),
    required: z.boolean().optional(),
    description: nonEmpty.optional(),
    schema: z.record(z.unknown()).optional()
  })
  .strict();
export type PrimitiveQueryParameter = z.infer<typeof PrimitiveQueryParameterSchema>;

export const PrimitiveHttpRouteSchema = z
  .object({
    method: PrimitiveHttpMethodSchema,
    path: nonEmpty.refine((path) => path.startsWith("/"), "path must start with /"),
    route_file: nonEmpty,
    request_schema: schemaReference.optional(),
    response_schema: schemaReference,
    request_body_required: z.boolean().optional(),
    no_request_body: z.boolean().optional(),
    query_parameters: z.array(PrimitiveQueryParameterSchema).optional(),
    parameters: z.array(PrimitiveQueryParameterSchema).optional()
  })
  .passthrough()
  .superRefine((route, ctx) => {
    if (route.query_parameters !== undefined && route.parameters !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "route must not define both query_parameters and parameters",
        path: ["query_parameters"]
      });
    }
    if (route.no_request_body === true && route.request_schema !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "route must not define request_schema when no_request_body is true",
        path: ["request_schema"]
      });
    }
    if (route.no_request_body === true && route.request_body_required !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "route must not define request_body_required when no_request_body is true",
        path: ["request_body_required"]
      });
    }
    if (["POST", "PUT", "PATCH"].includes(route.method) && route.request_schema === undefined && route.no_request_body !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mutating route must define request_schema or no_request_body",
        path: ["request_schema"]
      });
    }
  });
export type PrimitiveHttpRoute = z.infer<typeof PrimitiveHttpRouteSchema>;

export const PrimitiveDefinitionSchema = z
  .object({
    id: nonEmpty,
    title: nonEmpty,
    status: nonEmpty,
    summary: nonEmpty,
    http: z.array(PrimitiveHttpRouteSchema).optional(),
    cli: z.array(nonEmpty).optional(),
    code: z.array(nonEmpty),
    proofs: z.array(nonEmpty),
    self_tests: z.array(nonEmpty).optional()
  })
  .passthrough();
export type PrimitiveDefinition = z.infer<typeof PrimitiveDefinitionSchema>;

export const PrimitiveCatalogSchema = z
  .object({
    schema_version: z.literal(1),
    generated_at: nonEmpty.optional(),
    license: nonEmpty.optional(),
    status_labels: z.array(nonEmpty).optional(),
    schemas: z.record(z.record(z.unknown())),
    primitives: z.array(PrimitiveDefinitionSchema).min(1)
  })
  .passthrough();
export type PrimitiveCatalog = z.infer<typeof PrimitiveCatalogSchema>;

export type PrimitiveCatalogSummary = {
  primitiveCount: number;
  routeCount: number;
  responseSchemaCount: number;
  requestSchemaCount: number;
  noRequestBodyCount: number;
  schemaCount: number;
};

export function parsePrimitiveCatalog(value: unknown): PrimitiveCatalog {
  return PrimitiveCatalogSchema.parse(value);
}

export function routeHasRequestBody(route: PrimitiveHttpRoute): boolean {
  return ["POST", "PUT", "PATCH"].includes(route.method) && route.no_request_body !== true;
}

export function primitiveRoutes(catalog: PrimitiveCatalog): PrimitiveHttpRoute[] {
  return catalog.primitives.flatMap((primitive) => primitive.http ?? []);
}

export function getPrimitive(catalog: PrimitiveCatalog, id: string): PrimitiveDefinition | undefined {
  return catalog.primitives.find((primitive) => primitive.id === id);
}

export function getPrimitiveRoute(
  catalog: PrimitiveCatalog,
  method: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>,
  path: string
): PrimitiveHttpRoute | undefined {
  const normalizedMethod = method.toUpperCase() as PrimitiveHttpMethod;
  return primitiveRoutes(catalog).find((route) => route.method === normalizedMethod && route.path === path);
}

export function summarizePrimitiveCatalog(catalog: PrimitiveCatalog): PrimitiveCatalogSummary {
  const routes = primitiveRoutes(catalog);
  return {
    primitiveCount: catalog.primitives.length,
    routeCount: routes.length,
    responseSchemaCount: routes.filter((route) => route.response_schema).length,
    requestSchemaCount: routes.filter((route) => route.request_schema).length,
    noRequestBodyCount: routes.filter((route) => route.no_request_body === true).length,
    schemaCount: Object.keys(catalog.schemas).length
  };
}
