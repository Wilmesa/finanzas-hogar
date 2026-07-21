<script lang="ts">
  import { allocateToPocket, createPocket, financeData, setPocketStatus } from "$lib/finance-store";
  import PocketCard from "$lib/PocketCard.svelte";
  let filter = $state<"all" | "household" | "private">("all");
  let creating = $state(false);
  let name = $state("");
  let purpose = $state("sinking_fund");
  let targetAmount = $state<number | undefined>();
  let policyKind = $state<"target_by_date" | "target_by_contribution" | "periodic_spend">("target_by_date");
  let targetDate = $state("");
  let monthlyContribution = $state<number | undefined>();
  let privatePocket = $state(false);
  let currencyCode = $state("COP");
  let saving = $state(false);
  let error = $state("");
  let allocatingPocketId = $state<string | null>(null);
  let allocationAmount = $state<number | undefined>();
  let actionError = $state("");
  const pockets = $derived($financeData.pockets);
  const visible = $derived(filter === "all" ? pockets : pockets.filter((pocket) => pocket.visibility === filter));

  async function savePocket() {
    error = "";
    if (!name.trim() || !targetAmount || targetAmount <= 0) {
      error = "Escribe un nombre y una meta mayor que cero.";
      return;
    }
    if (policyKind === "target_by_date" && !targetDate) {
      error = "Selecciona la fecha límite.";
      return;
    }
    if (policyKind === "target_by_contribution" && (!monthlyContribution || monthlyContribution <= 0)) {
      error = "Escribe el aporte máximo mensual.";
      return;
    }
    saving = true;
    try {
      await createPocket({
        name: name.trim(), purpose, visibility: privatePocket ? "private" : "household", currency: currencyCode,
        targetAmount, policyKind, targetDate: targetDate || undefined, monthlyContribution,
      });
      name = "";
      targetAmount = undefined;
      targetDate = "";
      monthlyContribution = undefined;
      privatePocket = false;
      creating = false;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible crear el bolsillo";
    } finally {
      saving = false;
    }
  }

  async function applyAllocation() {
    if (!allocatingPocketId || !allocationAmount || allocationAmount <= 0) return;
    await allocateToPocket(allocatingPocketId, allocationAmount);
    allocatingPocketId = null;
    allocationAmount = undefined;
  }

  async function changeStatus(pocket: (typeof pockets)[number], status: "active" | "paused" | "archived") {
    actionError = "";
    try { await setPocketStatus(pocket, status); }
    catch (cause) { actionError = cause instanceof Error ? cause.message : "No pudimos actualizar el bolsillo"; }
  }
</script>

<div class="page">
  <header class="page-header"><div><span class="eyebrow">Dinero con propósito</span><h1>Tus bolsillos</h1><p>Organiza el presente sin perder de vista lo que viene.</p></div><button class="primary-button desktop-action" onclick={() => (creating = !creating)}>＋ Nuevo bolsillo</button></header>
  <div class="filter-tabs" aria-label="Filtrar bolsillos">
    <button class:active={filter === "all"} onclick={() => (filter = "all")}>Todos</button>
    <button class:active={filter === "household"} onclick={() => (filter = "household")}>Compartidos</button>
    <button class:active={filter === "private"} onclick={() => (filter = "private")}>Solo yo</button>
  </div>
  {#if creating}
    <section class="create-pocket panel">
      <header><div><span class="eyebrow">Nuevo propósito</span><h2>Crea un bolsillo</h2></div><span class="privacy-default">Compartido por defecto</span></header>
      <div class="form-grid">
        <label>Nombre<input placeholder="Ej. Fondo de emergencia" bind:value={name} /></label>
        <label>Tipo<select bind:value={purpose}><option value="sinking_fund">Ahorro</option><option value="periodic_spend">Gasto periódico</option><option value="purchase">Compra</option><option value="debt">Deuda</option><option value="investment">Inversión</option><option value="real_estate">Inmueble</option><option value="custom">Otro</option></select></label>
        <label>¿Cuánto necesitas?<input inputmode="decimal" type="number" min="1" placeholder="0" bind:value={targetAmount} /></label>
        <label>Moneda<select bind:value={currencyCode}><option>COP</option><option>USD</option><option>EUR</option></select></label>
        <label>¿Cómo quieres calcularlo?<select bind:value={policyKind}><option value="target_by_date">Tengo una fecha límite</option><option value="target_by_contribution">Tengo un aporte máximo</option><option value="periodic_spend">Es un límite periódico</option></select></label>
        {#if policyKind === "target_by_date"}<label>Fecha límite<input type="date" bind:value={targetDate} /></label>{/if}
        {#if policyKind === "target_by_contribution"}<label>Aporte máximo mensual<input type="number" min="1" bind:value={monthlyContribution} /></label>{/if}
      </div>
      <label class="switch-row"><input type="checkbox" bind:checked={privatePocket} /> Solo yo <small>Tu pareja no verá el nombre, finalidad ni movimientos.</small></label>
      {#if error}<p class="form-error" role="alert">{error}</p>{/if}
      <button class="primary-button" disabled={saving} onclick={savePocket}>{saving ? "Creando…" : "Calcular y crear"}</button>
    </section>
  {/if}
  {#if actionError}<p class="form-error" role="alert">{actionError}</p>{/if}
  <div class="pocket-grid full">{#each visible as pocket}<div class="pocket-with-action"><PocketCard {pocket} /><div class="pocket-actions"><button onclick={() => (allocatingPocketId = pocket.id)}>＋ Aportar</button><button onclick={() => changeStatus(pocket, pocket.status === "paused" ? "active" : "paused")}>{pocket.status === "paused" ? "Reanudar" : "Pausar"}</button><button onclick={() => confirm(`¿Archivar ${pocket.name}?`) && changeStatus(pocket, "archived")}>Archivar</button></div></div>{/each}</div>
  {#if visible.length === 0}<div class="empty-state panel"><strong>No hay bolsillos en esta vista</strong><p>Crea uno compartido o privado para reservar dinero con propósito.</p></div>{/if}
  <button class="fab mobile-only" onclick={() => (creating = !creating)}><span>＋</span> Nuevo</button>
</div>

{#if allocatingPocketId}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (allocatingPocketId = null)}>
    <div class="quick-entry compact" role="dialog" aria-modal="true" aria-labelledby="allocation-title">
      <header><div><span class="eyebrow">Reserva virtual</span><h2 id="allocation-title">Aportar a {pockets.find((pocket) => pocket.id === allocatingPocketId)?.name}</h2></div><button class="icon-button" onclick={() => (allocatingPocketId = null)} aria-label="Cerrar">×</button></header>
      <label>Cantidad<input type="number" min="1" bind:value={allocationAmount} /></label>
      <p class="privacy-note">Este aporte reserva dinero dentro de la app; no crea una transferencia bancaria.</p>
      <button class="primary-button" onclick={applyAllocation}>Guardar aporte</button>
    </div>
  </div>
{/if}
