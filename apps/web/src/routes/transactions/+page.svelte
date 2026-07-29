<script lang="ts">
  import { page } from "$app/state";
  import { currency } from "$lib/demo";
  import {
    createTransaction,
    financeData,
    reverseTransaction,
    updateTransaction,
  } from "$lib/finance-store";
  import type { TransactionView } from "$lib/types";
  import { onMount } from "svelte";
  let search = $state("");
  let pocketFilter = $state("all");
  let payerFilter = $state("all");
  let categoryFilter = $state("all");
  let dateFrom = $state("");
  let dateTo = $state("");
  let registering = $state(false);
  let movementKind = $state<"expense" | "income" | "transfer">("expense");
  let amount = $state<number | undefined>();
  let accountId = $state("");
  let destinationAccountId = $state("");
  let merchant = $state("");
  let category = $state("Mercado");
  let payerMemberId = $state("");
  let error = $state("");
  let editing = $state<TransactionView | null>(null);
  let editMerchant = $state("");
  let editCategory = $state("");
  let spendingNature = $state<"household" | "personal">("household");
  let editSpendingNature = $state<"household" | "personal">("household");
  const correctionsMode = $derived(
    page.url.searchParams.get("mode") === "corrections",
  );
  const pockets = $derived($financeData.pockets);
  const destinationAccounts = $derived(
    $financeData.accounts.filter((account) => {
      const source = $financeData.accounts.find((item) => item.id === accountId);
      return (
        source &&
        account.id !== source.id &&
        account.scope === source.scope &&
        account.currency === source.currency
      );
    }),
  );
  const transactions = $derived(
    $financeData.transactions.filter((transaction) => {
      const term = search.trim().toLowerCase();
      const matchesSearch = !term || transaction.merchant.toLowerCase().includes(term) || transaction.category.toLowerCase().includes(term);
      const date = transaction.occurredAt.slice(0, 10);
      return matchesSearch &&
        (!correctionsMode || transaction.canCorrect !== false) &&
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
  const spendByCategory = $derived.by(() => {
    const totals = new Map<string, number>();
    for (const transaction of transactions) {
      if (transaction.kind !== "expense") continue;
      const label = transaction.category;
      totals.set(label, (totals.get(label) ?? 0) + transaction.amount);
    }
    return [...totals.entries()].sort((left, right) => right[1] - left[1]);
  });
  const spendByPayer = $derived.by(() => {
    const totals = new Map<string, number>();
    for (const transaction of transactions) {
      if (transaction.kind !== "expense") continue;
      totals.set(transaction.payer, (totals.get(transaction.payer) ?? 0) + transaction.amount);
    }
    return [...totals.entries()].sort((left, right) => right[1] - left[1]);
  });

  onMount(() => {
    const action = page.url.searchParams.get("action");
    registering =
      action === "new" || action === "income" || action === "transfer";
    movementKind =
      action === "income"
        ? "income"
        : action === "transfer"
          ? "transfer"
          : "expense";
    const latestPayroll = $financeData.transactions.find(
      (transaction) =>
        transaction.kind === "income" &&
        /salario|nómina|nomina|sueldo/i.test(
          `${transaction.merchant} ${transaction.category}`,
        ),
    );
    dateFrom = correctionsMode
      ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
      : (latestPayroll?.occurredAt.slice(0, 10) ??
        new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          .toISOString()
          .slice(0, 10));
  });

  async function save() {
    error = "";
    if (!amount || amount <= 0 || !merchant.trim()) {
      error = "Completa cantidad y descripción.";
      return;
    }
    try {
      const selectedAccountId = $financeData.accounts.some((account) => account.id === accountId)
        ? accountId
        : $financeData.accounts[0]?.id;
      if (!selectedAccountId) throw new Error("Selecciona una cuenta");
      await createTransaction({
        amount,
        accountId: selectedAccountId,
        destinationAccountId:
          movementKind === "transfer" ? destinationAccountId : undefined,
        merchant: merchant.trim(),
        category,
        payerMemberId: payerMemberId || $financeData.settings.memberId,
        kind: movementKind,
        spendingNature:
          movementKind === "expense" ? spendingNature : "household",
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
    editSpendingNature = transaction.spendingNature ?? "household";
  }

  async function saveEdit() {
    if (!editing || !editMerchant.trim() || !editCategory) return;
    try {
      await updateTransaction(editing.id, {
        merchant: editMerchant.trim(),
        category: editCategory,
        spendingNature: editSpendingNature,
      });
      editing = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible corregir el movimiento";
    }
  }

  async function reverse(transaction: TransactionView) {
    if (
      !confirm(
        `¿Revertir “${transaction.merchant}”? OKLE creará un movimiento compensatorio; no borrará el asiento original.`,
      )
    )
      return;
    error = "";
    try {
      await reverseTransaction(transaction.id);
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "No fue posible revertir el movimiento";
    }
  }
</script>
<div class="page">
  <header class="page-header"><div><span class="eyebrow">{correctionsMode ? "Ventana de siete días" : "Todo conciliado"}</span><h1>{correctionsMode ? "Correcciones" : "Movimientos"}</h1><p>{correctionsMode ? "Revisa y corrige descripción, categoría o naturaleza sin alterar el asiento bancario original." : "Ingresos, gastos y transferencias con cuenta de origen y destino."}</p></div>{#if !correctionsMode}<button class="primary-button" onclick={() => (registering = !registering)}>＋ Registrar</button>{/if}</header>
  {#if registering}
    <section class="panel inline-entry">
      <div class="form-grid"><label>Tipo<select bind:value={movementKind}><option value="expense">Gasto</option><option value="income">Ingreso recibido</option><option value="transfer">Transferencia entre cuentas</option></select></label><label>Cantidad<input type="number" min="1" bind:value={amount} /></label><label>{movementKind === "income" ? "Cuenta que recibe" : "Cuenta de origen"}<select bind:value={accountId}><option value="">Seleccionar…</option>{#each $financeData.accounts as account}<option value={account.id}>{account.icon} {account.name} · {currency(account.availableBalance, account.currency)} disponible</option>{/each}</select>{#if !$financeData.accounts.length}<small>Crea una cuenta desde <a href="/accounts">Cuentas</a>.</small>{/if}</label>{#if movementKind === "transfer"}<label>Cuenta que recibe<select bind:value={destinationAccountId}><option value="">Seleccionar…</option>{#each destinationAccounts as account}<option value={account.id}>{account.icon} {account.name} · {account.ownerName}</option>{/each}</select><small>Debe pertenecer al mismo libro y usar la misma moneda.</small></label>{/if}<label>Descripción<input bind:value={merchant} placeholder={movementKind === "transfer" ? "Ej. transferencia a mi pareja" : ""} /></label><label>Categoría<select bind:value={category}>{#each $financeData.categories as item}<option value={item.name}>{item.icon} {item.name}</option>{/each}</select></label><label>Responsable<select bind:value={payerMemberId}>{#each $financeData.members as member}<option value={member.id}>{member.displayName}</option>{/each}</select></label>{#if movementKind === "expense"}<label>Este gasto es<select bind:value={spendingNature}><option value="household">Familiar</option><option value="personal">Personal</option></select></label>{/if}</div>
      {#if error}<p class="form-error">{error}</p>{/if}<button class="primary-button" onclick={save}>Guardar {movementKind === "expense" ? "gasto" : movementKind === "income" ? "ingreso" : "transferencia"}</button>
    </section>
  {/if}
  <section class="source-analysis panel"><div><span class="eyebrow">Análisis del periodo</span><h2>Quién gastó y en qué</h2><p>El periodo comienza en la última nómina detectada; puedes cambiar las fechas.</p></div><div class="analysis-pairs"><div class="source-bars"><strong>Por categoría</strong>{#each spendByCategory.slice(0,4) as [label, total]}<div><span>{label}</span><b>{currency(total)}</b></div>{/each}</div><div class="source-bars"><strong>Por persona</strong>{#each spendByPayer.slice(0,4) as [label, total]}<div><span>{label}</span><b>{currency(total)}</b></div>{/each}</div></div></section>
  <section class="panel transaction-panel">
    <div class="filter-bar advanced"><input aria-label="Buscar movimientos" placeholder="Buscar comercio o categoría" bind:value={search} /><select aria-label="Filtrar bolsillo" bind:value={pocketFilter}><option value="all">Todos los bolsillos</option>{#each pockets as pocket}<option value={pocket.id}>{pocket.name}</option>{/each}</select><select aria-label="Filtrar persona" bind:value={payerFilter}><option value="all">Todas las personas</option>{#each $financeData.members as member}<option value={member.displayName}>{member.displayName}</option>{/each}</select><select aria-label="Filtrar categoría" bind:value={categoryFilter}><option value="all">Todas las categorías</option>{#each $financeData.categories as item}<option value={item.name}>{item.name}</option>{/each}</select><label>Desde<input type="date" bind:value={dateFrom} /></label><label>Hasta<input type="date" bind:value={dateTo} /></label></div>
    <div class="transaction-list detailed">
      {#each transactions as transaction}
        <div class="transaction-row"><span class="transaction-icon">{transaction.kind === "transfer" ? "↔" : transaction.category.slice(0, 1)}</span><span><strong>{transaction.merchant}</strong><small>{transaction.category}{transaction.kind === "expense" ? ` · ${transaction.spendingNature === "personal" ? "Personal" : "Familiar"}` : transaction.kind === "transfer" ? " · Transferencia" : " · Ingreso"}{transaction.reversed ? " · Revertido" : transaction.isReversal ? " · Movimiento compensatorio" : ""}{recurringMerchants.has(`${transaction.merchant.toLowerCase()}|${transaction.category}`) ? " · Recurrente" : ""}{transaction.syncStatus === "queued" ? " · Pendiente de sincronización" : ""}</small></span><span class="payer-badge">{transaction.payer}</span><span class="transaction-amount"><strong>{transaction.kind === "expense" ? "-" : transaction.kind === "income" ? "+" : "↔ "}{currency(transaction.amount, transaction.currency)}</strong><small>{transaction.date}</small></span><span class="row-actions correction-actions"><button class="icon-button" aria-label={`Editar ${transaction.merchant}`} title={transaction.canCorrect === false ? "El plazo de siete días terminó" : "Editar clasificación"} disabled={transaction.syncStatus === "queued" || transaction.canCorrect === false || transaction.reversed || transaction.isReversal} onclick={() => beginEdit(transaction)}>✎</button>{#if correctionsMode}<button class="danger-text" disabled={transaction.canReverse === false || transaction.reversed || transaction.isReversal} onclick={() => reverse(transaction)}>Revertir</button>{/if}</span></div>
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
      <label>Este gasto es<select bind:value={editSpendingNature}><option value="household">Familiar</option><option value="personal">Personal</option></select></label>
      <p class="privacy-note">Puedes corregir la clasificación durante siete días. Cada cambio queda auditado y el asiento contable original permanece en Firefly.</p>
      <button class="primary-button" onclick={saveEdit}>Guardar corrección</button>
    </div>
  </div>
{/if}
