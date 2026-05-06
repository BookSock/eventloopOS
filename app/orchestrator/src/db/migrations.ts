import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

export type Migration = {
  id: string;
  sql: string;
};

export async function defaultMigrationsDir(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../migrations"),
    resolve(here, "../../../migrations"),
  ];

  for (const candidate of candidates) {
    try {
      await readdir(candidate);
      return candidate;
    } catch {
      // Try next candidate for src/ and dist/ layouts.
    }
  }

  return candidates[0] ?? resolve(here, "../../migrations");
}

export async function loadMigrations(migrationsDir?: string): Promise<Migration[]> {
  const resolvedMigrationsDir = migrationsDir ?? (await defaultMigrationsDir());
  const files = (await readdir(resolvedMigrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  return Promise.all(files.map(async (file) => ({
    id: file,
    sql: await readFile(resolve(resolvedMigrationsDir, file), "utf8"),
  })));
}

export async function runMigrations(pool: Pool, migrationsDir?: string): Promise<string[]> {
  const client = await pool.connect();
  try {
    return await runMigrationsWithClient(client, migrationsDir);
  } finally {
    client.release();
  }
}

async function runMigrationsWithClient(client: PoolClient, migrationsDir?: string): Promise<string[]> {
  const migrations = await loadMigrations(migrationsDir);
  const applied: string[] = [];

  await client.query("BEGIN");
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const migration of migrations) {
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE id = $1", [migration.id]);
      if (existing.rowCount && existing.rowCount > 0) {
        continue;
      }

      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
      applied.push(migration.id);
    }

    await client.query("COMMIT");
    return applied;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
