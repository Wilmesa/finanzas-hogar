<script lang="ts">
  import "../app.css";
  import Nav from "$lib/Nav.svelte";
  import { hydrateFinanceData } from "$lib/finance-store";
  import { isAuthenticated, isServerMode, login } from "$lib/auth";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  let { children } = $props();
  let loading = $state(true);
  let authenticated = $state(false);
  let error = $state("");

  onMount(async () => {
    if (page.url.pathname === "/auth/callback") {
      loading = false;
      authenticated = true;
      return;
    }
    try {
      authenticated = await isAuthenticated();
      if (authenticated) await hydrateFinanceData();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible iniciar la aplicación";
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head><title>Nuestro Dinero</title></svelte:head>
{#if loading}
  <div class="auth-screen"><span class="brand-mark">N</span><p>Preparando tu hogar…</p></div>
{:else if error}
  <div class="auth-screen"><span class="brand-mark">N</span><h1>No pudimos conectar</h1><p>{error}</p><button class="primary-button" onclick={() => location.reload()}>Reintentar</button></div>
{:else if !authenticated && isServerMode()}
  <div class="auth-screen">
    <span class="brand-mark large">N</span>
    <span class="eyebrow">Finanzas en pareja</span>
    <h1>Un lugar tranquilo para su dinero</h1>
    <p>Ingresa de forma segura para consultar el hogar y tus bolsillos privados.</p>
    <button class="primary-button" onclick={login}>Ingresar</button>
  </div>
{:else}
  <div class="app-shell">
    <Nav />
    <main>{@render children()}</main>
  </div>
{/if}
