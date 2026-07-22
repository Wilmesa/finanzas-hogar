<script lang="ts">
  import { onMount } from "svelte";

  interface InstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  }

  let online = $state(true);
  let installed = $state(false);
  let canInstall = $state(false);
  let offlineReady = $state(false);
  let installPrompt: InstallPromptEvent | null = null;
  let message = $state("");

  onMount(() => {
    online = navigator.onLine;
    installed = window.matchMedia("(display-mode: standalone)").matches;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(() => (offlineReady = true)).catch(() => undefined);
    }

    const handleOnline = () => (online = true);
    const handleOffline = () => (online = false);
    const handlePrompt = (event: Event) => {
      event.preventDefault();
      installPrompt = event as InstallPromptEvent;
      canInstall = true;
    };
    const handleInstalled = () => {
      installed = true;
      canInstall = false;
      installPrompt = null;
      message = "Aplicación instalada en este dispositivo.";
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  });

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "dismissed") message = "Puedes instalarla más tarde desde este mismo lugar.";
    installPrompt = null;
    canInstall = false;
  }
</script>

<section class="pwa-card" aria-labelledby="pwa-title">
  <div>
    <span class="eyebrow">Aplicación instalable</span>
    <h2 id="pwa-title">OKLE en este dispositivo</h2>
    <p>
      {#if installed}
        Está instalada y se abre como una app independiente.
      {:else}
        Instálala para abrirla desde la pantalla de inicio y usar las pantallas ya visitadas sin conexión.
      {/if}
    </p>
  </div>
  <div class="pwa-actions">
    <span class:offline={!online} class="connection-status">{online ? "En línea" : "Sin conexión"}</span>
    {#if offlineReady}<span class="offline-status">Modo offline preparado</span>{/if}
    {#if canInstall && !installed}<button class="primary-button" onclick={install}>Instalar app</button>{/if}
  </div>
  {#if !canInstall && !installed}
    <small>En iPhone o iPad: Compartir → Añadir a pantalla de inicio. En otros navegadores, usa la opción Instalar del menú.</small>
  {/if}
  {#if message}<p class="success-message" role="status">{message}</p>{/if}
</section>

<style>
  .pwa-card {
    display: grid;
    gap: 1rem;
    padding: clamp(1.25rem, 3vw, 2rem);
    border-radius: 1.5rem;
    background: #e4efe7;
    border: 1px solid color-mix(in srgb, #275c48 18%, transparent);
  }
  .pwa-card h2 { margin: .25rem 0 .5rem; }
  .pwa-card p, .pwa-card small { margin: 0; max-width: 58ch; }
  .pwa-actions { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  .connection-status { display: inline-flex; align-items: center; gap: .45rem; padding: .45rem .75rem; border-radius: 999px; background: #fff; font-weight: 700; }
  .connection-status::before { content: ""; width: .55rem; height: .55rem; border-radius: 50%; background: #2b7c57; }
  .connection-status.offline::before { background: #b45a34; }
  .offline-status { font-size: .86rem; font-weight: 700; color: #275c48; }
</style>
