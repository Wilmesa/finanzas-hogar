<script lang="ts">
  import {
    clearChat,
    financeData,
    generateInsight,
    loadChat,
    sendChatMessage,
  } from "$lib/finance-store";
  import { apiRequest } from "$lib/api";
  import type { ChatMessageView } from "$lib/types";
  import { onMount } from "svelte";

  let scope = $state<"household" | "private">("household");
  let mode = $state<"chat" | "insights">("chat");
  let generating = $state(false);
  let sending = $state(false);
  let testing = $state(false);
  let error = $state("");
  let draft = $state("");
  let messages = $state<ChatMessageView[]>([]);
  const latest = $derived($financeData.insights.find((insight) => insight.scope === scope));
  const bundle = $derived(latest?.payload.bundle);

  onMount(refreshChat);

  async function refreshChat() {
    try { messages = await loadChat(scope); }
    catch (cause) { error = cause instanceof Error ? cause.message : "No pudimos cargar la conversación"; }
  }

  async function changeScope(next: "household" | "private") {
    scope = next;
    messages = [];
    error = "";
    await refreshChat();
  }

  async function send(event: SubmitEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    const optimistic: ChatMessageView = {
      id: `pending-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    messages = [...messages, optimistic];
    draft = "";
    sending = true;
    error = "";
    try { messages = [...messages, await sendChatMessage(content, scope)]; }
    catch (cause) { error = cause instanceof Error ? cause.message : "No pudimos consultar al asesor"; }
    finally { sending = false; }
  }

  function sendOnEnter(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement | null)
      ?.closest("form")
      ?.requestSubmit();
  }

  async function clearConversation() {
    if (!confirm("¿Limpiar tu conversación en este alcance? Esta acción no borra movimientos ni análisis.")) return;
    await clearChat(scope);
    messages = [];
  }

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

<div class="page copilot-page">
  <header class="page-header">
    <div><span class="eyebrow">Explicaciones con contexto autorizado</span><h1>Asesor OKLE</h1><p>Conversa sobre tus finanzas o genera un análisis trazable. El asistente nunca modifica Firefly.</p></div>
  </header>

  <div class="view-tabs" aria-label="Vista del asesor">
    <button class:active={mode === "chat"} onclick={() => (mode = "chat")}>Conversación</button>
    <button class:active={mode === "insights"} onclick={() => (mode = "insights")}>Análisis</button>
  </div>
  <div class="filter-tabs"><button class:active={scope === "household"} onclick={() => changeScope("household")}>Compartido</button><button class:active={scope === "private"} onclick={() => changeScope("private")}>Solo yo</button></div>

  <section class="ai-status panel" class:unavailable={!$financeData.aiStatus.generationEnabled}>
    <span class="status-dot"></span><div><strong>{$financeData.aiStatus.generationEnabled ? "Asesor disponible" : "Asesor no configurado"}</strong><small>Proveedor: {$financeData.aiStatus.providerName ?? $financeData.aiStatus.provider} · Modelo: {$financeData.aiStatus.model ?? "sin modelo"}</small></div>
    {#if $financeData.settings.memberRole === "owner"}<button class="secondary-link" disabled={testing} onclick={testConnection}>{testing ? "Probando…" : "Probar conexión"}</button>{/if}
  </section>
  {#if error}<div class="form-error" role="alert"><strong>No pudimos completar la operación</strong><p>{error}</p></div>{/if}

  {#if mode === "chat"}
    <section class="chat-panel panel">
      <div class="section-heading"><div><span class="eyebrow">Contexto anónimo</span><small>Patrones agregados, sin nombres ni números de cuenta.</small></div><button class="danger-text" onclick={clearConversation}>Limpiar conversación</button></div>
      <div class="chat-messages" aria-live="polite">
        {#if messages.length === 0}<div class="empty-state"><strong>¿Qué quieres entender o planear?</strong><p>Pregunta, por ejemplo, si tu ritmo de ahorro alcanza para una meta o qué categorías crecieron este mes.</p></div>{/if}
        {#each messages as message}
          <article class:assistant={message.role === "assistant"} class:user={message.role === "user"} class="chat-message">
            <span>{message.role === "assistant" ? "OKLE" : "Tú"}</span>
            <p>{message.content}</p>
            {#if message.citations?.length}<div class="chat-citations">{#each message.citations as citation}<a href={citation.url} target="_blank" rel="noreferrer">{citation.title} ↗</a>{/each}</div>{/if}
          </article>
        {/each}
        {#if sending}<div class="chat-thinking" role="status">OKLE está revisando el contexto autorizado…</div>{/if}
      </div>
      <form class="chat-composer" onsubmit={send}>
        <label class="sr-only" for="advisor-question">Pregunta para el asesor</label>
        <textarea id="advisor-question" bind:value={draft} onkeydown={sendOnEnter} maxlength="4000" rows="2" placeholder="Pregunta sobre gastos, metas, deudas o escenarios… (Enter para enviar)"></textarea>
        <button class="primary-button" disabled={sending || !$financeData.aiStatus.generationEnabled}>Enviar</button>
      </form>
      <p class="advisor-disclaimer">Contenido educativo basado en los datos autorizados. No constituye asesoría financiera, tributaria ni de inversión profesional.</p>
    </section>
  {:else}
    <div class="analysis-actions"><button class="primary-button" disabled={generating || !$financeData.aiStatus.generationEnabled} onclick={generate}>{generating ? "Analizando…" : "Generar análisis"}</button></div>
    {#if bundle}
      <section class="copilot-summary"><article class="panel"><span class="eyebrow">Resumen ejecutivo</span><h2>{bundle.status === "insufficient_data" ? "Datos insuficientes" : "Análisis del período"}</h2><p>{bundle.summary}</p><small>Generado {new Date(latest?.createdAt ?? "").toLocaleString("es-CO")} · {latest?.payload.provider} · alcance {scope === "household" ? "compartido" : "privado"}</small></article>
        <article class="panel evidence-panel"><span class="eyebrow">Trazabilidad</span><h2>{latest?.payload.evidence?.length ?? 0} evidencias</h2><p>Cada cifra proviene de movimientos o ingresos esperados autorizados.</p></article></section>
      <section class="section-block"><header class="section-heading"><div><span class="eyebrow">Datos confirmados y cálculos</span><h2>Hallazgos</h2></div></header><div class="insight-list">{#each bundle.alerts as alert}<article class="panel"><span class={`priority ${alert.severity}`}>{alert.severity}</span><p>{alert.message}</p><small>Evidencia: {alert.evidenceIds.join(", ")}</small></article>{/each}{#each bundle.spendingFindings as finding}<article class="panel"><span class="eyebrow">Gasto confirmado</span><h3>{finding.title}</h3><p>{finding.amount} · {finding.comparison}</p><small>Evidencia: {finding.evidenceIds.join(", ")}</small></article>{/each}</div></section>
      <section class="section-block"><header class="section-heading"><div><span class="eyebrow">Inferencias, no garantías</span><h2>Acciones sugeridas</h2></div></header><div class="insight-list">{#each bundle.opportunities as opportunity}<article class="panel"><h3>{opportunity.action}</h3><p>Impacto mensual estimado: {opportunity.estimatedMonthlyImpact}</p><small>Confianza {Math.round(opportunity.confidence * 100)} % · {opportunity.evidenceIds.join(", ")}</small></article>{/each}{#if bundle.opportunities.length === 0}<div class="empty-state panel"><strong>Sin recomendaciones por ahora</strong><p>OKLE evita sugerencias cuando la evidencia no es suficiente.</p></div>{/if}</div></section>
    {:else}<div class="empty-state panel"><strong>Aún no hay suficientes movimientos para generar un análisis confiable</strong><p>Registra movimientos reales y genera el primer análisis cuando el asesor esté disponible.</p></div>{/if}
  {/if}
</div>
