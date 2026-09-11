<script lang="ts">
  import "../app.css";
  import Nav from "$lib/Nav.svelte";
  import { hydrateFinanceData } from "$lib/finance-store";
  import { authMode, isAuthenticated, isServerMode, login } from "$lib/auth";
  import LocalLogin from "$lib/LocalLogin.svelte";
  import ThemeToggle from "$lib/ThemeToggle.svelte";
  import NotificationBell from "$lib/NotificationBell.svelte";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import "$lib/theme";
  let { children } = $props();
  let loading = $state(true);
  let authenticated = $state(false);
  let error = $state("");
  let syncMessage = $state("");

  function requestSync() {
    if (authenticated && isServerMode() && navigator.onLine && "serviceWorker" in navigator)
      void navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: "OKLE_SYNC_REQUEST" }));
  }
  onMount(() => {
    const syncResult = (event: MessageEvent) => {
      if (!authenticated) return;
      if (event.data?.type === "OKLE_SYNC_COMPLETE") void hydrateFinanceData().catch(() => { syncMessage = "No se pudo actualizar. Reintenta al recuperar conexión."; });
      if (event.data?.type === "OKLE_SYNC_REQUIRES_REVIEW") syncMessage = "Hay un gasto pendiente que requiere revisión. No lo registres otra vez; comprueba Movimientos.";
    };
    window.addEventListener("online", requestSync);
    navigator.serviceWorker?.addEventListener("message", syncResult);
    return () => {
      window.removeEventListener("online", requestSync);
      navigator.serviceWorker?.removeEventListener("message", syncResult);
    };
  });

  onMount(async () => {
    if (page.url.pathname === "/auth/callback") {
      loading = false;
      authenticated = true;
      return;
    }
    try {
      authenticated = await isAuthenticated();
      if (authenticated) await hydrateFinanceData();
      requestSync();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible iniciar la aplicación";
    } finally {
      loading = false;
    }
  });

  async function localLoginSucceeded() {
    await hydrateFinanceData();
    authenticated = true;
    requestSync();
  }
</script>

<svelte:head><title>OKLE · Finanzas en familia</title></svelte:head>
{#if loading}
  <div class="auth-screen"><img class="auth-logo" src="/icons/okle-master.png" alt="" /><p>Preparando OKLE…</p></div>
{:else if error}
  <div class="auth-screen"><img class="auth-logo" src="/icons/okle-master.png" alt="" /><h1>No pudimos conectar</h1><p>{error}</p><button class="primary-button" onclick={() => location.reload()}>Reintentar</button></div>
{:else if !authenticated && isServerMode()}
  <div class="auth-screen">
    <img class="auth-logo large" src="/icons/okle-master.png" alt="Logo de OKLE" />
    <span class="eyebrow">Finanzas en pareja</span>
    <h1>Su dinero, coordinado con propósito</h1>
    <p>Ingresa de forma segura para consultar el hogar y tus bolsillos privados.</p>
    {#if authMode() === "local"}
      <LocalLogin onSuccess={localLoginSucceeded} />
    {:else}
      <button class="primary-button" onclick={login}>Ingresar</button>
    {/if}
  </div>
{:else}
  <div class="app-shell">
    <Nav />
    <NotificationBell />
    <ThemeToggle />
    <main>{#if syncMessage}<p role="status">{syncMessage}</p>{/if}{@render children()}</main>
  </div>
{/if}
