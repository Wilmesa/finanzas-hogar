import { browser } from "$app/environment";
import { writable } from "svelte/store";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "finnest:theme";
const initial = browser
  ? ((localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? "system")
  : "system";

export const themePreference = writable<ThemePreference>(initial);

export function applyTheme(preference: ThemePreference): void {
  if (!browser) return;
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#0B0F17" : "#F8FAFC");
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
