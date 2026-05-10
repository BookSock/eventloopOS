export type RestorePlan = Record<string, unknown>;

export type RestorePlanResource = Record<string, unknown> & {
  kind?: string;
  url?: string;
  details?: unknown;
};

export type RestorePlanBuilder = (resource: RestorePlanResource) => RestorePlan | undefined;

export class RestorePlanRegistry {
  private readonly builders: Map<string, RestorePlanBuilder> = new Map();
  private fallback: RestorePlanBuilder | undefined;

  register(kind: string, builder: RestorePlanBuilder): this {
    this.builders.set(kind, builder);
    return this;
  }

  registerAlias(kind: string, aliasFor: string): this {
    const target = this.builders.get(aliasFor);
    if (!target) {
      throw new Error(`cannot alias ${kind} to unregistered builder ${aliasFor}`);
    }
    this.builders.set(kind, target);
    return this;
  }

  registerFallback(builder: RestorePlanBuilder): this {
    this.fallback = builder;
    return this;
  }

  build(resource: RestorePlanResource): RestorePlan | undefined {
    const kind = typeof resource.kind === "string" ? resource.kind : undefined;
    if (kind) {
      const builder = this.builders.get(kind);
      if (builder) {
        const plan = builder(resource);
        if (plan) return plan;
      }
    }
    return this.fallback?.(resource);
  }

  has(kind: string): boolean {
    return this.builders.has(kind);
  }
}
