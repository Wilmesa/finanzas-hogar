<script lang="ts">
  import { page } from "$app/state";
  import { currency } from "$lib/demo";
  import { createTransaction, financeData, updateTransaction } from "$lib/finance-store";
  import type { TransactionView } from "$lib/types";
  import { onMount } from "svelte";
  let search = $state("");
  let pocketFilter = $state("all");
  let payerFilter = $state("all");
  let categoryFilter = $state("all");
  let dateFrom = $state("");
  let dateTo = $state("");
  let registering = $state(false);
  let amount = $state<number | undefined>();
  let pocketId = $state("daily");
  let accountId = $state("");
  let merchant = $state("");
  let category = $state("Mercado");
  let payerMemberId = $state("");
  let error = $state("");
  let editing = $state<TransactionView | null>(null);
  let editMerchant = $state("");
  let editCategory = $state("");
  const pockets = $derived($financeData.pockets);
  const transactions = $derived(
    $financeData.transactions.filter((transaction) => {
      const term = search.trim().toLowerCase();
      const matchesSearch = !term || transaction.merchant.toLowerCase().includes(term) || transaction.category.toLowerCase().includes(term);
      const date = transaction.occurredAt.slice(0, 10);
      return matchesSearch &&
        (pocketFilter === "all" || transaction.pocketId === pocketFilter) &&
        (payerFilter === "all" || transaction.payer === payerFilter) &&
        (categoryFilter === "all" || transaction.category === categoryFilter) &&
        (!dateFrom || date >= dateFrom) &&
        (!dateTo || date <= dateTo);
    }),
  );
  const recurringMerchants = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const transaction of $financeData.transactions) {
      const key = `${transaction.merchant.toLowerCase()}|${transaction.category}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count >= 2).map(([key]) => key));
  });
  const spendByPocket = $derived.by(() => {
    const totals = new Map<string, number>();
    for (const transaction of transactions) {
      if (transaction.kind !== "expense") continue;
      const label = transaction.pocketId ? transaction.pocket : "Sin bolsillo";
      totals.set(label, (totals.get(label) ?? 0) + transaction.amount);
    }
    return [...totals.entries()].sort((left, right) => right[1] - left[1]);
  });

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
        (account) =>
          account.scope === selectedPocket?.visibility ||
          (selectedPocket?.visibility === "private" &&
            account.scope === "household"),
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
        payerMemberId: payerMemberId || $financeData.settings.memberId,
      });
      registering = false;
      amount = undefined;
      merchant = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible guardar";
    }
  }

  function beginEdit(transaction: TransactionView) {
    editing = transaction;
    editMerchant = transaction.merchant;
    editCategory = transaction.category;
  }

  async function saveEdit() {
    if (!editing || !editMerchant.trim() || !editCategory) return;
    try {
      await updateTransaction(editing.id, {
        merchant: editMerchant.trim(),
        category: editCategory,
      });
      editing = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible corregir el movimiento";
    }
  }
</script>
<div class="page">
  <header class="page-header"><div><span class="eyebrow">Todo conciliado</span><h1>Movimientos</h1><p>Quién pagó, desde dónde y para qué.</p></div><button class="primary-button" onclick={() => (registering = !registering)}>＋ Registrar</button></header>
  {#if registering}
    <section class="panel inline-entry">
      <div class="form-grid"><label>Cantidad<input type="number" min="1" bind:value={amount} /></label><label>Bolsillo<select bind:value={pocketId}>{#each pockets as pocket}<option value={pocket.id}>{pocket.name}</option>{/each}</select></label><label>Cuenta o tarjeta<select bind:value={accountId}>{#each $financeData.accounts.filter((account) => { const selected = pockets.find((pocket) => pocket.id === pocketId); return account.scope === (selected?.visibility ?? pockets[0]?.visibility) || (selected?.visibility === "private" && account.scope === "household"); }) as account}<option value={account.id}>{account.name} · {account.currency} · {account.scope === "household" ? "Hogar" : "Personal"}</option>{/each}</select>{#if !$financeData.accounts.length}<small>Crea una cuenta desde <a href="/accounts">Cuentas</a>.</small>{/if}</label><label>Comercio o descripción<input bind:value={merchant} /></label><label>Categoría<select bind:value={category}>{#each $financeData.categories as item}<option value={item.name}>{item.name}</option>{/each}</select></label><label>Pagó<select bind:value={payerMemberId}>{#each $financeData.members as member}<option value={member.id}>{member.displayName}</option>{/each}</select></label></div>
      {#if error}<p class="form-error">{error}</p>{/if}<button class="primary-button" onclick={save}>Guardar movimiento</button>
    </section>
  {/if}
  <section class="source-analysis panel"><div><span class="eyebrow">Origen del gasto</span><h2>¿De qué bolsillo salió?</h2><p>La atribución permite detectar gastos cargados al propósito equivocado.</p></div><div class="source-bars">{#each spendByPocket.slice(0,4) as [pocket, total]}<div><span>{pocket}</span><b>{currency(total)}</b></div>{/each}{#if spendByPocket.length === 0}<small>Registra gastos para comparar sus fuentes.</small>{/if}</div></section>
  <section class="panel transaction-panel">
    <div class="filter-bar advanced"><input aria-label="Buscar movimientos" placeholder="Buscar comercio o categoría" bind:value={search} /><select aria-label="Filtrar bolsillo" bind:value={pocketFilter}><option value="all">Todos los bolsillos</option>{#each pockets as pocket}<option value={pocket.id}>{pocket.name}</option>{/each}</select><select aria-label="Filtrar persona" bind:value={payerFilter}><option value="all">Todas las personas</option>{#each $financeData.members as member}<option value={member.displayName}>{member.displayName}</option>{/each}</select><select aria-label="Filtrar categoría" bind:value={categoryFilter}><option value="all">Todas las categorías</option>{#each $financeData.categories as item}<option value={item.name}>{item.name}</option>{/each}</select><label>Desde<input type="date" bind:value={dateFrom} /></label><label>Hasta<input type="date" bind:value={dateTo} /></label></div>
    <div class="transaction-list detailed">
      {#each transactions as transaction}
        <div class="transaction-row"><span class="transaction-icon">{transaction.category.slice(0, 1)}</span><span><strong>{transaction.merchant}</strong><small>{transaction.category} · {transaction.pocket}{recurringMerchants.has(`${transaction.merchant.toLowerCase()}|${transaction.category}`) ? " · Recurrente" : ""}{transaction.syncStatus === "queued" ? " · Pendiente de sincronización" : ""}</small></span><span class="payer-badge">{transaction.payer}</span><span class="transaction-amount"><strong>{transaction.kind === "expense" ? "-" : "+"}{currency(transaction.amount, transaction.currency)}</strong><small>{transaction.date}</small></span><button class="icon-button" aria-label={`Editar ${transaction.merchant}`} title="Editar" disabled={transaction.syncStatus === "queued"} onclick={() => beginEdit(transaction)}>✎</button></div>
      {/each}
      {#if transactions.length === 0}<p class="empty-state">No hay movimientos con estos filtros.</p>{/if}
    </div>
  </section>
</div>

{#if editing}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (editing = null)}>
    <div class="quick-entry compact" role="dialog" aria-modal="true" aria-labelledby="edit-transaction-title">
      <header><div><span class="eyebrow">Corrección local trazable</span><h2 id="edit-transaction-title">Editar movimiento</h2></div><button class="icon-button" onclick={() => (editing = null)} aria-label="Cerrar">×</button></header>
      <label>Comercio o descripción<input bind:value={editMerchant} /></label>
      <label>Categoría<select bind:value={editCategory}>{#each $financeData.categories as item}<option value={item.name}>{item.name}</option>{/each}</select></label>
      <p class="privacy-note">La corrección actualiza la clasificación en OKLE y conserva el movimiento contable original en Firefly.</p>
      <button class="primary-button" onclick={saveEdit}>Guardar corrección</button>
    </div>
  </div>
{/if}
