const runtime = globalThis as typeof globalThis & {
  process?: { versions?: { node?: string } };
};
if (typeof window !== "undefined" || !runtime.process?.versions?.node) {
  throw new Error("@januaryai/server requires Node.js and cannot run in a browser.");
}
export {};
