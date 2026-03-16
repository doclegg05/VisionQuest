import assert from "node:assert/strict";
import test from "node:test";
import { formatRequiredTableRef, getMissingRequiredTables, REQUIRED_TABLES } from "./health";

test("getMissingRequiredTables returns only tables missing from boolean checks", async () => {
  const responses: Array<Array<{ exists?: boolean }>> = [
    [{ exists: true }],
    [{ exists: false }],
    [{}],
  ];

  const database = {
    async $queryRaw<T>() {
      return (responses.shift() ?? []) as T;
    },
  };

  const missingTables = await getMissingRequiredTables(database);

  assert.deepEqual(missingTables, [
    formatRequiredTableRef(REQUIRED_TABLES[1]),
    formatRequiredTableRef(REQUIRED_TABLES[2]),
  ]);
});
