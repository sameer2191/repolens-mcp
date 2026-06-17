const ignoredDirectories = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".repolens",
  ".codebase-memory",
  ".pnpm-store",
  "__pycache__",
  ".pytest_cache",
  ".venv",
  "venv",
  "target",
  "vendor",
  "vendored",
  "artifacts",
  "DerivedData",
  "xcuserdata",
  ".swiftpm",
  ".gradle",
  ".build"
]);

const ignoredFiles = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "tsconfig.tsbuildinfo"
]);

export function shouldIgnoreDirectory(name: string, includeHidden = false): boolean {
  if (ignoredDirectories.has(name)) {
    return true;
  }
  return !includeHidden && name.startsWith(".") && name !== ".github";
}

export function shouldIgnoreFile(name: string): boolean {
  if (ignoredFiles.has(name)) {
    return true;
  }
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|tar|bin|wasm|mp4|mov|sqlite|db)$/i.test(name);
}
