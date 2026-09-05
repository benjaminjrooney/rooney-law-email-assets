import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    /**
     * Test files run one at a time. The integration suites share a single
     * TEST_DATABASE_URL and one of them drops and recreates that database in
     * `beforeAll`; in parallel that tears down another file's connections
     * mid-query.
     */
    fileParallelism: false,
  },
});
