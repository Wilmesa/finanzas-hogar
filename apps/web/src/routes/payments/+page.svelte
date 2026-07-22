<script lang="ts">
  import { apiRequest } from "$lib/api";
  import { currency } from "$lib/demo";
  import { financeData } from "$lib/finance-store";
  import { isServerMode } from "$lib/auth";
  import { onMount } from "svelte";

  type Occurrence = {
    id: string; dueDate: string; plannedAmount?: number; actualAmount?: number;
    status: string; paidAt?: string; sourcePocketId?: string; note?: string;
  };
  type Payment = {
    id: string; name: string; type: string; visibility: "household" | "private";
    currency: string; totalAmount?: number; estimatedAmount?: number; recurrence: string;
    nextDueDate?: string; paymentUrl?: string; reference?: string; notes?: string;
    status: string; occurrences: Occurrence[];
  };

  let payments = $state<Payment[]>([]);
  let editing = $state<Payment | null>(null);
  let showForm = $state(false);
  let error = $state("");
  let saving = $state(false);
  let name = $state("");
  let type = $state("service");
  let amount = $state<number | undefined>();
  let totalAmount = $state<number | undefined>();
  let recurrence = $state("monthly");
  let nextDueDate = $state(new Date().toISOString().slice(0, 10));
  let paymentUrl = $state("");
  let reference = $state("");
  let notes = $state("");
  let privatePayment = $state(false);
  let payingOccurrence = $state<Occurrence | null>(null);
  let actualAmount = $state<number | undefined>();
  let sourcePocketId = $state("");

  onMount(load);

  async function load() {
    if (!isServerMode()) {
      payments = JSON.parse(localStorage.getItem("okle:payments") ?? "[]") as Payment[];
      return;
    }
    payments = (await apiRequest<Payment[]>("/v1/payments")).map(normalize);
  }

  function normalize(payment: Payment): Payment {
    return {
      ...payment,
      totalAmount: payment.totalAmount === undefined || payment.totalAmount === null ? undefined : Number(payment.totalAmount),
      estimatedAmount: payment.estimatedAmount === undefined || payment.estimatedAmount === null ? undefined : Number(payment.estimatedAmount),
      nextDueDate: payment.nextDueDate?.slice(0, 10),
      occurrences: (payment.occurrences ?? []).map((item) => ({
        ...item, dueDate: item.dueDate.slice(0, 10),
        plannedAmount: item.plannedAmount === undefined || item.plannedAmount === null ? undefined : Number(item.plannedAmount),
        actualAmount: item.actualAmount === undefined || item.actualAmount === null ? undefined : Number(item.actualAmount),
      })),
    };
  }

  function persistLocal() { localStorage.setItem("okle:payments", JSON.stringify(payments)); }

  function openForm(payment?: Payment) {
    editing = payment ?? null;
    name = payment?.name ?? ""; type = payment?.type ?? "service";
    amount = payment?.estimatedAmount; totalAmount = payment?.totalAmount;
    recurrence = payment?.recurrence ?? "monthly";
    nextDueDate = payment?.nextDueDate ?? new Date().toISOString().slice(0, 10);
    paymentUrl = payment?.paymentUrl ?? ""; reference = payment?.reference ?? "";
    notes = payment?.notes ?? ""; privatePayment = payment?.visibility === "private";
    showForm = true; error = "";
  }

  async function save() {
    if (!name.trim() || !amount || !nextDueDate) return (error = "Completa nombre, valor estimado y próxima fecha.");
    saving = true; error = "";
    const input = {
      name: name.trim(), type, visibility: (privatePayment ? "private" : "household") as "private" | "household",
      currency: $financeData.settings.baseCurrency, estimatedAmount: String(amount),
      ...(totalAmount ? { totalAmount: String(totalAmount) } : {}), recurrence, nextDueDate,
      ...(paymentUrl.trim() ? { paymentUrl: paymentUrl.trim() } : {}),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    try {
      if (isServerMode()) {
        await apiRequest(editing ? `/v1/payments/${editing.id}` : "/v1/payments", {
          method: editing ? "PATCH" : "POST", body: JSON.stringify(input),
        });
        await load();
      } else if (editing) {
        payments = payments.map((item) => item.id === editing?.id ? normalize({ ...item, ...input, estimatedAmount: amount, totalAmount }) : item);
        persistLocal();
      } else {
        payments = [normalize({ id: crypto.randomUUID(), ...input, estimatedAmount: amount, totalAmount, status: "active", occurrences: [{ id: crypto.randomUUID(), dueDate: nextDueDate, plannedAmount: amount, status: "planned" }] }), ...payments];
        persistLocal();
      }
      showForm = false;
    } catch (cause) { error = cause instanceof Error ? cause.message : "No fue posible guardar"; }
    finally { saving = false; }
  }

  async function archive(payment: Payment) {
    if (!confirm(`¿Archivar “${payment.name}”? Su historial se conserva.`)) return;
    if (isServerMode()) { await apiRequest(`/v1/payments/${payment.id}`, { method: "DELETE" }); await load(); }
    else { payments = payments.filter((item) => item.id !== payment.id); persistLocal(); }
  }

  async function addDate(payment: Payment) {
    const dueDate = prompt("Nueva fecha de pago (AAAA-MM-DD)", payment.nextDueDate ?? new Date().toISOString().slice(0, 10));
    if (!dueDate) return;
    const planned = prompt("Valor aproximado para esta fecha", String(payment.estimatedAmount ?? ""));
    if (isServerMode()) {
      await apiRequest(`/v1/payments/${payment.id}/occurrences`, {
        method: "POST",
        body: JSON.stringify({ dueDate, ...(planned ? { plannedAmount: planned } : {}) }),
      });
      await load();
      return;
    }
    payments = payments.map((item) => item.id === payment.id ? { ...item, occurrences: [...item.occurrences, { id: crypto.randomUUID(), dueDate, plannedAmount: planned ? Number(planned) : item.estimatedAmount, status: "planned" }].sort((left, right) => left.dueDate.localeCompare(right.dueDate)) } : item);
    persistLocal();
  }

  function openPaid(occurrence: Occurrence) {
    payingOccurrence = occurrence;
    actualAmount = occurrence.plannedAmount;
    sourcePocketId = "";
  }

  async function markPaid() {
    if (!payingOccurrence || !actualAmount) return;
    if (isServerMode()) {
      await apiRequest(`/v1/payments/occurrences/${payingOccurrence.id}/paid`, {
        method: "POST",
        body: JSON.stringify({ actualAmount: String(actualAmount), ...(sourcePocketId ? { sourcePocketId } : {}) }),
      });
      await load();
    } else {
      payments = payments.map((payment) => ({ ...payment, occurrences: payment.occurrences.map((item) => item.id === payingOccurrence?.id ? { ...item, status: "paid", actualAmount, sourcePocketId, paidAt: new Date().toISOString() } : item) }));
      persistLocal();
    }
    payingOccurrence = null;
  }

  function urgency(date: string) {
    const days = Math.ceil((new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86_400_000);
    return days < 0 ? "overdue" : days <= 3 ? "urgent" : days <= 10 ? "soon" : "future";
  }
</script>

<div class="page payments-page">
  <header class="page-header"><div><span class="eyebrow">Compromisos y vencimientos</span><h1>Pagos</h1><p>Programa servicios, cuotas y obligaciones; guarda el enlace, la referencia y el bolsillo que los cubre.</p></div><button class="primary-button" onclick={() => openForm()}>＋ Nuevo pago</button></header>
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  <section class="payment-grid">
    {#each payments as payment}
      <article class="panel payment-card" class:private={payment.visibility === "private"}>
        <header><div><span class="privacy">{payment.visibility === "private" ? "Solo yo" : "Compartido"}</span><h2>{payment.name}</h2><small>{payment.type} · {payment.recurrence}</small></div><strong>{currency(payment.estimatedAmount ?? 0, payment.currency)}</strong></header>
        {#if payment.totalAmount}<div class="payment-total"><span>Compromiso total</span><b>{currency(payment.totalAmount, payment.currency)}</b></div>{/if}
        {#each payment.occurrences.filter((item) => item.status !== "paid").slice(0, 2) as occurrence}
          <div class={`payment-due ${urgency(occurrence.dueDate)}`}><span><small>Próximo vencimiento</small><b>{occurrence.dueDate}</b></span><button onclick={() => openPaid(occurrence)}>Marcar pagado</button></div>
        {/each}
        <div class="payment-links">{#if payment.paymentUrl}<a href={payment.paymentUrl} target="_blank" rel="noreferrer">Ir a pagar ↗</a>{/if}{#if payment.reference}<span>Ref. {payment.reference}</span>{/if}</div>
        <div class="row-actions"><button onclick={() => addDate(payment)}>＋ Fecha</button><button onclick={() => openForm(payment)}>Editar</button><button class="danger-text" onclick={() => archive(payment)}>Archivar</button></div>
      </article>
    {/each}
    {#if payments.length === 0}<div class="empty-state panel"><strong>Aún no hay pagos programados</strong><p>Crea uno para activar vencimientos, distintivo de la PWA y recordatorios.</p></div>{/if}
  </section>
</div>

{#if showForm}<div class="modal-backdrop" role="presentation"><div class="quick-entry payment-form" role="dialog" aria-modal="true"><header><div><span class="eyebrow">Calendario flexible</span><h2>{editing ? "Editar pago" : "Nuevo pago"}</h2></div><button class="icon-button" onclick={() => (showForm = false)}>×</button></header><div class="form-grid"><label>Nombre<input bind:value={name} placeholder="Ej. Energía" /></label><label>Tipo<select bind:value={type}><option value="service">Servicio</option><option value="debt">Deuda o crédito</option><option value="rent">Arriendo</option><option value="tax">Impuesto</option><option value="insurance">Seguro</option><option value="subscription">Suscripción</option><option value="other">Otro</option></select></label><label>Valor aproximado<input type="number" min="1" bind:value={amount} /></label><label>Total del compromiso (opcional)<input type="number" min="1" bind:value={totalAmount} /></label><label>Frecuencia<select bind:value={recurrence}><option value="once">Una vez</option><option value="weekly">Semanal</option><option value="biweekly">Quincenal</option><option value="monthly">Mensual</option><option value="quarterly">Trimestral</option><option value="annual">Anual</option><option value="custom">Personalizada</option></select></label><label>Próxima fecha<input type="date" bind:value={nextDueDate} /></label><label>Enlace de pago<input type="url" bind:value={paymentUrl} placeholder="https://…" /></label><label>Referencia<input bind:value={reference} /></label><label class="wide-field">Notas<input bind:value={notes} /></label><label class="switch-row wide-field"><input type="checkbox" bind:checked={privatePayment} /><span>Solo yo</span></label></div>{#if error}<p class="form-error">{error}</p>{/if}<button class="primary-button" disabled={saving} onclick={save}>{saving ? "Guardando…" : "Guardar pago"}</button></div></div>{/if}

{#if payingOccurrence}<div class="modal-backdrop" role="presentation"><div class="quick-entry" role="dialog" aria-modal="true"><header><h2>Confirmar pago</h2><button class="icon-button" onclick={() => (payingOccurrence = null)}>×</button></header><label>Valor real<input type="number" min="1" bind:value={actualAmount} /></label><label>Salió del bolsillo<select bind:value={sourcePocketId}><option value="">Sin conciliar todavía</option>{#each $financeData.pockets as pocket}<option value={pocket.id}>{pocket.name}</option>{/each}</select><small>Esto deja trazabilidad de planificación; registra también el movimiento real para conciliar con Firefly.</small></label><button class="primary-button" onclick={markPaid}>Guardar confirmación</button></div></div>{/if}
