<script lang="ts">
  import { financeData, generateInsight } from "$lib/finance-store";
  import { apiRequest } from "$lib/api";
  import { onMount } from "svelte";

  let scope = $state<"household" | "private">("household");
  let generating = $state(false);
  let error = $state("");
  let testing = $state(false);
  const latest = $derived($financeData.insights.find((insight) => insight.scope === scope));
  const bundle = $derived(latest?.payload.bundle);

  async function generate() {
    generating = true; error = "";
    try { await generateInsight(scope); }
    catch (cause) { error = cause instanceof Error ? cause.message : "No pudimos generar el análisis"; }
    finally { generating = false; }
  }

  async function testConnection() {
    testing = true; error = "";
    try { await apiRequest("/v1/ai-cfo/test", { method: "POST" }); }
    catch (cause) { error = cause instanceof Error ? cause.message : "No pudimos probar AI-CFO"; }
    finally { testing = false; }
  }
</script>

<div class="page">
  <header class="page-header"><div><span class="eyebrow">Datos verificados · explicación asistida</span><h1>Copiloto</h1><p>AI-CFO explica cálculos y movimientos reales; nunca modifica Firefly.</p></div><button class="primary-button" disabled={generating || !$financeData.aiStatus.generationEnabled} onclick={generate}>{generating ? "Analizando…" : "✦ Generar análisis"}</button></header>
  <div class="filter-tabs"><button class:active={scope === "household"} onclick={() => (scope = "household")}>Compartido</button><button class:active={scope === "private"} onclick={() => (scope = "private")}>Solo yo</button></div>
  <section class="ai-status panel" class:unavailable={!$financeData.aiStatus.generationEnabled}>
    <span class="status-dot"></span><div><strong>{$financeData.aiStatus.generationEnabled ? "AI-CFO disponible" : "AI-CFO no está configurado"}</strong><small>Proveedor: {$financeData.aiStatus.providerName ?? $financeData.aiStatus.provider} · Modelo: {$financeData.aiStatus.model ?? "sin modelo"} · clave {$financeData.aiStatus.keyPresent ? "presente" : "ausente"}</small></div>
    {#if $financeData.settings.memberRole === "owner"}<button class="secondary-link" disabled={testing} onclick={testConnection}>{testing ? "Probando…" : "Probar conexión"}</button>{/if}
  </section>
  {#if error}<div class="form-error" role="alert"><strong>No pudimos completar la operación</strong><p>{error}</p></div>{/if}

  {#if bundle}
    <section class="copilot-summary"><article class="panel"><span class="eyebrow">Resumen ejecutivo</span><h2>{bundle.status === "insufficient_data" ? "Datos insuficientes" : "Análisis del período"}</h2><p>{bundle.summary}</p><small>Generado {new Date(latest?.createdAt ?? "").toLocaleString("es-CO")} · {latest?.payload.provider} · alcance {scope === "household" ? "compartido" : "privado"}</small></article>
      <article class="panel evidence-panel"><span class="eyebrow">Trazabilidad</span><h2>{latest?.payload.evidence?.length ?? 0} evidencias</h2><p>Cada cifra proviene de movimientos o ingresos esperados autorizados.</p></article></section>
    <section class="section-block"><header class="section-heading"><div><span class="eyebrow">Datos confirmados y cálculos</span><h2>Hallazgos</h2></div></header><div class="insight-list">{#each bundle.alerts as alert}<article class="panel"><span class={`priority ${alert.severity}`}>{alert.severity}</span><p>{alert.message}</p><small>Evidencia: {alert.evidenceIds.join(", ")}</small></article>{/each}{#each bundle.spendingFindings as finding}<article class="panel"><span class="eyebrow">Gasto confirmado</span><h3>{finding.title}</h3><p>{finding.amount} · {finding.comparison}</p><small>Evidencia: {finding.evidenceIds.join(", ")}</small></article>{/each}</div></section>
    <section class="section-block"><header class="section-heading"><div><span class="eyebrow">Inferencias, no garantías</span><h2>Acciones sugeridas</h2></div></header><div class="insight-list">{#each bundle.opportunities as opportunity}<article class="panel"><h3>{opportunity.action}</h3><p>Impacto mensual estimado: {opportunity.estimatedMonthlyImpact}</p><small>Confianza {Math.round(opportunity.confidence * 100)} % · {opportunity.evidenceIds.join(", ")}</small></article>{/each}{#if bundle.opportunities.length === 0}<div class="empty-state panel"><strong>Sin recomendaciones por ahora</strong><p>FinNest evita sugerencias cuando la evidencia no es suficiente.</p></div>{/if}</div></section>
  {:else}
    <div class="empty-state panel"><strong>Aún no hay suficientes movimientos para generar un análisis confiable</strong><p>Registra movimientos reales y genera el primer análisis cuando AI-CFO esté disponible.</p></div>
  {/if}
</div>
