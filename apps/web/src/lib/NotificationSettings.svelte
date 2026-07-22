<script lang="ts">
  import { onMount } from "svelte";
  import { apiRequest } from "$lib/api";
  import { isServerMode } from "$lib/auth";

  type Preference = {
    enabled: boolean;
    timezone: string;
    times: unknown;
  };

  let enabled = $state(false);
  let timezone = $state("America/Bogota");
  let times = $state(["20:00"]);
  let loading = $state(true);
  let saving = $state(false);
  let message = $state("");
  let error = $state("");
  let permission = $state<NotificationPermission | "unsupported">("default");

  onMount(async () => {
    if (!isServerMode()) {
      loading = false;
      return;
    }
    permission = "Notification" in window ? Notification.permission : "unsupported";
    try {
      const preference = await apiRequest<Preference>("/v1/reminders/preferences");
      enabled = preference.enabled;
      timezone = preference.timezone;
      if (Array.isArray(preference.times)) {
        const valid = preference.times.filter((item): item is string => typeof item === "string");
        if (valid.length) times = valid;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible cargar los recordatorios";
    } finally {
      loading = false;
    }
  });

  function applicationServerKey(value: string) {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
  }

  async function ensureSubscription() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      throw new Error("Este navegador no ofrece Web Push. En iPhone, instala primero la PWA en la pantalla de inicio.");
    }
    const result = await Notification.requestPermission();
    permission = result;
    if (result !== "granted") throw new Error("Debes permitir las notificaciones en el navegador para activar los avisos.");
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const { publicKey } = await apiRequest<{ publicKey: string }>("/v1/push/public-key");
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });
    }
    await apiRequest("/v1/push/subscriptions", {
      method: "POST",
      body: JSON.stringify(subscription.toJSON()),
    });
  }

  async function save() {
    saving = true;
    error = "";
    message = "";
    try {
      if (enabled) await ensureSubscription();
      times = [...new Set(times)].sort();
      await apiRequest("/v1/reminders/preferences", {
        method: "PUT",
        body: JSON.stringify({ enabled, timezone, times }),
      });
      message = enabled
        ? `Recordatorios activos: ${times.join(", ")}.`
        : "Recordatorios pausados.";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible guardar";
    } finally {
      saving = false;
    }
  }

  function addTime() {
    const candidate = times.at(-1) ?? "20:00";
    times = [...times, candidate];
  }

  function removeTime(index: number) {
    if (times.length === 1) return;
    times = times.filter((_, itemIndex) => itemIndex !== index);
  }

  function updateTime(index: number, value: string) {
    times = times.map((time, itemIndex) => (itemIndex === index ? value : time));
  }
</script>

<section class="reminder-card" aria-labelledby="reminder-title">
  <div class="reminder-heading">
    <div>
      <span class="eyebrow">Hábito diario</span>
      <h2 id="reminder-title">Recordatorios en este dispositivo</h2>
      <p>Elige tantos horarios como necesites. Cada miembro configura sus propios avisos.</p>
    </div>
    <label class="toggle">
      <input type="checkbox" bind:checked={enabled} disabled={loading || !isServerMode()} />
      <span>{enabled ? "Activos" : "Pausados"}</span>
    </label>
  </div>

  {#if !isServerMode()}
    <p class="notice">Los avisos automáticos se habilitan al conectar la PWA con el servidor.</p>
  {:else if loading}
    <p class="notice">Cargando configuración…</p>
  {:else}
    <div class="time-grid">
      {#each times as time, index}
        <label>
          <span>Aviso {index + 1}</span>
          <span class="time-row">
            <input type="time" value={time} oninput={(event) => updateTime(index, event.currentTarget.value)} />
            <button type="button" class="remove" onclick={() => removeTime(index)} disabled={times.length === 1} aria-label={`Eliminar aviso ${index + 1}`}>×</button>
          </span>
        </label>
      {/each}
    </div>
    <div class="actions">
      <button type="button" class="secondary" onclick={addTime}>+ Agregar horario</button>
      <button type="button" class="primary" onclick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar avisos"}</button>
    </div>
    <p class="privacy-note">El mensaje de la pantalla bloqueada es genérico y no muestra información financiera. Zona horaria: {timezone}.</p>
    {#if permission === "denied"}<p class="form-error" role="alert">Las notificaciones están bloqueadas en el sistema. Habilítalas en los ajustes del navegador o de la PWA.</p>{/if}
    {#if message}<p class="success-message" role="status">{message}</p>{/if}
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  {/if}
</section>

<style>
  .reminder-card { margin: 1rem 0; padding: clamp(1rem, 3vw, 1.5rem); border: 1px solid var(--line); border-radius: 1.25rem; background: var(--paper); color: var(--ink); }
  .reminder-heading { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
  h2 { margin: .2rem 0; font-size: 1.25rem; }
  p { margin: .35rem 0; }
  .toggle { display: flex; align-items: center; gap: .45rem; white-space: nowrap; font-weight: 700; }
  .toggle input { width: 1.25rem; height: 1.25rem; accent-color: #176b52; }
  .time-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: .8rem; margin-top: 1rem; }
  .time-grid label > span:first-child { display: block; margin-bottom: .3rem; color: var(--muted); font-size: .82rem; }
  .time-row { display: flex; gap: .35rem; }
  input[type="time"] { min-width: 0; flex: 1; padding: .75rem; border: 1px solid var(--line); border-radius: .75rem; font: inherit; background: var(--paper); color: var(--ink); }
  button { min-height: 44px; border-radius: 999px; padding: .65rem 1rem; border: 0; font: inherit; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .55; cursor: not-allowed; }
  .remove { width: 44px; padding: 0; border: 1px solid var(--line); background: transparent; color: var(--ink); font-size: 1.35rem; }
  .actions { display: flex; flex-wrap: wrap; gap: .65rem; margin-top: 1rem; }
  .primary { background: var(--forest); color: white; }
  .secondary { background: var(--mint); color: var(--forest); }
  .privacy-note, .notice { color: var(--muted); font-size: .86rem; margin-top: .85rem; }
  :global(:root[data-theme="dark"]) .primary { background: #2f73a9; }
  @media (max-width: 520px) { .reminder-heading { flex-direction: column; } .actions button { flex: 1 1 100%; } }
</style>
