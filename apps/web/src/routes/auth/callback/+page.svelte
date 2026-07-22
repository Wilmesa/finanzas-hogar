<script lang="ts">
  import { completeLogin } from "$lib/auth";
  import { onMount } from "svelte";

  let error = $state("");
  onMount(async () => {
    try {
      await completeLogin(new URL(location.href));
      location.replace("/");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible completar el ingreso";
    }
  });
</script>

<div class="auth-screen">
  <span class="brand-mark large">O</span>
  {#if error}
    <h1>No pudimos iniciar sesión</h1>
    <p>{error}</p>
    <a class="primary-button" href="/">Volver</a>
  {:else}
    <h1>Verificando tu identidad…</h1>
    <p>Esto solo toma un momento.</p>
  {/if}
</div>
