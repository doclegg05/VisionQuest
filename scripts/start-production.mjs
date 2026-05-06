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

const child = spawn(command, args, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
