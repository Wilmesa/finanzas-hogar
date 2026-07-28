<script lang="ts">
  import { apiRequest } from "$lib/api";
  import { currency } from "$lib/demo";
  import { financeData } from "$lib/finance-store";
  import { isServerMode } from "$lib/auth";
  import { onMount } from "svelte";

  type Simulator = "goal" | "cdt" | "debt" | "investment" | "property";
  let simulator = $state<Simulator>("goal");
  let target = $state(80_000_000);
  let currentSaved = $state(38_600_000);
  let contribution = $state(1_800_000);
  let principal = $state(10_000_000);
  let annualRate = $state(10.5);
  let days = $state(180);
  let debtBalance = $state(25_000_000);
  let debtRate = $state(18);
  let debtPayment = $state(1_200_000);
  let investmentInitial = $state(5_000_000);
  let investmentMonthly = $state(500_000);
  let investmentRate = $state(8);
  let investmentYears = $state(5);
  let propertyPrice = $state(420_000_000);
  let downPaymentPercent = $state(30);
  let mortgageRate = $state(12);
  let mortgageYears = $state(15);
  let scenarioName = $state("");
  let saved = $state<Array<{
    id: string;
    name: string;
    kind: string;
    currency: string;
    status: "draft" | "converted";
    convertedEntityType?: string;
    createdAt: string;
  }>>([]);
  let saving = $state(false);
  let message = $state("");
  let error = $state("");

  const goalMonths = $derived(
    Math.max(0, Math.ceil((target - currentSaved) / Math.max(1, contribution))),
  );
  const cdtGrossInterest = $derived(
    principal * (Math.pow(1 + annualRate / 100, days / 365) - 1),
  );
  const cdtWithholding = $derived(cdtGrossInterest * 0.04);
  const cdtMaturity = $derived(principal + cdtGrossInterest - cdtWithholding);
  const debtResult = $derived.by(() => {
    let balance = debtBalance;
    const monthlyRate = debtRate / 100 / 12;
    let interest = 0;
    let months = 0;
    while (balance > 0.01 && months < 600) {
      const monthInterest = balance * monthlyRate;
      if (debtPayment <= monthInterest) return { months: Infinity, interest: Infinity };
      balance -= Math.min(balance, debtPayment - monthInterest);
      interest += monthInterest;
      months += 1;
    }
    return { months, interest };
  });
  const investmentValue = $derived.by(() => {
    const monthlyRate = Math.pow(1 + investmentRate / 100, 1 / 12) - 1;
    let value = investmentInitial;
    for (let month = 0; month < investmentYears * 12; month += 1) {
      value = value * (1 + monthlyRate) + investmentMonthly;
    }
    return value;
  });
  const downPayment = $derived(propertyPrice * (downPaymentPercent / 100));
  const propertySavingMonths = $derived(
    Math.max(0, Math.ceil((downPayment - currentSaved) / Math.max(1, contribution))),
  );
  const mortgagePrincipal = $derived(propertyPrice - downPayment);
  const mortgagePayment = $derived.by(() => {
    const rate = mortgageRate / 100 / 12;
    const periods = mortgageYears * 12;
    return rate === 0
      ? mortgagePrincipal / periods
      : (mortgagePrincipal * rate * Math.pow(1 + rate, periods)) /
          (Math.pow(1 + rate, periods) - 1);
  });

  const options: Array<{ id: Simulator; icon: string; title: string; text: string }> = [
    { id: "goal", icon: "◎", title: "Meta", text: "Fecha según tu capacidad" },
    { id: "cdt", icon: "▤", title: "CDT", text: "Vencimiento neto" },
    { id: "debt", icon: "↘", title: "Deuda", text: "Tiempo e intereses" },
    { id: "investment", icon: "⌁", title: "Inversión", text: "Escenario de crecimiento" },
    { id: "property", icon: "⌂", title: "Vivienda", text: "Cuota inicial y crédito" },
  ];

  onMount(loadSaved);

  async function loadSaved() {
    if (!isServerMode()) return;
    try {
      saved = await apiRequest<typeof saved>("/v1/simulations");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible cargar escenarios";
    }
  }

  function simulationPayload() {
    const currencyCode = $financeData.settings.baseCurrency;
    const startDate = new Date().toISOString().slice(0, 10);
    if (simulator === "goal") return {
      kind: "savings",
      assumptions: {
        currentAmount: String(currentSaved),
        targetAmount: String(target),
        contributionAmount: String(contribution),
        startDate,
        frequency: "monthly",
      },
    };
    if (simulator === "cdt") return {
      kind: "cdt",
      assumptions: {
        principal: String(principal),
        effectiveAnnualRate: String(annualRate / 100),
        days,
        withholdingRate: "0.04",
        fees: "0",
      },
    };
    if (simulator === "debt") return {
      kind: "debt",
      assumptions: {
        principal: String(debtBalance),
        annualRate: String(debtRate / 100),
        monthlyPayment: String(debtPayment),
        extraPayment: "0",
        monthlyFees: "0",
      },
    };
    if (simulator === "investment") return {
      kind: "investment",
      assumptions: {
        initialAmount: String(investmentInitial),
        monthlyContribution: String(investmentMonthly),
        annualReturn: String(investmentRate / 100),
        annualInflation: "0.04",
        years: investmentYears,
      },
    };
    return {
      kind: "real_estate",
      assumptions: {
        propertyPrice: String(propertyPrice),
        targetAmount: String(downPayment),
        downPaymentRate: String(downPaymentPercent / 100),
        currentSavings: String(currentSaved),
        monthlySavings: String(contribution),
        annualMortgageRate: String(mortgageRate / 100),
        mortgageYears,
      },
    };
  }

  async function saveScenario() {
    if (!isServerMode()) {
      error = "Conecta OKLE al servidor para guardar y convertir escenarios.";
      return;
    }
    saving = true;
    error = "";
    try {
      const payload = simulationPayload();
      await apiRequest("/v1/simulations", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          name: scenarioName.trim() || options.find((item) => item.id === simulator)?.title,
          visibility: "household",
          currency: $financeData.settings.baseCurrency,
        }),
      });
      scenarioName = "";
      message = "Escenario guardado con sus supuestos y resultado determinístico.";
      await loadSaved();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible guardar";
    } finally {
      saving = false;
    }
  }

  async function convertScenario(item: (typeof saved)[number]) {
    const targetType = item.kind === "debt" ? "scheduled_payment" : "pocket";
    const name = prompt(
      targetType === "scheduled_payment"
        ? "Nombre del pago programado"
        : "Nombre del bolsillo",
      item.name,
    );
    if (!name) return;
    try {
      await apiRequest(`/v1/simulations/${item.id}/convert`, {
        method: "POST",
        body: JSON.stringify({
          target: targetType,
          name,
          startDate: new Date().toISOString().slice(0, 10),
          recurrence: "monthly",
        }),
      });
      message =
        targetType === "scheduled_payment"
          ? "La proyección ahora es un pago programado y una deuda trazable."
          : "La proyección ahora es un bolsillo accionable.";
      await loadSaved();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible convertir";
    }
  }

  async function archiveScenario(item: (typeof saved)[number]) {
    await apiRequest(`/v1/simulations/${item.id}`, { method: "DELETE" });
    await loadSaved();
  }
