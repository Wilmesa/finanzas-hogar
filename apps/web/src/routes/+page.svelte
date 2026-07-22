<script lang="ts">
  import { currency } from "$lib/demo";
  import { createTransaction, financeData } from "$lib/finance-store";
  import PocketCard from "$lib/PocketCard.svelte";
  let showQuickEntry = $state(false);
  let amount = $state<number | undefined>();
  let pocketId = $state("daily");
  let accountId = $state("");
  let merchant = $state("");
  let category = $state("Mercado");
  let payerMemberId = $state("");
  let scope = $state<"household" | "private">("household");
  let saving = $state(false);
  let formError = $state("");

  const pockets = $derived($financeData.pockets);
  const transactions = $derived($financeData.transactions);
  const available = $derived(
    pockets
      .filter((pocket) => pocket.visibility === "household" && pocket.currency === $financeData.settings.baseCurrency)
      .reduce((sum, pocket) => sum + pocket.currentAmount, 0),
  );
  const monthlySpent = $derived(
    transactions
      .filter((transaction) => transaction.kind === "expense" && transaction.currency === $financeData.settings.baseCurrency)
      .reduce((sum, transaction) => sum + transaction.amount, 0),
  );
  const dailyPocket = $derived(pockets.find((pocket) => pocket.id === "daily"));
  const nextIncome = $derived(
    [...$financeData.expectedIncomes]
      .filter((income) => income.status !== "cancelled" && income.status !== "received")
      .sort((left, right) => left.expectedDate.localeCompare(right.expectedDate))[0],
  );
  const budgetUsed = $derived(
    dailyPocket ? Math.min(100, Math.round(((dailyPocket.targetAmount - dailyPocket.currentAmount) / dailyPocket.targetAmount) * 100)) : 0,
  );
  const latestInsight = $derived($financeData.insights.find((item) => item.scope === scope));
  const latestBundle = $derived(latestInsight?.payload.bundle);

  async function saveTransaction() {
    formError = "";
    if (!amount || amount <= 0 || !merchant.trim()) {
      formError = "Escribe una cantidad y una descripción.";
      return;
    }
    saving = true;
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
        payerMemberId: payerMemberId || $financeData.settings.memberId,
      });
      amount = undefined;
      merchant = "";
      showQuickEntry = false;
    } catch (cause) {
      formError = cause instanceof Error ? cause.message : "No fue posible guardar";
    } finally {
      saving = false;
    }
  }
</script>

