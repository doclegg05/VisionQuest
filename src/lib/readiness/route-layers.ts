/**
 * The layout and template files Next.js renders above a page, so a
 * measurement test can notice when a new one appears. Reads the file system
 * only; test support for the readiness query counts.
 */
import { existsSync } from "node:fs";
import path from "node:path";

const LAYER_NAMES = ["layout", "template"] as const;
const LAYER_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"] as const;

/**
 * Every `layout` and `template` file from `appDir` down to `pageDir`, both
 * included, as paths relative to `root`, outermost first.
 */
export function routeLayers(root: string, appDir: string, pageDir: string): string[] {
  const relative = path.relative(appDir, pageDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${pageDir} is not inside ${appDir}.`);
  }
  const segments = relative === "" ? [] : relative.split(path.sep);
  const directories = [appDir, ...segments.map((_, index) => path.join(appDir, ...segments.slice(0, index + 1)))];
  return directories.flatMap((directory) =>
    LAYER_NAMES.flatMap((name) =>
      LAYER_EXTENSIONS.map((extension) => path.join(directory, `${name}${extension}`))
        .filter((file) => existsSync(file))
        .map((file) => path.relative(root, file).split(path.sep).join("/")),
    ),
  );
}
