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

function readableText(hex: string): "#FFFFFF" | "#102033" {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.6 ? "#102033" : "#FFFFFF";
}

export function applyInterfaceColors(
  primaryColor: string,
  accentColor: string,
): void {
  if (!browser) return;
  const root = document.documentElement;
  root.style.setProperty("--user-primary", primaryColor);
  root.style.setProperty("--user-on-primary", readableText(primaryColor));
  root.style.setProperty("--user-accent", accentColor);
  root.style.setProperty("--user-on-accent", readableText(accentColor));
}

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
