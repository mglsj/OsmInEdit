import { execSync } from "node:child_process";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

function gitHash(): string {
	try {
		return execSync("git rev-parse --short HEAD").toString().trim();
	} catch {
		return "dev";
	}
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			// Every route is prerendered as an empty client-side shell (see src/routes/+layout.ts),
			// so the build output can be served by any static file host, including from a subfolder.
			adapter: adapter(),
		}),
	],
	define: {
		__GIT_HASH__: JSON.stringify(gitHash()),
	},
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
});
