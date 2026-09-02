import { resolve } from "node:path";
import { defineConfig } from "vite";

const workspaceRoot = resolve(__dirname, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@deepwrite/contracts/renderer": resolve(
        workspaceRoot,
        "packages/contracts/src/renderer.ts"
      ),
      "@deepwrite/contracts": resolve(
        workspaceRoot,
        "packages/contracts/src/index.ts"
      ),
      "@deepwrite/pi-runtime-adapter": resolve(
        workspaceRoot,
        "packages/pi-runtime-adapter/src/index.ts"
      ),
      "@deepwrite/shared": resolve(
        workspaceRoot,
        "packages/shared/src/index.ts"
      )
    }
  },
  build: {
    ssr: resolve(__dirname, "src/cli.ts"),
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: "cli.mjs" }
    }
  },
  ssr: {
    noExternal: [
      "@deepwrite/contracts",
      "@deepwrite/pi-runtime-adapter",
      "@deepwrite/shared"
    ]
  }
});
