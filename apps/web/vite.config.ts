import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// OKLE usa un sistema de tokens CSS propio; Tailwind no se mezcla en runtime.
export default defineConfig({ plugins: [sveltekit()] });
