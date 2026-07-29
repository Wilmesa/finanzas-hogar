<script lang="ts">
  import { currency } from "$lib/demo";
  import { createTransaction, financeData } from "$lib/finance-store";
  import { isServerMode } from "$lib/auth";
  import PocketCard from "$lib/PocketCard.svelte";
  let showQuickEntry = $state(false);
  let amount = $state<number | undefined>();
  let accountId = $state("");
  let merchant = $state("");
  let category = $state("Mercado");
  let payerMemberId = $state("");
  let scope = $state<"household" | "private">("household");
  let spendingNature = $state<"household" | "personal">("household");
  let saving = $state(false);
  let formError = $state("");

  const pockets = $derived($financeData.pockets);
  const transactions = $derived($financeData.transactions);
  const visibleAccounts = $derived(
    $financeData.accounts.filter((account) => account.scope === scope),
  );
  const accountConnection = $derived(
    $financeData.accountConnections.find(
      (connection) => connection.scope === scope,
    ),
  );
  const accountBalanceKnown = $derived(!isServerMode() || accountConnection?.status === "available");
  const currentMonthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  ).getTime();
  const monthlySpent = $derived(
    transactions
      .filter(
        (transaction) =>
          transaction.kind === "expense" &&
          transaction.scope === scope &&
          transaction.currency === $financeData.settings.baseCurrency &&
          new Date(transaction.occurredAt).getTime() >= currentMonthStart,
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0),
  );
  const dailyPocket = $derived(
    pockets.find(
      (pocket) =>
        pocket.visibility === scope &&
        pocket.currency === $financeData.settings.baseCurrency &&
        pocket.status === "active" &&
        pocket.policyKind === "periodic_spend",
    ),
  );
  const dailyPocketSpent = $derived(
    dailyPocket
      ? transactions
          .filter(
            (transaction) =>
              transaction.kind === "expense" &&
              transaction.scope === scope &&
              transaction.pocketId === dailyPocket.id &&
              transaction.currency === dailyPocket.currency &&
              new Date(transaction.occurredAt).getTime() >= currentMonthStart,
          )
          .reduce((sum, transaction) => sum + transaction.amount, 0)
      : 0,
  );
  const daysRemainingThisMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    0,
  ).getDate() - new Date().getDate() + 1;
  const nextIncome = $derived(
    [...$financeData.expectedIncomes]
      .filter((income) => income.status !== "cancelled" && income.status !== "received")
      .sort((left, right) => left.expectedDate.localeCompare(right.expectedDate))[0],
  );
  const budgetUsed = $derived(
    dailyPocket && dailyPocket.targetAmount > 0
      ? Math.min(
          100,
          Math.round((dailyPocketSpent / dailyPocket.targetAmount) * 100),
        )
      : null,
  );
  const latestInsight = $derived($financeData.insights.find((item) => item.scope === scope));
  const latestBundle = $derived(latestInsight?.payload.bundle);
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentTransactions = $derived(
    transactions.filter(
      (transaction) =>
        transaction.scope === scope &&
        new Date(transaction.occurredAt).getTime() >= sevenDaysAgo,
    ),
  );

  async function saveTransaction() {
    formError = "";
    if (!amount || amount <= 0 || !merchant.trim()) {
      formError = "Escribe una cantidad y una descripción.";
      return;
    }
    saving = true;
    try {
      const selectedAccountId = visibleAccounts.some((account) => account.id === accountId)
        ? accountId
        : visibleAccounts[0]?.id;
      if (!selectedAccountId) throw new Error("Crea o conecta primero una cuenta");
      await createTransaction({
        amount,
        accountId: selectedAccountId,
        merchant: merchant.trim(),
        category,
        payerMemberId: payerMemberId || $financeData.settings.memberId,
        spendingNature,
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
    <div><span class="eyebrow">{new Intl.DateTimeFormat("es-CO", { dateStyle: "full" }).format(new Date())}</span><h1>Buenos días, {$financeData.settings.memberName}</h1><p>{$financeData.settings.householdName} · {accountBalanceKnown ? "saldos reales actualizados desde Firefly." : accountConnection?.configured ? "Firefly no está disponible en este momento." : "conecta Firefly para consultar los saldos reales."}</p></div>
    <a class="avatar-button" href="/household" aria-label="Abrir perfil">{$financeData.settings.memberAvatar ?? $financeData.settings.memberName.slice(0,1).toUpperCase()}</a>
  </header>
  <div class="filter-tabs"><button class:active={scope === "household"} onclick={() => (scope = "household")}>Compartido</button><button class:active={scope === "private"} onclick={() => (scope = "private")}>Solo yo</button></div>

  <section class="section-block account-balance-section">
    <header class="section-heading"><div><span class="eyebrow">Dinero real por cuenta</span><h2>Lo que puedes usar hoy</h2><p>Disponible = saldo bancario menos el dinero que reservaste desde esa cuenta.</p></div><a href="/accounts">Administrar</a></header>
    {#if accountBalanceKnown && visibleAccounts.length}
      <div class="account-balance-grid">
        {#each visibleAccounts as account}
          <article class="account-balance-card" style={`--account-color:${account.color}`}>
            <header><span class="account-emoji">{account.icon}</span><span>{account.ownerName}</span></header>
            <h3>{account.name}</h3>
            <strong>{currency(account.availableBalance, account.currency)}</strong>
            <dl><div><dt>Saldo bancario</dt><dd>{currency(account.currentBalance, account.currency)}</dd></div><div><dt>En bolsillos</dt><dd>{currency(account.reservedAmount, account.currency)}</dd></div></dl>
          </article>
        {/each}
      </div>
    {:else}
      <div class="empty-state panel"><strong>{accountBalanceKnown ? "Aún no hay cuentas" : "No pudimos consultar Firefly"}</strong><p>{accountBalanceKnown ? "Crea o conecta una cuenta para conocer tu dinero real disponible." : "Tus reservas siguen guardadas; vuelve a intentarlo cuando el libro esté disponible."}</p></div>
    {/if}
  </section>

  <section class="hero-progress standalone panel">
    {#if budgetUsed === null}
      <div><span>Presupuesto de vida diaria</span><b>Sin configurar</b></div>
      <p>Crea un bolsillo con límite periódico para calcular el ritmo de gasto.</p>
    {:else}
      <div><span>Presupuesto usado este mes</span><b>{budgetUsed}%</b></div>
      <div class="progress"><span style={`width: ${budgetUsed}%`}></span></div>
      <p>Gasto del mes: <strong>{currency(monthlySpent)}</strong>. Disponible diario estimado en «{dailyPocket?.name}»: <strong>{currency((dailyPocket?.currentAmount ?? 0) / daysRemainingThisMonth)}</strong>.</p>
    {/if}
  </section>

  {#if latestBundle}
    <section class="insight-card"><span class="spark">✦</span><div><span class="eyebrow">Asesor · {latestInsight?.payload.provider} · {new Date(latestInsight?.createdAt ?? "").toLocaleDateString("es-CO")}</span><h2>{latestBundle.status === "ok" ? "Análisis financiero verificado" : "Datos insuficientes"}</h2><p>{latestBundle.summary}</p><a class="text-button" href="/copilot">Ver evidencia →</a></div></section>
  {:else}
    <section class="insight-card neutral"><span class="spark">✦</span><div><span class="eyebrow">Asesor</span><h2>Sin análisis generado</h2><p>Aún no hay suficientes movimientos para generar un análisis confiable.</p><a class="text-button" href="/copilot">Abrir asesor →</a></div></section>
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
        {#each recentTransactions.slice(0, 7) as transaction}
          <div class="transaction-row">
            <span class="transaction-icon">{transaction.kind === "transfer" ? "↔" : transaction.category.slice(0, 1)}</span>
            <span><strong>{transaction.merchant}</strong><small>{transaction.category} · {transaction.payer}</small></span>
            <span class="transaction-amount"><strong>{transaction.kind === "expense" ? "-" : transaction.kind === "income" ? "+" : "↔ "}{currency(transaction.amount, transaction.currency)}</strong><small>{transaction.date}</small></span>
          </div>
        {/each}
        {#if recentTransactions.length === 0}<p class="empty-inline">No hay movimientos en los últimos siete días.</p>{/if}
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
      <label>Cuenta o tarjeta<select bind:value={accountId}><option value="">Seleccionar…</option>{#each visibleAccounts as account}<option value={account.id}>{account.icon} {account.name} · disponible {currency(account.availableBalance, account.currency)}</option>{/each}</select>{#if visibleAccounts.length === 0}<small>No hay cuentas en este alcance. <a href="/accounts">Crear cuenta</a></small>{/if}</label>
      <label>Comercio o descripción<input placeholder="Ej. mercado semanal" bind:value={merchant} /></label>
      <div class="form-row"><label>Categoría<select bind:value={category}>{#each $financeData.categories as item}<option value={item.name}>{item.icon} {item.name}</option>{/each}</select></label><label>Pagó<select bind:value={payerMemberId}>{#each $financeData.members as member}<option value={member.id}>{member.displayName}</option>{/each}</select></label></div>
      <label>Este gasto es<select bind:value={spendingNature}><option value="household">Familiar</option><option value="personal">Personal</option></select></label>
      {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
      <button class="primary-button" disabled={saving} onclick={saveTransaction}>{saving ? "Guardando…" : "Guardar gasto"}</button>
    </div>
  </div>
{/if}
