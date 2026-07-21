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
    if (isServerMode()) {
      await apiRequest("/v1/onboarding/complete", { method: "POST" });
    }
    location.assign("/");
  }
</script>

<div class="page onboarding-page">
  <header class="page-header">
    <div>
      <span class="eyebrow">Primeros pasos</span>
      <h1>Prepara FinNest</h1>
      <p>Comprueba el hogar, los libros contables y el primer plan sin exponer tokens en el navegador.</p>
    </div>
  </header>
  {#if error}
    <p class="form-error">{error}</p>
  {:else if !status}
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
    <button class="primary-button" disabled={completing} onclick={complete}>{completing ? "Guardando…" : "Terminar y abrir FinNest"}</button>
  {/if}
</div>
