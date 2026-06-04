import { z } from "zod";
import { getContractSchema } from "./schemas.js";

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

export type PrimitiveRequestBuildInput = {
  catalog: PrimitiveCatalog;
  method: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>;
  path: string;
  baseUrl?: string;
  pathParams?: Record<string, string | number | boolean>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
};

export type PrimitiveRequest = {
  method: PrimitiveHttpMethod;
  path: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  route: PrimitiveHttpRoute;
};

export type PrimitiveHttpClient = {
  request<T = unknown>(
    method: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>,
    path: string,
    input?: PrimitiveHttpClientRequestOptions
  ): Promise<T>;
};

export type PrimitiveHttpClientRequestOptions = Omit<PrimitiveRequestBuildInput, "catalog" | "method" | "path" | "baseUrl">;

export type PrimitiveHttpClientOptions = {
  catalog: PrimitiveCatalog;
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
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

export function buildPrimitiveRequest(input: PrimitiveRequestBuildInput): PrimitiveRequest {
  const method = normalizePrimitiveMethod(input.method);
  const route = getPrimitiveRoute(input.catalog, method, input.path);
  if (!route) {
    throw new Error(`Unknown primitive route: ${method} ${input.path}`);
  }

  const path = interpolatePrimitivePath(route.path, input.pathParams ?? {});
  const query = encodePrimitiveQuery(route, input.query ?? {});
  const baseUrl = input.baseUrl ?? "http://127.0.0.1:4377";
  const url = new URL(path, baseUrl);
  url.search = query;

  const headers = { ...(input.headers ?? {}) };
  const request: PrimitiveRequest = {
    method,
    path,
    url: url.toString(),
    headers,
    route
  };

  if (routeHasRequestBody(route)) {
    if (input.body === undefined) {
      if (route.request_body_required === false) return request;
      throw new Error(`Primitive route requires request body: ${method} ${route.path}`);
    }
    const parsedBody = validatePrimitiveRequestBody(route, input.body);
    request.headers = {
      "content-type": "application/json",
      ...headers
    };
    request.body = JSON.stringify(parsedBody);
    return request;
  }

  if (input.body !== undefined) {
    throw new Error(`Primitive route does not accept request body: ${method} ${route.path}`);
  }
  return request;
}

export function validatePrimitiveRequestBody<T = unknown>(route: PrimitiveHttpRoute, body: unknown): T {
  if (!route.request_schema) {
    throw new Error(`Primitive route has no request schema: ${route.method} ${route.path}`);
  }
  return parseWithSchemaReference<T>(route.request_schema, body, "request", route);
}

export function validatePrimitiveResponse<T = unknown>(route: PrimitiveHttpRoute, body: unknown): T {
  return parseWithSchemaReference<T>(route.response_schema, body, "response", route);
}

export function createPrimitiveHttpClient(options: PrimitiveHttpClientOptions): PrimitiveHttpClient {
  const fetchImpl = options.fetch ?? fetch;
  return {
    async request<T = unknown>(
      method: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>,
      path: string,
      input: PrimitiveHttpClientRequestOptions = {}
    ) {
      const request = buildPrimitiveRequest({
        ...input,
        catalog: options.catalog,
        method,
        path,
        baseUrl: options.baseUrl,
        headers: {
          ...(options.headers ?? {}),
          ...(input.headers ?? {})
        }
      });
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(`Primitive route failed: ${request.method} ${request.path} HTTP ${response.status}`);
      }
      return validatePrimitiveResponse<T>(request.route, payload);
    }
  };
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

function normalizePrimitiveMethod(method: PrimitiveHttpMethod | Lowercase<PrimitiveHttpMethod>): PrimitiveHttpMethod {
  return PrimitiveHttpMethodSchema.parse(method.toUpperCase());
}

function interpolatePrimitivePath(path: string, pathParams: Record<string, string | number | boolean>): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = pathParams[name];
    if (value === undefined) {
      throw new Error(`Missing primitive path parameter: ${name}`);
    }
    return encodeURIComponent(String(value));
  });
}

function encodePrimitiveQuery(route: PrimitiveHttpRoute, query: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  const declared = route.query_parameters ?? route.parameters ?? [];
  for (const parameter of declared) {
    const value = query[parameter.name];
    if (value === undefined || value === null) {
      if (parameter.required) {
        throw new Error(`Missing primitive query parameter: ${parameter.name}`);
      }
      continue;
    }
    search.set(parameter.name, String(value));
  }
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (declared.some((parameter) => parameter.name === name)) continue;
    search.set(name, String(value));
  }
  return search.toString();
}

function parseWithSchemaReference<T>(
  schemaReferenceValue: z.infer<typeof schemaReference>,
  body: unknown,
  direction: "request" | "response",
  route: PrimitiveHttpRoute
): T {
  if (typeof schemaReferenceValue !== "string") {
    throw new Error(`Inline primitive ${direction} schemas are not available at runtime: ${route.method} ${route.path}`);
  }
  return getContractSchema(schemaReferenceValue).parse(body) as T;
}
