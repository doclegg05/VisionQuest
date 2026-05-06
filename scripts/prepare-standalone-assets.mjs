import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standaloneDir = join(root, ".next", "standalone");

if (!existsSync(standaloneDir)) {
  process.exit(0);
}

const copies = [
  {
    from: join(root, ".next", "static"),
    to: join(standaloneDir, ".next", "static"),
  },
  {
    from: join(root, "public"),
    to: join(standaloneDir, "public"),
  },
];

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    continue;
  }

  rmSync(to, { recursive: true, force: true });
  mkdirSync(join(to, ".."), { recursive: true });
  cpSync(from, to, { recursive: true });
}
