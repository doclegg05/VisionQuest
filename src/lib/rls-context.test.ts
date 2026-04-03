import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withRlsContext, getRlsContext, type RlsContext } from "./rls-context";

describe("rls-context", () => {
  describe("getRlsContext", () => {
    it("returns undefined outside of withRlsContext", () => {
      const ctx = getRlsContext();
      assert.equal(ctx, undefined);
    });
  });

  describe("withRlsContext", () => {
    it("stores and retrieves context correctly", () => {
      const ctx: RlsContext = {
        userId: "user-1",
        role: "student",
        studentId: "student-1",
      };

      withRlsContext(ctx, () => {
        const retrieved = getRlsContext();
        assert.ok(retrieved, "context should be defined inside withRlsContext");
        assert.equal(retrieved.userId, "user-1");
        assert.equal(retrieved.role, "student");
        assert.equal(retrieved.studentId, "student-1");
      });
    });

    it("context is cleaned up after withRlsContext completes", () => {
      const ctx: RlsContext = {
        userId: "user-1",
        role: "student",
        studentId: "student-1",
      };

      withRlsContext(ctx, () => {
        assert.ok(getRlsContext(), "context should exist inside callback");
      });

      const after = getRlsContext();
      assert.equal(after, undefined, "context should be undefined after withRlsContext completes");
    });

    it("inner withRlsContext creates independent scope", () => {
      const outer: RlsContext = {
        userId: "u1",
        role: "student",
        studentId: "s1",
      };
      const inner: RlsContext = {
        userId: "u2",
        role: "teacher",
        studentId: "s2",
      };

      withRlsContext(outer, () => {
        assert.equal(getRlsContext()?.userId, "u1");
        assert.equal(getRlsContext()?.role, "student");

        withRlsContext(inner, () => {
          assert.equal(getRlsContext()?.userId, "u2");
          assert.equal(getRlsContext()?.role, "teacher");
          assert.equal(getRlsContext()?.studentId, "s2");
        });

        // Outer context restored after inner scope exits
        assert.equal(getRlsContext()?.userId, "u1");
        assert.equal(getRlsContext()?.role, "student");
        assert.equal(getRlsContext()?.studentId, "s1");
      });
    });

    it("maintains context across async boundaries", async () => {
      const ctx: RlsContext = {
        userId: "u1",
        role: "student",
        studentId: "s1",
      };

      await withRlsContext(ctx, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const retrieved = getRlsContext();
        assert.ok(retrieved, "context should survive async boundary");
        assert.equal(retrieved.userId, "u1");
        assert.equal(retrieved.role, "student");
        assert.equal(retrieved.studentId, "s1");
      });
    });

    it("_rlsInjected flag can be set and read within context", () => {
      const ctx: RlsContext = {
        userId: "u1",
        role: "student",
        studentId: "s1",
      };

      withRlsContext(ctx, () => {
        const c = getRlsContext()!;
        assert.equal(c._rlsInjected, undefined, "_rlsInjected should be undefined initially");

        c._rlsInjected = true;
        assert.equal(
          getRlsContext()?._rlsInjected,
          true,
          "_rlsInjected should be true after setting",
        );

        // Reset flag to prevent double injection
        c._rlsInjected = false;
        assert.equal(
          getRlsContext()?._rlsInjected,
          false,
          "_rlsInjected should be false after resetting",
        );
      });
    });

    it("returns the callback return value", () => {
      const ctx: RlsContext = {
        userId: "u1",
        role: "student",
        studentId: "s1",
      };

      const result = withRlsContext(ctx, () => {
        return 42;
      });

      assert.equal(result, 42, "withRlsContext should pass through the return value");
    });
  });
});
