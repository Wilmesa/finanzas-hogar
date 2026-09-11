<script lang="ts">
  import { apiRequest } from "$lib/api";
  import { isServerMode } from "$lib/auth";
  import { financeData } from "$lib/finance-store";
  import { onMount } from "svelte";

  let status = $state<Record<string, unknown> | null>(null);
  let error = $state("");
  let completing = $state(false);

  onMount(async () => {
    if (!isServerMode()) {
      status = {
        steps: {
          household: Boolean($financeData.settings.householdName),
          sharedFirefly: $financeData.accountConnections.some(
            (connection) => connection.scope === "household" && connection.configured,
          ),
          sharedAccount: $financeData.accounts.some(
            (account) => account.scope === "household",
          ),
          privateAccount: $financeData.accounts.some(
            (account) => account.scope === "private",
          ),
          income: $financeData.incomeSources.length > 0,
          pocket: $financeData.pockets.length > 0,
          ai: $financeData.aiStatus.generationEnabled,
        },
      };
      return;
    }
    try {
      status = await apiRequest("/v1/onboarding/status");
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "No pudimos revisar la configuración";
    }
  });

  async function complete() {
    completing = true;
    error = "";
    try {
      if (isServerMode()) {
        await apiRequest("/v1/onboarding/complete", { method: "POST" });
      }
      location.assign("/");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No se pudo terminar la configuración";
    } finally {
      completing = false;
    }
  }
</script>

<div class="page onboarding-page">
  <header class="page-header">
    <div>
      <span class="eyebrow">Primeros pasos</span>
      <h1>Prepara OKLE</h1>
      <p>Para empezar solo necesitas tu hogar y una cuenta conectada. Después registra el dinero que ya tienes. Planes, IA y cuentas privadas son opcionales.</p>
    </div>
  </header>
  {#if error}
    <p class="form-error">{error}</p>
  {/if}
  {#if !status}
    <p>Revisando configuración…</p>
  {:else}
    <div class="onboarding-list">
      {#each [{key:"household",title:"Hogar y nombres",href:"/household"},{key:"sharedFirefly",title:"Libro compartido Firefly",href:"/accounts"},{key:"sharedAccount",title:"Primera cuenta compartida",href:"/accounts"},{key:"privateAccount",title:"Cuenta privada opcional",href:"/accounts"},{key:"income",title:"Fuente de ingreso",href:"/planning"},{key:"pocket",title:"Primer bolsillo",href:"/pockets"},{key:"ai",title:"Estado AI-CFO",href:"/copilot"}] as step}
        <a class="onboarding-step" href={step.href}>
          <span class:done={(status.steps as Record<string, boolean>)[step.key]}>{(status.steps as Record<string, boolean>)[step.key] ? "✓" : "○"}</span>
          <strong>{step.title}</strong><b>›</b>
        </a>
      {/each}
    </div>
    <button class="primary-button" disabled={completing} onclick={complete}>{completing ? "Guardando…" : "Terminar y abrir OKLE"}</button>
  {/if}
</div>