<div class="page home-page">
  <header class="page-header">
    <div><span class="eyebrow">{new Intl.DateTimeFormat("es-CO", { dateStyle: "full" }).format(new Date())}</span><h1>Buenos días, {$financeData.settings.memberName}</h1><p>{$financeData.settings.householdName} · datos actualizados desde Firefly.</p></div>
    <a class="avatar-button" href="/household" aria-label="Abrir perfil">{$financeData.settings.memberAvatar ?? $financeData.settings.memberName.slice(0,1).toUpperCase()}</a>
  </header>
  <div class="filter-tabs"><button class:active={scope === "household"} onclick={() => (scope = "household")}>Compartido</button><button class:active={scope === "private"} onclick={() => (scope = "private")}>Solo yo</button></div>

  <section class="hero-balance">
    <div>
      <span class="eyebrow">Disponible después de compromisos</span>
      <strong>{currency(available)}</strong>
      <small>En {pockets.filter((pocket) => pocket.visibility === "household").length} bolsillos compartidos</small>
    </div>
    <div class="hero-progress">
      <div><span>Presupuesto usado</span><b>{budgetUsed}%</b></div>
      <div class="progress light"><span style={`width: ${budgetUsed}%`}></span></div>
      <p>Gasto registrado: <strong>{currency(monthlySpent)}</strong>. Disponible diario estimado: <strong>{currency((dailyPocket?.currentAmount ?? 0) / 12)}</strong>.</p>
    </div>
  </section>

  {#if latestBundle}
    <section class="insight-card"><span class="spark">✦</span><div><span class="eyebrow">Copiloto · {latestInsight?.payload.provider} · {new Date(latestInsight?.createdAt ?? "").toLocaleDateString("es-CO")}</span><h2>{latestBundle.status === "ok" ? "Análisis financiero verificado" : "Datos insuficientes"}</h2><p>{latestBundle.summary}</p><a class="text-button" href="/copilot">Ver evidencia →</a></div></section>
  {:else}
    <section class="insight-card neutral"><span class="spark">✦</span><div><span class="eyebrow">Copiloto</span><h2>Sin análisis generado</h2><p>Aún no hay suficientes movimientos para generar un análisis confiable.</p><a class="text-button" href="/copilot">Revisar AI-CFO →</a></div></section>
  {/if}

  <section class="section-block">
    <header class="section-heading"><div><span class="eyebrow">Dinero con propósito</span><h2>Bolsillos activos</h2></div><a href="/pockets">Ver todos</a></header>
    <div class="pocket-grid">
      {#each pockets.slice(0, 3) as pocket}<PocketCard {pocket} />{/each}
    </div>
  </section>

  <section class="two-columns">
    <article class="panel">
      <header class="section-heading"><div><span class="eyebrow">Últimos registros</span><h2>Movimientos</h2></div><a href="/transactions">Ver todos</a></header>
      <div class="transaction-list">
        {#each transactions.slice(0, 3) as transaction}
          <div class="transaction-row">
            <span class="transaction-icon">{transaction.category.slice(0, 1)}</span>
            <span><strong>{transaction.merchant}</strong><small>{transaction.category} · {transaction.payer}</small></span>
            <span class="transaction-amount"><strong>{transaction.kind === "expense" ? "-" : "+"}{currency(transaction.amount, transaction.currency)}</strong><small>{transaction.date}</small></span>
          </div>
        {/each}
      </div>
    </article>
    <article class="panel allocation-card">
      <span class="eyebrow">Próximo ingreso planeado</span>
      {#if nextIncome}<h2>{nextIncome.sourceName}</h2><p>{nextIncome.reason}</p><div class="allocation-preview"><span>Fecha esperada</span><b>{nextIncome.expectedDate}</b><span>Cantidad</span><b>{currency(nextIncome.expectedAmount, nextIncome.currency)}</b><span>Confianza</span><b>{Math.round(nextIncome.probability * 100)}%</b></div>{:else}<h2>Distribuye antes de gastar</h2><p>Registra salarios, primas, arriendos u otros ingresos futuros.</p>{/if}
      <a class="secondary-button action-link" href="/planning">Abrir plan financiero</a>
    </article>
  </section>

  <button class="fab" onclick={() => (showQuickEntry = true)}><span>＋</span> Registrar</button>
</div>

{#if showQuickEntry}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (showQuickEntry = false)}>
    <div class="quick-entry" role="dialog" aria-modal="true" aria-labelledby="quick-title">
      <header><div><span class="eyebrow">Movimiento rápido</span><h2 id="quick-title">Registrar gasto</h2></div><button class="icon-button" onclick={() => (showQuickEntry = false)} aria-label="Cerrar">×</button></header>
      <div class="amount-input"><span>$</span><input aria-label="Cantidad" inputmode="decimal" placeholder="0" type="number" min="1" bind:value={amount} /></div>
      <label>¿De qué bolsillo?<select bind:value={pocketId}>{#each pockets as pocket}<option value={pocket.id}>{pocket.name} · {pocket.visibility === "private" ? "Solo yo" : "Compartido"}</option>{/each}</select></label>
      <label>Cuenta o tarjeta<select bind:value={accountId}>{#each $financeData.accounts.filter((account) => account.scope === (pockets.find((pocket) => pocket.id === pocketId)?.visibility ?? pockets[0]?.visibility)) as account}<option value={account.id}>{account.name} · {account.currency}</option>{/each}</select>{#if !$financeData.accounts.some((account) => account.scope === (pockets.find((pocket) => pocket.id === pocketId)?.visibility ?? pockets[0]?.visibility))}<small>No hay cuentas en este alcance. <a href="/accounts">Crear cuenta</a></small>{/if}</label>
      <label>Comercio o descripción<input placeholder="Ej. mercado semanal" bind:value={merchant} /></label>
      <div class="form-row"><label>Categoría<select bind:value={category}>{#each $financeData.categories as item}<option value={item.name}>{item.name}</option>{/each}</select></label><label>Pagó<select bind:value={payerMemberId}>{#each $financeData.members as member}<option value={member.id}>{member.displayName}</option>{/each}</select></label></div>
      {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
      <button class="primary-button" disabled={saving} onclick={saveTransaction}>{saving ? "Guardando…" : "Guardar gasto"}</button>
    </div>
  </div>
{/if}