</script>

<div class="page">
  <header class="page-header"><div><span class="eyebrow">Decisiones con perspectiva</span><h1>Simuladores financieros</h1><p>Simula escenarios sin alterar tus movimientos reales.</p></div><a class="secondary-link" href="/planning">← Volver al plan</a></header>
  <section class="future-hero">
    <div><span class="eyebrow">Patrimonio proyectado</span><strong>{currency(investmentValue)}</strong><p>Escenario ilustrativo a {investmentYears} años; no es una garantía.</p></div>
    <div class="mini-chart" aria-label="Proyección creciente"><i style="height:25%"></i><i style="height:34%"></i><i style="height:46%"></i><i style="height:62%"></i><i style="height:84%"></i><i style="height:100%"></i></div>
  </section>

  <div class="simulator-picker" aria-label="Seleccionar simulador">
    {#each options as option}
      <button class:active={simulator === option.id} onclick={() => (simulator = option.id)}><span>{option.icon}</span><strong>{option.title}</strong><small>{option.text}</small></button>
    {/each}
  </div>

  <section class="panel calculator-panel">
    {#if simulator === "goal"}
      <div class="calculator-copy"><span class="eyebrow">Meta por capacidad</span><h2>¿Cuándo llego?</h2><p>Indica cuánto necesitas y cuál es tu límite mensual.</p></div>
      <div class="calculator-form"><label>Meta total<input type="number" bind:value={target} min="1" /></label><label>Ya tienes<input type="number" bind:value={currentSaved} min="0" /></label><label>Aporte mensual máximo<input type="number" bind:value={contribution} min="1" /></label></div>
      <div class="result wide"><span>Tiempo estimado</span><strong>{goalMonths} meses</strong><small>Faltan {currency(Math.max(0, target - currentSaved))}; último aporte puede ser menor.</small></div>
    {:else if simulator === "cdt"}
      <div class="calculator-copy"><span class="eyebrow">Rendimiento fijo</span><h2>Proyección de CDT</h2><p>Tasa introducida por ti; confirma siempre la oferta de la entidad.</p></div>
      <div class="calculator-form"><label>Capital<input type="number" bind:value={principal} min="1" /></label><label>Tasa efectiva anual (%)<input type="number" bind:value={annualRate} min="0" step="0.1" /></label><label>Duración en días<input type="number" bind:value={days} min="1" /></label></div>
      <div class="result wide"><span>Valor neto al vencimiento</span><strong>{currency(cdtMaturity)}</strong><small>Interés bruto {currency(cdtGrossInterest)} · retención ilustrativa 4 %: {currency(cdtWithholding)}</small></div>
    {:else if simulator === "debt"}
      <div class="calculator-copy"><span class="eyebrow">Plan de salida</span><h2>Proyección de deuda</h2><p>La cuota debe superar los intereses del mes.</p></div>
      <div class="calculator-form"><label>Saldo de la deuda<input type="number" bind:value={debtBalance} min="1" /></label><label>Tasa efectiva anual aproximada (%)<input type="number" bind:value={debtRate} min="0" step="0.1" /></label><label>Pago mensual total<input type="number" bind:value={debtPayment} min="1" /></label></div>
      <div class="result wide"><span>Tiempo para terminar</span><strong>{Number.isFinite(debtResult.months) ? `${debtResult.months} meses` : "La cuota no alcanza"}</strong><small>{Number.isFinite(debtResult.interest) ? `Intereses aproximados: ${currency(debtResult.interest)}` : "Aumenta el pago por encima de los intereses mensuales."}</small></div>
    {:else if simulator === "investment"}
      <div class="calculator-copy"><span class="eyebrow">Escenario, no promesa</span><h2>Proyección de inversión</h2><p>Usa una rentabilidad prudente y compara contra inflación y comisiones.</p></div>
      <div class="calculator-form"><label>Capital inicial<input type="number" bind:value={investmentInitial} min="0" /></label><label>Aporte mensual<input type="number" bind:value={investmentMonthly} min="0" /></label><label>Rentabilidad anual (%)<input type="number" bind:value={investmentRate} step="0.1" /></label><label>Horizonte en años<input type="number" bind:value={investmentYears} min="1" max="50" /></label></div>
      <div class="result wide"><span>Valor nominal estimado</span><strong>{currency(investmentValue)}</strong><small>Aportes totales: {currency(investmentInitial + investmentMonthly * investmentYears * 12)}.</small></div>
    {:else}
      <div class="calculator-copy"><span class="eyebrow">Compra inmobiliaria</span><h2>Cuota inicial y crédito</h2><p>No incluye seguros, escrituración, impuestos ni variación de tasas.</p></div>
      <div class="calculator-form"><label>Precio del inmueble<input type="number" bind:value={propertyPrice} min="1" /></label><label>Cuota inicial (%)<input type="number" bind:value={downPaymentPercent} min="0" max="100" /></label><label>Ahorro actual<input type="number" bind:value={currentSaved} min="0" /></label><label>Ahorro mensual<input type="number" bind:value={contribution} min="1" /></label><label>Tasa anual del crédito (%)<input type="number" bind:value={mortgageRate} min="0" step="0.1" /></label><label>Plazo del crédito (años)<input type="number" bind:value={mortgageYears} min="1" max="30" /></label></div>
      <div class="result wide"><span>Cuota inicial en {propertySavingMonths} meses</span><strong>{currency(downPayment)}</strong><small>Crédito estimado {currency(mortgagePrincipal)} · cuota base aproximada {currency(mortgagePayment)} al mes.</small></div>
    {/if}
  </section>
  <section class="panel scenario-actions">
    <div>
      <span class="eyebrow">De hipótesis a decisión</span>
      <h2>Guardar este escenario</h2>
      <p>El backend recalculará el resultado y conservará los supuestos usados.</p>
    </div>
    <label>Nombre del escenario<input bind:value={scenarioName} placeholder="Ej. Salir de tarjeta en 18 meses" /></label>
    <button class="primary-button" disabled={saving} onclick={saveScenario}>{saving ? "Guardando…" : "Guardar escenario"}</button>
  </section>
  {#if message}<p class="success-message" role="status">{message}</p>{/if}
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  {#if saved.length}
    <section class="section-block">
      <header class="section-heading"><div><span class="eyebrow">Historial de decisiones</span><h2>Escenarios guardados</h2></div></header>
      <div class="payment-grid">
        {#each saved as item}
          <article class="panel payment-card">
            <header><div><span class="privacy">{item.kind}</span><h3>{item.name}</h3><small>{new Date(item.createdAt).toLocaleDateString("es-CO")}</small></div><strong>{item.status === "converted" ? "Convertido" : "Hipótesis"}</strong></header>
            <div class="row-actions">
              {#if item.status !== "converted"}<button class="primary-button" onclick={() => convertScenario(item)}>{item.kind === "debt" ? "Crear pago y deuda" : "Crear bolsillo"}</button>{/if}
              <button class="danger-text" onclick={() => archiveScenario(item)}>Archivar</button>
            </div>
          </article>
        {/each}
      </div>
    </section>
  {/if}
  <p class="educational-note">Todas las proyecciones son educativas y dependen de los supuestos introducidos. No constituyen asesoría ni garantía de rentabilidad.</p>
</div>
