<script lang="ts">
  import { apiRequest } from "$lib/api";
  import { isServerMode } from "$lib/auth";
  import { currency } from "$lib/demo";
  import { financeData } from "$lib/finance-store";
  import { onMount } from "svelte";

  type Investment = { id: string; kind: string; name: string; institution?: string; currency: string; principal: number; openedAt: string; maturityDate?: string; annualRate?: number; expectedGrossGain?: number; feesAndTaxes?: number; expectedNetGain?: number; ticker?: string; units?: number; purchasePrice?: number; currentPrice?: number; priceAsOf?: string; sourceUrl?: string; visibility: string };
  type Property = { id: string; name: string; type: string; currency: string; purchaseValue?: number; currentEstimatedValue: number; locationSector?: string; annualAppreciation?: number; lastValuationAt: string; visibility: string };
  type Snapshot = { recordedAt: string; currency: string; assets: number; liabilities: number; netWorth: number };
  let investments = $state<Investment[]>([]);
  let properties = $state<Property[]>([]);
  let history = $state<Snapshot[]>([]);
  let creator = $state<"investment" | "property" | null>(null);
  let error = $state("");
  let name = $state(""); let kind = $state("cdt"); let institution = $state("");
  let principal = $state<number | undefined>(); let openedAt = $state(new Date().toISOString().slice(0,10));
  let maturityDate = $state(""); let annualRate = $state<number | undefined>();
  let grossGain = $state<number | undefined>(); let fees = $state<number | undefined>(); let netGain = $state<number | undefined>();
  let ticker = $state(""); let units = $state<number | undefined>(); let purchasePrice = $state<number | undefined>(); let currentPrice = $state<number | undefined>(); let sourceUrl = $state("");
  let propertyType = $state("apartment"); let purchaseValue = $state<number | undefined>(); let estimatedValue = $state<number | undefined>(); let sector = $state(""); let appreciation = $state<number | undefined>();
  let privateItem = $state(false);

  const assets = $derived($financeData.accounts.filter((account) => account.type !== "liability"));
  const liabilities = $derived($financeData.accounts.filter((account) => account.type === "liability"));
  const baseCurrency = $derived($financeData.settings.baseCurrency);
  const accountAssets = $derived(assets.filter((item) => item.currency === baseCurrency).reduce((sum, item) => sum + item.currentBalance, 0));
  const baseLiabilities = $derived(liabilities.filter((item) => item.currency === baseCurrency).reduce((sum, item) => sum + Math.abs(item.currentBalance), 0));
  const investmentValue = $derived(investments.filter((item) => item.currency === baseCurrency).reduce((sum, item) => sum + (item.currentPrice && item.units ? item.currentPrice * item.units : item.principal + (item.expectedNetGain ?? 0)), 0));
  const propertyValue = $derived(properties.filter((item) => item.currency === baseCurrency).reduce((sum, item) => sum + item.currentEstimatedValue, 0));
  const baseAssets = $derived(accountAssets + investmentValue + propertyValue);
  const netWorth = $derived(baseAssets - baseLiabilities);
  const chartPoints = $derived.by(() => {
    const values = history.filter((item) => item.currency === baseCurrency).map((item) => item.netWorth);
    if (!values.length) return "";
    const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
    return values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${90 - ((value - min) / range) * 80}`).join(" ");
  });

  onMount(load);
  async function load() {
    if (!isServerMode()) {
      const local = JSON.parse(localStorage.getItem("okle:patrimony") ?? '{"investments":[],"properties":[],"history":[]}');
      investments = local.investments; properties = local.properties; history = local.history; return;
    }
    const result = await apiRequest<{ investments: Investment[]; properties: Property[]; history: Snapshot[] }>("/v1/patrimony");
    investments = result.investments.map((item) => ({ ...item, principal: Number(item.principal), annualRate: item.annualRate == null ? undefined : Number(item.annualRate), expectedGrossGain: item.expectedGrossGain == null ? undefined : Number(item.expectedGrossGain), feesAndTaxes: item.feesAndTaxes == null ? undefined : Number(item.feesAndTaxes), expectedNetGain: item.expectedNetGain == null ? undefined : Number(item.expectedNetGain), units: item.units == null ? undefined : Number(item.units), purchasePrice: item.purchasePrice == null ? undefined : Number(item.purchasePrice), currentPrice: item.currentPrice == null ? undefined : Number(item.currentPrice), openedAt: item.openedAt.slice(0,10), maturityDate: item.maturityDate?.slice(0,10) }));
    properties = result.properties.map((item) => ({ ...item, purchaseValue: item.purchaseValue == null ? undefined : Number(item.purchaseValue), currentEstimatedValue: Number(item.currentEstimatedValue), annualAppreciation: item.annualAppreciation == null ? undefined : Number(item.annualAppreciation), lastValuationAt: item.lastValuationAt.slice(0,10) }));
    history = result.history.map((item) => ({ ...item, recordedAt: item.recordedAt.slice(0,10), assets: Number(item.assets), liabilities: Number(item.liabilities), netWorth: Number(item.netWorth) }));
  }
  function persist() { localStorage.setItem("okle:patrimony", JSON.stringify({ investments, properties, history })); }
  async function saveInvestment() {
    if (!name.trim() || principal === undefined) return (error = "Completa nombre y capital.");
    const input = { kind, name: name.trim(), ...(institution ? { institution } : {}), visibility: privateItem ? "private" : "household", currency: baseCurrency, principal: String(principal), openedAt, ...(maturityDate ? { maturityDate } : {}), ...(annualRate !== undefined ? { annualRate: String(annualRate / 100) } : {}), ...(grossGain !== undefined ? { expectedGrossGain: String(grossGain) } : {}), ...(fees !== undefined ? { feesAndTaxes: String(fees) } : {}), ...(netGain !== undefined ? { expectedNetGain: String(netGain) } : {}), ...(ticker ? { ticker } : {}), ...(units !== undefined ? { units: String(units) } : {}), ...(purchasePrice !== undefined ? { purchasePrice: String(purchasePrice) } : {}), ...(currentPrice !== undefined ? { currentPrice: String(currentPrice), priceAsOf: new Date().toISOString() } : {}), ...(sourceUrl ? { sourceUrl } : {}) };
    if (isServerMode()) { await apiRequest("/v1/patrimony/investments", { method: "POST", body: JSON.stringify(input) }); await load(); }
    else { investments = [{ id: crypto.randomUUID(), ...input, principal, annualRate: annualRate === undefined ? undefined : annualRate / 100, expectedGrossGain: grossGain, feesAndTaxes: fees, expectedNetGain: netGain, units, purchasePrice, currentPrice }, ...investments]; persist(); }
    creator = null;
  }
  async function saveProperty() {
    if (!name.trim() || estimatedValue === undefined) return (error = "Completa nombre y valoración actual.");
    const input = { name: name.trim(), type: propertyType, visibility: privateItem ? "private" : "household", currency: baseCurrency, currentEstimatedValue: String(estimatedValue), ...(purchaseValue !== undefined ? { purchaseValue: String(purchaseValue) } : {}), ...(sector ? { locationSector: sector } : {}), ...(appreciation !== undefined ? { annualAppreciation: String(appreciation / 100) } : {}), lastValuationAt: new Date().toISOString().slice(0,10) };
    if (isServerMode()) { await apiRequest("/v1/patrimony/properties", { method: "POST", body: JSON.stringify(input) }); await load(); }
    else { properties = [{ id: crypto.randomUUID(), ...input, purchaseValue, currentEstimatedValue: estimatedValue, annualAppreciation: appreciation === undefined ? undefined : appreciation / 100 }, ...properties]; persist(); }
    creator = null;
  }
  async function takeSnapshot() {
    const snapshot = { recordedAt: new Date().toISOString().slice(0,10), currency: baseCurrency, assets: String(baseAssets), liabilities: String(baseLiabilities) };
    if (isServerMode()) { await apiRequest("/v1/patrimony/snapshots", { method: "POST", body: JSON.stringify(snapshot) }); await load(); }
    else { const item = { ...snapshot, assets: baseAssets, liabilities: baseLiabilities, netWorth }; history = [...history.filter((row) => row.recordedAt !== item.recordedAt), item].sort((a,b) => a.recordedAt.localeCompare(b.recordedAt)); persist(); }
  }
</script>

<div class="page">
  <header class="page-header"><div><span class="eyebrow">Activos menos pasivos</span><h1>Patrimonio</h1><p>Cuentas reales, inversiones e inmuebles con supuestos y fecha de valoración visibles.</p></div><div class="row-actions"><button onclick={() => (creator = "investment")}>＋ Inversión</button><button onclick={() => (creator = "property")}>＋ Inmueble</button></div></header>
  {#if error}<p class="form-error">{error}</p>{/if}
  <section class="metric-grid investment-metrics"><article class="metric-card"><span>Activos {baseCurrency}</span><strong>{currency(baseAssets, baseCurrency)}</strong><small>Cuentas + posiciones + inmuebles</small></article><article class="metric-card"><span>Pasivos {baseCurrency}</span><strong>{currency(baseLiabilities, baseCurrency)}</strong><small>{liabilities.length} obligaciones</small></article><article class="metric-card investment-accent"><span>Patrimonio neto</span><strong>{currency(netWorth, baseCurrency)}</strong><button class="text-button" onclick={takeSnapshot}>Guardar corte de hoy</button></article></section>
  <section class="panel net-worth-chart"><header class="section-heading"><div><span class="eyebrow">Historia verificable</span><h2>Evolución del patrimonio</h2></div><small>{history.length} cortes guardados</small></header>{#if chartPoints}<svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Evolución histórica del patrimonio"><polyline points={chartPoints} fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke" /></svg><div class="chart-axis"><span>{history[0]?.recordedAt}</span><span>{history.at(-1)?.recordedAt}</span></div>{:else}<div class="empty-state"><strong>Guarda el primer corte</strong><p>Los cortes mensuales crean una gráfica comparable sin reconstruir el pasado.</p></div>{/if}</section>
  <section class="section-block"><header class="section-heading"><div><span class="eyebrow">Rendimiento y vencimientos</span><h2>Inversiones</h2></div><a href="/future">Simular escenarios</a></header><div class="pocket-grid">{#each investments as item}<article class="panel investment-card"><span class="privacy">{item.visibility === "private" ? "Solo yo" : "Compartida"}</span><h3>{item.name}</h3><p>{item.institution ?? item.ticker ?? item.kind}</p><strong>{currency(item.currentPrice && item.units ? item.currentPrice * item.units : item.principal + (item.expectedNetGain ?? 0), item.currency)}</strong><small>Capital {currency(item.principal, item.currency)}{item.annualRate !== undefined ? ` · tasa ${(item.annualRate * 100).toFixed(2)}%` : ""}</small>{#if item.maturityDate}<div class="investment-detail"><span>Vence</span><b>{item.maturityDate}</b></div>{/if}{#if item.expectedGrossGain !== undefined}<div class="investment-detail"><span>Ganancia bruta</span><b>{currency(item.expectedGrossGain, item.currency)}</b><span>Costos e impuestos</span><b>{currency(item.feesAndTaxes ?? 0, item.currency)}</b><span>Ganancia neta</span><b>{currency(item.expectedNetGain ?? 0, item.currency)}</b></div>{/if}{#if item.sourceUrl}<a class="secondary-link" href={item.sourceUrl} target="_blank" rel="noreferrer">Fuente de precio ↗</a>{/if}</article>{/each}</div></section>
  <section class="section-block"><header class="section-heading"><div><span class="eyebrow">Valoraciones declaradas</span><h2>Inmuebles</h2></div></header><div class="pocket-grid">{#each properties as item}<article class="panel property-card"><span class="privacy">{item.visibility === "private" ? "Solo yo" : "Compartido"}</span><h3>{item.name}</h3><strong>{currency(item.currentEstimatedValue, item.currency)}</strong><p>{item.locationSector ?? item.type}</p><small>Valorado {item.lastValuationAt}{item.annualAppreciation !== undefined ? ` · supuesto anual ${(item.annualAppreciation * 100).toFixed(2)}%` : ""}</small></article>{/each}</div></section>
  <p class="educational-note">Las cotizaciones, tasas y valorizaciones son datos declarados con fecha y fuente; no son garantías. El Asesor OKLE puede explicar escenarios, pero no emite órdenes de compra o venta.</p>
</div>

{#if creator}<div class="modal-backdrop"><div class="quick-entry patrimony-form" role="dialog" aria-modal="true"><header><div><span class="eyebrow">Registro patrimonial</span><h2>{creator === "investment" ? "Nueva inversión" : "Nuevo inmueble"}</h2></div><button class="icon-button" onclick={() => (creator = null)}>×</button></header><div class="form-grid"><label>Nombre<input bind:value={name} /></label>{#if creator === "investment"}<label>Tipo<select bind:value={kind}><option value="cdt">CDT / CAT</option><option value="stock">Acción</option><option value="fund">Fondo</option><option value="dollar_app">Dólares en app</option><option value="other">Otra</option></select></label><label>Entidad o app<input bind:value={institution} /></label><label>Capital<input type="number" min="0" bind:value={principal} /></label><label>Fecha de apertura<input type="date" bind:value={openedAt} /></label><label>Vencimiento<input type="date" bind:value={maturityDate} /></label><label>Tasa EA (%)<input type="number" min="0" step=".01" bind:value={annualRate} /></label><label>Ganancia bruta<input type="number" min="0" bind:value={grossGain} /></label><label>Retenciones/comisiones<input type="number" min="0" bind:value={fees} /></label><label>Ganancia neta<input type="number" min="0" bind:value={netGain} /></label><label>Ticker<input bind:value={ticker} /></label><label>Unidades<input type="number" min="0" step="any" bind:value={units} /></label><label>Precio de compra<input type="number" min="0" bind:value={purchasePrice} /></label><label>Precio actual<input type="number" min="0" bind:value={currentPrice} /></label><label class="wide-field">Fuente del precio<input type="url" bind:value={sourceUrl} placeholder="https://…" /></label>{:else}<label>Tipo<select bind:value={propertyType}><option value="apartment">Apartamento</option><option value="house">Casa</option><option value="lot">Lote</option><option value="commercial">Comercial</option><option value="other">Otro</option></select></label><label>Valor de compra<input type="number" min="0" bind:value={purchaseValue} /></label><label>Valor estimado actual<input type="number" min="0" bind:value={estimatedValue} /></label><label>Sector o ubicación<input bind:value={sector} /></label><label>Valorización anual supuesta (%)<input type="number" min="0" step=".01" bind:value={appreciation} /></label>{/if}<label class="switch-row wide-field"><input type="checkbox" bind:checked={privateItem} /><span>Solo yo</span></label></div><button class="primary-button" onclick={creator === "investment" ? saveInvestment : saveProperty}>Guardar</button></div></div>{/if}
