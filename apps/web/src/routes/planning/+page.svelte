<script lang="ts">
  import { currency } from "$lib/demo";
  import {
    createExpectedIncome,
    createFundingPlan,
    createIncomeSource,
    financeData,
    loadPlanHistory,
    recordPlanReview,
  } from "$lib/finance-store";
  import type { FundingPlanView } from "$lib/types";

  type Creator = "source" | "income" | "plan" | null;
  type AllocationDraft = {
    pocketId: string;
    mode: "fixed" | "percentage" | "remainder";
    value: number | undefined;
    rationale: string;
  };

  let creator = $state<Creator>(null);
  let saving = $state(false);
  let error = $state("");
  let success = $state("");
  let expandedPlanId = $state<string | null>(null);
  let reviewNote = $state("");

  let sourceName = $state("");
  let sourceKind = $state("salary");
  let sourceRecurrence = $state("monthly");
  let sourceAmount = $state<number | undefined>();
  let sourceDescription = $state("");
  let sourcePrivate = $state(false);

  let incomeSourceId = $state("source-bonus");
  let incomeDate = $state("2026-12-15");
  let incomeAmount = $state<number | undefined>(6_000_000);
  let incomeProbability = $state(90);
  let incomeReason = $state("");
  let incomeNotes = $state("");
  let incomeConfirmed = $state(false);
  let incomeRepeatUntil = $state("");

  let planTitle = $state("");
  let planPurpose = $state("");
  let planHorizon = $state<FundingPlanView["horizon"]>("short_term");
  let planPrivate = $state(false);
  let planStatus = $state<"draft" | "agreed" | "active">("agreed");
  let planIncomeId = $state("income-bonus-december");
  let planTargetDate = $state("2026-12-15");
  let decisionNote = $state("");
  let allocationDrafts = $state<AllocationDraft[]>([
    { pocketId: "home", mode: "fixed", value: 4_000_000, rationale: "" },
    { pocketId: "daily", mode: "remainder", value: undefined, rationale: "" },
  ]);

  const sharedExpected = $derived(
    $financeData.expectedIncomes.reduce(
      (sum, item) =>
        item.status === "cancelled" ? sum : sum + item.expectedAmount * item.probability,
      0,
    ),
  );
  const unplannedIncomes = $derived(
    $financeData.expectedIncomes.filter(
      (income) =>
        !$financeData.fundingPlans.some((plan) =>
          plan.allocations.some(
            (allocation) => allocation.expectedIncomeId === income.id,
          ),
        ),
    ),
  );
  const selectedIncome = $derived(
    unplannedIncomes.find((item) => item.id === planIncomeId) ??
      unplannedIncomes[0],
  );
  const selectedIncomeSource = $derived(
    $financeData.incomeSources.find((item) => item.id === incomeSourceId),
  );
  const planVisibility = $derived(planPrivate ? "private" : "household");
  const compatiblePockets = $derived(
    $financeData.pockets.filter(
      (pocket) =>
        pocket.visibility === planVisibility &&
        (!selectedIncome || pocket.currency === selectedIncome.currency),
    ),
  );
  const preview = $derived.by(() => {
    const total = selectedIncome?.expectedAmount ?? 0;
    let remaining = total;
    let allocated = 0;
    const rows = allocationDrafts.map((draft) => {
      const amount =
        draft.mode === "fixed"
          ? (draft.value ?? 0)
          : draft.mode === "percentage"
            ? total * ((draft.value ?? 0) / 100)
            : Math.max(0, remaining);
      allocated += amount;
      remaining -= amount;
      return { ...draft, amount };
    });
    return {
      rows,
      allocated,
      unassigned: Math.max(0, total - allocated),
      overallocated: Math.max(0, allocated - total),
    };
  });

  const bucketLabels: Record<string, string> = {
    today: "Hoy",
    this_week: "Esta semana",
    this_month: "Este mes",
    next_90_days: "Próximos 90 días",
    future: "Más adelante",
  };

  $effect(() => {
    if (
      unplannedIncomes.length > 0 &&
      !unplannedIncomes.some((income) => income.id === planIncomeId)
    ) {
      planIncomeId = unplannedIncomes[0]?.id ?? "";
    }
  });

  function openCreator(value: Exclude<Creator, null>) {
    creator = value;
    error = "";
    success = "";
  }

  async function saveSource() {
    if (!sourceName.trim()) return (error = "Dale un nombre a la fuente.");
    saving = true;
    error = "";
    try {
      const id = await createIncomeSource({
        name: sourceName.trim(),
        kind: sourceKind,
        visibility: sourcePrivate ? "private" : "household",
        currency: "COP",
        recurrence: sourceRecurrence,
        ...(sourceAmount ? { defaultAmount: sourceAmount } : {}),
        ...(sourceDescription.trim()
          ? { description: sourceDescription.trim() }
          : {}),
      });
      incomeSourceId = id;
      sourceName = "";
      success = "Fuente creada. Ahora registra cuándo esperas recibirla.";
      creator = "income";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible crear la fuente";
    } finally {
      saving = false;
    }
  }

  async function saveIncome() {
    const source = $financeData.incomeSources.find((item) => item.id === incomeSourceId);
    if (!source || !incomeAmount || !incomeReason.trim()) {
      return (error = "Completa fuente, cantidad y motivo del ingreso.");
    }
    saving = true;
    error = "";
    try {
      const id = await createExpectedIncome({
        sourceId: source.id,
        expectedDate: incomeDate,
        expectedAmount: incomeAmount,
        probability: incomeProbability / 100,
        status: incomeConfirmed ? "confirmed" : "planned",
        reason: incomeReason.trim(),
        ...(incomeNotes.trim() ? { notes: incomeNotes.trim() } : {}),
        ...(incomeRepeatUntil &&
        selectedIncomeSource &&
        !["once", "custom"].includes(selectedIncomeSource.recurrence)
          ? { repeatUntil: incomeRepeatUntil }
          : {}),
      });
      planIncomeId = id;
      planPrivate = source.visibility === "private";
      planTargetDate = incomeDate;
      success = "Ingreso esperado registrado. Ya puedes acordar su destino.";
      creator = "plan";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible guardar el ingreso";
    } finally {
      saving = false;
    }
  }

  async function savePlan() {
    const income = selectedIncome;
    if (!income || !planTitle.trim() || !planPurpose.trim() || !decisionNote.trim()) {
      return (error = "Completa ingreso, nombre, propósito y memoria de la decisión.");
    }
    if (preview.overallocated > 0) {
      return (error = "Las asignaciones superan el ingreso esperado.");
    }
    if (allocationDrafts.some((item) => !item.pocketId || !item.rationale.trim())) {
      return (error = "Cada destino necesita bolsillo y motivo.");
    }
    saving = true;
    error = "";
    try {
      await createFundingPlan({
        title: planTitle.trim(),
        purpose: planPurpose.trim(),
        horizon: planHorizon,
        visibility: planVisibility,
        currency: income.currency,
        status: planStatus,
        startDate: new Date().toISOString().slice(0, 10),
        ...(planTargetDate ? { targetDate: planTargetDate } : {}),
        decisionNote: decisionNote.trim(),
        allocations: allocationDrafts.map((allocation, index) => ({
          expectedIncomeId: income.id,
          pocketId: allocation.pocketId,
          mode: allocation.mode,
          ...(allocation.mode === "fixed"
            ? { value: allocation.value ?? 0 }
            : allocation.mode === "percentage"
              ? { value: (allocation.value ?? 0) / 100 }
              : {}),
          priority: index + 1,
          rationale: allocation.rationale.trim(),
        })),
      });
      creator = null;
      planTitle = "";
      planPurpose = "";
      decisionNote = "";
      success = "Plan guardado con su primera revisión inmutable.";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible guardar el plan";
    } finally {
      saving = false;
    }
  }

  function addAllocation() {
    allocationDrafts.push({
      pocketId: compatiblePockets[0]?.id ?? "",
      mode: "fixed",
      value: undefined,
      rationale: "",
    });
  }

  async function toggleHistory(plan: FundingPlanView) {
    if (expandedPlanId === plan.id) {
      expandedPlanId = null;
      return;
    }
    expandedPlanId = plan.id;
    try {
      await loadPlanHistory(plan.id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible consultar la historia";
    }
  }

  async function saveReview(plan: FundingPlanView) {
    saving = true;
    error = "";
    try {
      await recordPlanReview(plan.id, reviewNote, plan.status === "draft" ? "agreed" : undefined);
      reviewNote = "";
      success = "La revisión quedó registrada sin borrar la decisión anterior.";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible guardar la revisión";
    } finally {
      saving = false;
    }
  }
</script>

<div class="page planning-page">
  <header class="page-header">
    <div>
      <span class="eyebrow">Día, semana, mes y futuro</span>
      <h1>Plan financiero</h1>
      <p>Recuerda qué ingreso llegará, para qué existe y qué decidieron hacer con él.</p>
    </div>
    <a class="secondary-link" href="/future">Abrir simuladores →</a>
  </header>

  <section class="planning-hero">
    <div>
      <span class="eyebrow">Ingresos esperados ponderados</span>
      <strong>{currency(sharedExpected)}</strong>
      <p>No están disponibles todavía. Se convierten en dinero real únicamente al conciliarlos.</p>
    </div>
    <div class="planning-actions">
      <button onclick={() => openCreator("source")}>＋ Fuente</button>
      <button onclick={() => openCreator("income")}>＋ Ingreso esperado</button>
      <button class="accent" onclick={() => openCreator("plan")}>＋ Acordar destino</button>
    </div>
  </section>

  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  {#if success}<p class="success-message" role="status">{success}</p>{/if}

  {#if creator}
    <section class="panel planning-creator">
      <header>
        <div><span class="eyebrow">Paso guiado</span><h2>{creator === "source" ? "Definir fuente" : creator === "income" ? "Programar ingreso" : "Guardar el acuerdo"}</h2></div>
        <button class="icon-button" aria-label="Cerrar" onclick={() => (creator = null)}>×</button>
      </header>

      {#if creator === "source"}
        <div class="form-grid planning-form">
          <label>Nombre<input bind:value={sourceName} placeholder="Ej. Arriendo apartamento" /></label>
          <label>Tipo<select bind:value={sourceKind}><option value="salary">Salario</option><option value="bonus_midyear">Prima mitad de año</option><option value="bonus_endyear">Prima fin de año</option><option value="rent">Alquiler</option><option value="investment_income">Rendimiento o dividendo</option><option value="freelance">Trabajo independiente</option><option value="business">Negocio</option><option value="pension">Pensión</option><option value="windfall">Ingreso extraordinario</option><option value="other">Otro</option></select></label>
          <label>Frecuencia<select bind:value={sourceRecurrence}><option value="once">Una vez</option><option value="weekly">Semanal</option><option value="biweekly">Quincenal</option><option value="monthly">Mensual</option><option value="quarterly">Trimestral</option><option value="semiannual">Semestral</option><option value="annual">Anual</option><option value="custom">Personalizada</option></select></label>
          <label>Valor habitual, si se conoce<input type="number" min="0" bind:value={sourceAmount} /></label>
          <label class="wide-field">¿Qué representa?<input bind:value={sourceDescription} placeholder="Origen, condiciones o contexto" /></label>
          <label class="switch-row wide-field"><input type="checkbox" bind:checked={sourcePrivate} /><span>Solo yo</span><small>Por defecto se comparte con la pareja.</small></label>
        </div>
        <button class="primary-button" disabled={saving} onclick={saveSource}>Guardar fuente</button>
      {:else if creator === "income"}
        <div class="form-grid planning-form">
          <label>Fuente<select bind:value={incomeSourceId}>{#each $financeData.incomeSources as source}<option value={source.id}>{source.name} · {source.visibility === "private" ? "Solo yo" : "Compartida"}</option>{/each}</select></label>
          <label>Fecha esperada<input type="date" bind:value={incomeDate} /></label>
          <label>Cantidad esperada<input type="number" min="1" bind:value={incomeAmount} /></label>
          <label>Confianza: {incomeProbability}%<input type="range" min="0" max="100" step="5" bind:value={incomeProbability} /></label>
          {#if selectedIncomeSource && !["once", "custom"].includes(selectedIncomeSource.recurrence)}<label>Repetir según la fuente hasta<input type="date" min={incomeDate} bind:value={incomeRepeatUntil} /><small>Se creará una ocurrencia independiente por periodo.</small></label>{/if}
          <label class="wide-field">Por qué llegará<input bind:value={incomeReason} placeholder="Ej. prima legal correspondiente al segundo semestre" /></label>
          <label class="wide-field">Recordatorio o condición<input bind:value={incomeNotes} placeholder="Ej. confirmar desprendible antes de transferir" /></label>
          <label class="switch-row wide-field"><input type="checkbox" bind:checked={incomeConfirmed} /><span>Valor ya confirmado</span><small>Confirmado no significa recibido.</small></label>
        </div>
        <button class="primary-button" disabled={saving} onclick={saveIncome}>Guardar ingreso esperado</button>
      {:else}
        <div class="form-grid planning-form">
          <label>Ingreso a distribuir<select bind:value={planIncomeId}>{#each unplannedIncomes as income}<option value={income.id}>{income.sourceName} · {currency(income.expectedAmount, income.currency)} · {income.expectedDate}</option>{/each}</select>{#if unplannedIncomes.length === 0}<small>Todos los ingresos ya tienen acuerdo. Crea otro ingreso o revisa el plan existente.</small>{/if}</label>
          <label>Horizonte<select bind:value={planHorizon}><option value="daily">Día a día</option><option value="weekly">Semana</option><option value="monthly">Mes</option><option value="short_term">Corto plazo</option><option value="long_term">Largo plazo</option></select></label>
          <label>Nombre del acuerdo<input bind:value={planTitle} placeholder="Ej. Prima diciembre 2026" /></label>
          <label>Estado<select bind:value={planStatus}><option value="draft">Borrador</option><option value="agreed">Acordado</option><option value="active">Activo</option></select></label>
          <label class="wide-field">Propósito<input bind:value={planPurpose} placeholder="Qué quieren conseguir con esta decisión" /></label>
          <label>Fecha objetivo<input type="date" bind:value={planTargetDate} /></label>
          <label class="switch-row"><input type="checkbox" bind:checked={planPrivate} /><span>Plan solo mío</span><small>Exige fuente y bolsillos privados.</small></label>
        </div>

        <div class="allocation-editor">
          <div class="section-heading"><div><span class="eyebrow">Asignaciones</span><h2>¿A dónde irá?</h2></div><button class="text-button" onclick={addAllocation}>＋ Otro destino</button></div>
          {#each allocationDrafts as allocation, index}
            <div class="allocation-line">
              <label>Bolsillo<select bind:value={allocation.pocketId}>{#each compatiblePockets as pocket}<option value={pocket.id}>{pocket.name}</option>{/each}</select></label>
              <label>Regla<select bind:value={allocation.mode}><option value="fixed">Cantidad fija</option><option value="percentage">Porcentaje</option><option value="remainder">Remanente</option></select></label>
              {#if allocation.mode !== "remainder"}<label>{allocation.mode === "percentage" ? "Porcentaje (%)" : "Cantidad"}<input type="number" min="0" bind:value={allocation.value} /></label>{/if}
              <label class="allocation-reason">¿Por qué?<input bind:value={allocation.rationale} placeholder="Motivo acordado" /></label>
              {#if allocationDrafts.length > 1}<button class="remove-line" aria-label="Eliminar destino" onclick={() => allocationDrafts.splice(index, 1)}>×</button>{/if}
              <strong class="allocation-preview-value">{currency(preview.rows[index]?.amount ?? 0, selectedIncome?.currency ?? "COP")}</strong>
            </div>
          {/each}
          <div class:danger={preview.overallocated > 0} class="plan-balance"><span>Asignado <b>{currency(preview.allocated, selectedIncome?.currency ?? "COP")}</b></span><span>Sin decidir <b>{currency(preview.unassigned, selectedIncome?.currency ?? "COP")}</b></span>{#if preview.overallocated > 0}<span>Exceso <b>{currency(preview.overallocated, selectedIncome?.currency ?? "COP")}</b></span>{/if}</div>
        </div>
        <label>Memoria de la decisión<textarea bind:value={decisionNote} placeholder="Ej. El 20 de julio acordamos priorizar la cuota inicial porque…"></textarea></label>
        <button class="primary-button" disabled={saving || compatiblePockets.length === 0} onclick={savePlan}>Guardar acuerdo y versión 1</button>
      {/if}
    </section>
  {/if}

  <section class="section-block">
    <header class="section-heading"><div><span class="eyebrow">Calendario de liquidez</span><h2>Lo que viene</h2></div></header>
    <div class="income-timeline">
      {#each $financeData.expectedIncomes as income}
        <article class="income-card">
          <div class="timeline-dot"></div>
          <div><span class="eyebrow">{bucketLabels[income.timeBucket]} · {income.expectedDate}</span><h3>{income.sourceName}</h3><p>{income.reason}</p>{#if income.notes}<small>{income.notes}</small>{/if}</div>
          <div class="income-number"><strong>{currency(income.expectedAmount, income.currency)}</strong><span class={`status ${income.status}`}>{income.status === "confirmed" ? "Confirmado" : income.status === "received" ? "Recibido" : "Estimado"} · {Math.round(income.probability * 100)}%</span></div>
        </article>
      {/each}
      {#if $financeData.expectedIncomes.length === 0}<p class="empty-state">Aún no hay ingresos futuros registrados.</p>{/if}
    </div>
  </section>

  <section class="section-block">
    <header class="section-heading"><div><span class="eyebrow">Memoria financiera</span><h2>Planes y acuerdos</h2></div></header>
    <div class="plan-grid">
      {#each $financeData.fundingPlans as plan}
        <article class="plan-card">
          <header><div><span class="privacy">{plan.visibility === "private" ? "Solo yo" : "Compartido"}</span><span class={`status ${plan.status}`}>{plan.status}</span></div><small>Versión {plan.version}</small></header>
          <h3>{plan.title}</h3><p>{plan.purpose}</p>
          <div class="plan-destinations">
            {#each plan.allocations as allocation}<div><span>{allocation.sourceName} → <b>{allocation.pocketName}</b></span><strong>{allocation.mode === "fixed" ? currency(allocation.value ?? 0, plan.currency) : allocation.mode === "percentage" ? `${Math.round((allocation.value ?? 0) * 100)} %` : "Remanente"}</strong><small>{allocation.rationale}</small></div>{/each}
          </div>
          <button class="secondary-button" onclick={() => toggleHistory(plan)}>{expandedPlanId === plan.id ? "Ocultar historia" : "Consultar decisiones"}</button>
          {#if expandedPlanId === plan.id}
            <div class="decision-history">
              {#each plan.revisions as revision}<div><span>v{revision.version}</span><p>{revision.decisionNote}</p><small>{revision.actorName ?? "Miembro"} · {new Date(revision.createdAt).toLocaleString("es-CO")}</small></div>{/each}
              <label>Nueva revisión<textarea bind:value={reviewNote} placeholder="Qué confirmaron o cambiaron y por qué"></textarea></label>
              <button class="primary-button" disabled={saving} onclick={() => saveReview(plan)}>Registrar nueva versión</button>
            </div>
          {/if}
        </article>
      {/each}
      {#if $financeData.fundingPlans.length === 0}<p class="empty-state">Cuando acuerden el destino de un ingreso, quedará registrado aquí.</p>{/if}
    </div>
  </section>

  <p class="educational-note">Principio operativo: planear no aumenta el saldo. La aplicación separa ingresos estimados, confirmados y recibidos; solo el último puede convertirse en movimiento real y financiar bolsillos.</p>
</div>
