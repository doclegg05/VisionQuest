import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const standaloneServer = join(process.cwd(), ".next", "standalone", "server.js");
const command = process.execPath;
const args = existsSync(standaloneServer)
  ? [standaloneServer]
  : [
      join(
        process.cwd(),
        "node_modules",
        "next",
        "dist",
        "bin",
        "next"
      ),
      "start",
    ];

const relayEnabled = process.env.VQ_MAC_RELAY_ENABLED === "true";
let relay;
if (relayEnabled) {
  const { startRelay } = await import("./mac-relay/server.mjs");
  relay = await startRelay({
    agentToken: process.env.VQ_MAC_RELAY_AGENT_TOKEN,
    appToken: process.env.VQ_MAC_RELAY_APP_TOKEN,
    publicPort: Number(process.env.PORT || 3000),
    nextPort: 3001,
  });
}

const child = spawn(command, args, {
  stdio: "inherit",
  env: relayEnabled ? { ...process.env, PORT: "3001", HOSTNAME: "127.0.0.1" } : process.env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { child.kill(signal); void relay?.close(); });
}

child.on("exit", async (code, signal) => {
  await relay?.close();
  if (signal) {
    process.exit(signal === "SIGTERM" ? 0 : 1);
    return;
  }

  process.exit(code ?? 1);
});
