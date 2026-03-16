import { Prisma } from "@prisma/client";

export const REQUIRED_TABLES = [
  { schema: "visionquest", table: "Student" },
  { schema: "visionquest", table: "RateLimitEntry" },
  { schema: "visionquest", table: "AuditLog" },
] as const;

type RequiredTable = (typeof REQUIRED_TABLES)[number];

type Queryable = {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
};

export function formatRequiredTableRef({ schema, table }: RequiredTable) {
  return `${schema}."${table}"`;
}

export async function getMissingRequiredTables(database: Queryable) {
  const checks = await Promise.all(
    REQUIRED_TABLES.map(({ schema, table }) =>
      database.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
        SELECT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS c
          INNER JOIN pg_catalog.pg_namespace AS n
            ON n.oid = c.relnamespace
          WHERE n.nspname = ${schema}
            AND c.relname = ${table}
        ) AS exists
      `)
    )
  );

  return checks
    .map((rows, index) => (rows[0]?.exists ? null : formatRequiredTableRef(REQUIRED_TABLES[index])))
    .filter((tableName): tableName is string => tableName !== null);
}
