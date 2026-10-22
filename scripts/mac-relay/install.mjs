/** Install only the VisionQuest agent; secrets never enter stdout or the repository. */
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = dirname(fileURLToPath(import.meta.url));
const root = join(source, "../..");
const destination = join(homedir(), ".local/share/visionquest/mac-relay");
const configPath = join(destination, "config.json");
const renderPath = join(destination, "render-env.json");
mkdirSync(destination, { recursive: true, mode: 0o700 });
chmodSync(destination, 0o700);
if (existsSync(configPath) !== existsSync(renderPath)) throw new Error("Incomplete existing credentials: preserve and inspect them before reinstalling");
if (!existsSync(configPath)) {
  const agentToken = randomBytes(32).toString("hex");
  const appToken = randomBytes(32).toString("hex");
  writeFileSync(configPath, JSON.stringify({ relayUrl: "wss://visionquest.onrender.com/__visionquest/local-ai/agent", agentToken, upstreamUrl: "http://127.0.0.1:11434" }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  writeFileSync(renderPath, JSON.stringify([
    { key: "VQ_MAC_RELAY_ENABLED", value: "true" },
    { key: "VQ_MAC_RELAY_AGENT_TOKEN", value: agentToken },
    { key: "VQ_MAC_RELAY_APP_TOKEN", value: appToken },
    { key: "COHORT_DEMO_MODE", value: "true" },
    { key: "COHORT_DEMO_LOCAL_ONLY", value: "true" },
    { key: "COHORT_DEMO_LOCAL_AI_ORIGIN", value: "http://127.0.0.1:11437" },
  ], null, 2) + "\n", { mode: 0o600, flag: "wx" });
}
for (const name of ["agent.mjs", "protocol.mjs", "inference-queue.mjs"]) copyFileSync(join(source, name), join(destination, name));
for (const name of ["ws", "zod"]) cpSync(join(root, "node_modules", name), join(destination, "node_modules", name), { recursive: true });
writeFileSync(join(destination, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: Object.fromEntries(["ws", "zod"].map((name) => [name, JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).version])) }, null, 2) + "\n");
const log = join(destination, "agent.log");
const errors = join(destination, "agent-error.log");
for (const path of [log, errors]) { if (!existsSync(path)) writeFileSync(path, "", { mode: 0o600 }); }
const xml = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const node = existsSync("/opt/homebrew/bin/node") ? "/opt/homebrew/bin/node" : process.execPath;
const args = ["/usr/bin/caffeinate", "-i", node, join(destination, "agent.mjs"), configPath];
const plist = join(homedir(), "Library/LaunchAgents/com.visionquest.mac-relay.plist");
mkdirSync(dirname(plist), { recursive: true });
writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.visionquest.mac-relay</string>
<key>ProgramArguments</key><array>${args.map((s) => `<string>${xml(s)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(destination)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(errors)}</string>
</dict></plist>\n`, { mode: 0o600 });
console.log("VisionQuest agent installed; private credentials preserved. LaunchAgent prepared but not started.");
