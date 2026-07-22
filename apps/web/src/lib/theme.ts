import { browser } from "$app/environment";
import { get, writable } from "svelte/store";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "okle:theme";
const LEGACY_STORAGE_KEY = "finnest:theme";
const initial = browser
  ? ((localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ??
    (localStorage.getItem(LEGACY_STORAGE_KEY) as ThemePreference | null) ??
    "system")
  : "system";

export const themePreference = writable<ThemePreference>(initial);
export const resolvedTheme = writable<"light" | "dark">("light");

export function applyTheme(preference: ThemePreference): void {
  if (!browser) return;
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  resolvedTheme.set(dark ? "dark" : "light");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#0D1B2A" : "#123C69");
}

export function toggleTheme(): void {
  const current = get(resolvedTheme);
  themePreference.set(current === "dark" ? "light" : "dark");
}

if (browser) {
  themePreference.subscribe((preference) => {
    localStorage.setItem(STORAGE_KEY, preference);
    applyTheme(preference);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    let current: ThemePreference = "system";
    const unsubscribe = themePreference.subscribe((value) => (current = value));
    unsubscribe();
    if (current === "system") applyTheme(current);
  });
}
