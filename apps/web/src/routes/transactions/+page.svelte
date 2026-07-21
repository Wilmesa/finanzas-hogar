<script lang="ts">
  import { page } from "$app/state";
  import { currency } from "$lib/demo";
  import { createTransaction, financeData } from "$lib/finance-store";
  import { onMount } from "svelte";
  let search = $state("");
  let pocketFilter = $state("all");
  let registering = $state(false);
  let amount = $state<number | undefined>();
  let pocketId = $state("daily");
  let accountId = $state("");
  let merchant = $state("");
  let category = $state("Mercado");
  let payer = $state("Ana");
  let error = $state("");
  const pockets = $derived($financeData.pockets);
  const transactions = $derived(
    $financeData.transactions.filter((transaction) => {
      const term = search.trim().toLowerCase();
      const matchesSearch = !term || transaction.merchant.toLowerCase().includes(term) || transaction.category.toLowerCase().includes(term);
      return matchesSearch && (pocketFilter === "all" || transaction.pocketId === pocketFilter);
    }),
  );

  onMount(() => {
    registering = page.url.searchParams.get("action") === "new";
  });

  async function save() {
    error = "";
    if (!amount || amount <= 0 || !merchant.trim()) {
      error = "Completa cantidad y descripción.";
      return;
    }
    try {
      const selectedPocketId = pockets.some((pocket) => pocket.id === pocketId)
        ? pocketId
        : pockets[0]?.id;
      if (!selectedPocketId) throw new Error("Crea primero un bolsillo");
      const selectedPocket = pockets.find((pocket) => pocket.id === selectedPocketId);
      const compatibleAccounts = $financeData.accounts.filter(
        (account) => account.scope === selectedPocket?.visibility,
      );
      const selectedAccountId = compatibleAccounts.some((account) => account.id === accountId)
        ? accountId
        : compatibleAccounts[0]?.id;
      await createTransaction({
        amount,
        pocketId: selectedPocketId,
        accountId: selectedAccountId,
        merchant: merchant.trim(),
        category,
        payer,
      });
      registering = false;
      amount = undefined;
      merchant = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible guardar";
    }
  }
</script>
<div class="page">
  <header class="page-header"><div><span class="eyebrow">Todo conciliado</span><h1>Movimientos</h1><p>Quién pagó, desde dónde y para qué.</p></div><button class="primary-button" onclick={() => (registering = !registering)}>＋ Registrar</button></header>
  {#if registering}
    <section class="panel inline-entry">
      <div class="form-grid"><label>Cantidad<input type="number" min="1" bind:value={amount} /></label><label>Bolsillo<select bind:value={pocketId}>{#each pockets as pocket}<option value={pocket.id}>{pocket.name}</option>{/each}</select></label><label>Cuenta o tarjeta<select bind:value={accountId}>{#each $financeData.accounts.filter((account) => account.scope === (pockets.find((pocket) => pocket.id === pocketId)?.visibility ?? pockets[0]?.visibility)) as account}<option value={account.id}>{account.name} · {account.currency}</option>{/each}</select></label><label>Comercio o descripción<input bind:value={merchant} /></label><label>Categoría<select bind:value={category}><option>Mercado</option><option>Transporte</option><option>Restaurantes</option><option>Vivienda</option><option>Salud</option><option>Otros</option></select></label><label>Pagó<select bind:value={payer}><option>Ana</option><option>Leo</option></select></label></div>
      {#if error}<p class="form-error">{error}</p>{/if}<button class="primary-button" onclick={save}>Guardar movimiento</button>
    </section>
  {/if}
  <section class="panel transaction-panel">
    <div class="filter-bar"><input aria-label="Buscar movimientos" placeholder="Buscar comercio o categoría" bind:value={search} /><select aria-label="Filtrar bolsillo" bind:value={pocketFilter}><option value="all">Todos los bolsillos</option>{#each pockets as pocket}<option value={pocket.id}>{pocket.name}</option>{/each}</select></div>
    <div class="transaction-list detailed">
      {#each transactions as transaction}
        <div class="transaction-row"><span class="transaction-icon">{transaction.category.slice(0, 1)}</span><span><strong>{transaction.merchant}</strong><small>{transaction.category} · {transaction.pocket}</small></span><span class="payer-badge">{transaction.payer}</span><span class="transaction-amount"><strong>{transaction.kind === "expense" ? "-" : "+"}{currency(transaction.amount, transaction.currency)}</strong><small>{transaction.date}</small></span></div>
      {/each}
      {#if transactions.length === 0}<p class="empty-state">No hay movimientos con estos filtros.</p>{/if}
    </div>
  </section>
</div>
