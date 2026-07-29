<script lang="ts">
  import { apiRequest } from "$lib/api";
  import { isServerMode } from "$lib/auth";
  import { currency } from "$lib/demo";
  import { financeData } from "$lib/finance-store";
  import { onMount } from "svelte";

  interface CalendarItem {
    id: string;
    kind: "transaction" | "expected_income" | "payment";
    date: string;
    title: string;
    amount: string | null;
    currency: string;
    status: string;
    category?: string | null;
    paymentPlanId?: string;
    member?: { displayName: string; color: string } | null;
  }

  let cursor = $state(new Date());
  let items = $state<CalendarItem[]>([]);
  let selectedDate = $state(new Date().toISOString().slice(0, 10));
  let loading = $state(false);
  let error = $state("");
  const year = $derived(cursor.getFullYear());
  const month = $derived(cursor.getMonth());
  const monthLabel = $derived(
    new Intl.DateTimeFormat("es-CO", {
      month: "long",
      year: "numeric",
    }).format(cursor),
  );
  const days = $derived.by(() => {
    const first = new Date(year, month, 1);
    const count = new Date(year, month + 1, 0).getDate();
    const leading = (first.getDay() + 6) % 7;
    return [
      ...Array.from({ length: leading }, () => null),
      ...Array.from({ length: count }, (_, index) => index + 1),
    ];
  });
  const selectedItems = $derived(
    items.filter((item) => item.date === selectedDate),
  );

  async function loadMonth() {
    const from = new Date(year, month, 1).toISOString().slice(0, 10);
    const to = new Date(year, month + 1, 0).toISOString().slice(0, 10);
    loading = true;
    error = "";
    try {
      if (isServerMode()) {
        const result = await apiRequest<{ items: CalendarItem[] }>(
          `/v1/calendar?from=${from}&to=${to}`,
        );
        items = result.items;
      } else {
        items = [
          ...$financeData.transactions
            .filter((transaction) => {
              const date = transaction.occurredAt.slice(0, 10);
              return date >= from && date <= to;
            })
            .map((transaction) => ({
              id: transaction.id,
              kind: "transaction" as const,
              date: transaction.occurredAt.slice(0, 10),
              title: transaction.merchant,
              amount: String(transaction.amount),
              currency: transaction.currency,
              status: transaction.syncStatus ?? "synchronized",
              category: transaction.category,
            })),
          ...$financeData.expectedIncomes
            .filter(
              (income) =>
                income.expectedDate >= from && income.expectedDate <= to,
            )
            .map((income) => ({
              id: income.id,
              kind: "expected_income" as const,
              date: income.expectedDate,
              title: income.sourceName,
              amount: String(income.actualAmount ?? income.expectedAmount),
              currency: income.currency,
              status: income.status,
            })),
        ];
      }
    } catch (cause) {
      error =
        cause instanceof Error ? cause.message : "No pudimos cargar el calendario";
    } finally {
      loading = false;
    }
  }

  function dayKey(day: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function moveMonth(offset: number) {
    cursor = new Date(year, month + offset, 1);
    selectedDate = new Date(year, month + offset, 1)
      .toISOString()
      .slice(0, 10);
    void loadMonth();
  }

  onMount(loadMonth);
</script>

<div class="page calendar-page">
  <header class="page-header">
    <div><span class="eyebrow">Día a día y futuro</span><h1>Calendario financiero</h1><p>Gastos, ingresos esperados y pagos en una sola línea de tiempo.</p></div>
  </header>
  <section class="calendar-layout">
    <article class="panel calendar-card">
      <header><button class="icon-button" aria-label="Mes anterior" onclick={() => moveMonth(-1)}>←</button><h2>{monthLabel}</h2><button class="icon-button" aria-label="Mes siguiente" onclick={() => moveMonth(1)}>→</button></header>
      <div class="calendar-weekdays">{#each ["L","M","M","J","V","S","D"] as label}<span>{label}</span>{/each}</div>
      <div class="calendar-grid">
        {#each days as day}
          {#if day === null}<span class="calendar-empty"></span>{:else}
            {@const key = dayKey(day)}
            {@const dayItems = items.filter((item) => item.date === key)}
            <button class:selected={selectedDate === key} onclick={() => (selectedDate = key)}>
              <span>{day}</span>
              <span class="calendar-dots">
                {#if dayItems.some((item) => item.kind === "transaction")}<i class="expense" title="Movimiento"></i>{/if}
                {#if dayItems.some((item) => item.kind === "expected_income")}<i class="income" title="Ingreso esperado"></i>{/if}
                {#if dayItems.some((item) => item.kind === "payment")}<i class="payment" title="Pago"></i>{/if}
              </span>
            </button>
          {/if}
        {/each}
      </div>
      <footer><span><i class="expense"></i> Movimientos</span><span><i class="income"></i> Ingresos</span><span><i class="payment"></i> Pagos</span></footer>
    </article>
    <article class="panel day-detail">
      <span class="eyebrow">Detalle</span>
      <h2>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString("es-CO", { dateStyle: "long" })}</h2>
      {#each selectedItems as item}
        <div class="calendar-item kind-{item.kind}">
          <span>{item.kind === "transaction" ? "●" : item.kind === "payment" ? "▣" : "＋"}</span>
          <div><strong>{item.title}</strong><small>{item.kind === "transaction" ? item.category ?? "Movimiento" : item.kind === "payment" ? "Pago programado" : "Ingreso esperado"} · {item.status}</small></div>
          {#if item.amount}<b>{currency(Number(item.amount), item.currency)}</b>{/if}
          <a href={item.kind === "payment" ? "/payments" : item.kind === "expected_income" ? "/planning" : "/transactions"}>Abrir</a>
        </div>
      {/each}
      {#if loading}<p>Cargando…</p>{:else if error}<p class="form-error">{error}</p>{:else if selectedItems.length === 0}<div class="empty-state"><strong>Sin eventos</strong><p>No hay registros para este día.</p></div>{/if}
    </article>
  </section>
</div>
