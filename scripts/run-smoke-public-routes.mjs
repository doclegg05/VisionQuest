import { spawn } from "child_process";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const pythonExecutable = process.env.PYTHON || "python";
const smokeServerScript = process.env.SMOKE_SERVER_SCRIPT || "dev";
const smokePythonScript = process.env.SMOKE_PYTHON_SCRIPT || "scripts/smoke_public_routes.py";
const smokeApiScript = "scripts/smoke_api_routes.py";

loadEnvConfig(process.cwd(), smokeServerScript === "dev");

const smokeEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || "postgresql://fake:fake@localhost:5432/fake",
  JWT_SECRET: process.env.JWT_SECRET || "smoke-test-secret-not-real-at-all-32",
  API_KEY_ENCRYPTION_KEY:
    process.env.API_KEY_ENCRYPTION_KEY || "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  APP_BASE_URL: process.env.APP_BASE_URL || baseUrl,
  SMOKE_BASE_URL: baseUrl,
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForServer(url, server, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Smoke server exited early with code ${server.exitCode}.`);
    }

    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) {
        return;
      }
    } catch {
      // Retry until the dev server is fully reachable.
    }

    await delay(2_000);
  }

  throw new Error(`Timed out waiting for smoke server at ${url}.`);
}

async function stopServer(server) {
  if (server.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    await waitForExit(killer).catch(() => undefined);
    return;
  }

  server.kill("SIGTERM");
  await Promise.race([waitForExit(server), delay(5_000)]);
}

async function main() {
  const server =
    process.platform === "win32"
      ? spawn(`npm run ${smokeServerScript}`, {
          env: smokeEnv,
          stdio: "inherit",
          shell: true,
        })
      : spawn("npm", ["run", smokeServerScript], {
          env: smokeEnv,
          stdio: "inherit",
        });

  try {
    await waitForServer(baseUrl, server);

    const smoke = spawn(pythonExecutable, [smokePythonScript], {
      env: smokeEnv,
      stdio: "inherit",
    });

    const { code, signal } = await waitForExit(smoke);
    if (code !== 0) {
      throw new Error(
        `Smoke test failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`
      );
    }

    // Run API smoke tests (auth rejection, endpoint contracts)
    console.log("\n--- Running API smoke tests ---\n");
    const apiSmoke = spawn(pythonExecutable, [smokeApiScript], {
      env: smokeEnv,
      stdio: "inherit",
    });

    const apiResult = await waitForExit(apiSmoke);
    if (apiResult.code !== 0) {
      throw new Error(
        `API smoke test failed with ${apiResult.signal ? `signal ${apiResult.signal}` : `exit code ${apiResult.code}`}.`
      );
    }
  } finally {
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
