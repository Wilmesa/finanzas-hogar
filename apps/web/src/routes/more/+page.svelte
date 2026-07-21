<script lang="ts">
  import { exportFinanceData, importFinanceData, resetLocalData } from "$lib/finance-store";
  import { isServerMode, logout } from "$lib/auth";
  import { apiRequest } from "$lib/api";
  import PwaStatus from "$lib/PwaStatus.svelte";
  import { onMount } from "svelte";
  let message = $state("");
  let error = $state("");
  let news = $state([
    {
      source: "Banco de la República",
      sourceUrl: "https://www.banrep.gov.co/es/press-releases-board?page=1",
      title: "La decisión de tasas y lo que puede significar para tus metas",
      factSummary: "Consulta la publicación oficial y revisa tasas de CDT y crédito antes de renovar o refinanciar.",
      publishedAt: new Date().toISOString(),
    },
  ]);

  onMount(async () => {
    if (!isServerMode()) return;
    try {
      const result = await apiRequest<typeof news>("/v1/news");
      if (result.length) news = result;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible actualizar noticias";
    }
  });

  function downloadExport() {
    const blob = new Blob([exportFinanceData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nuestro-dinero-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    message = "Exportación creada. Guárdala fuera de este dispositivo.";
  }

  async function importFile(event: Event) {
    error = "";
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await importFinanceData(await file.text());
      message = isServerMode()
        ? "Bolsillos y saldos reservados importados. Los movimientos locales no se copiaron a Firefly."
        : "Datos importados correctamente.";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible importar";
    }
  }

  function reset() {
    if (!confirm("¿Restaurar los datos de demostración? Se perderán los cambios locales.")) return;
    resetLocalData();
    message = "Datos locales restaurados.";
  }
</script>

<div class="page">
  <header class="page-header"><div><span class="eyebrow">Contexto y control</span><h1>Más</h1><p>Noticias, automatizaciones y configuración del hogar.</p></div></header>
  <PwaStatus />
  <section class="news-layout">
    <article class="featured-news"><span class="eyebrow">{news[0]?.source} · {new Date(news[0]?.publishedAt ?? Date.now()).toLocaleDateString("es-CO")}</span><h2>{news[0]?.title}</h2><p><strong>Hecho publicado:</strong> {news[0]?.factSummary}</p><a href={news[0]?.sourceUrl} target="_blank" rel="noreferrer">Abrir fuente original ↗</a></article>
    <div class="settings-list">
      <a href="/more"><span class="settings-icon">✦</span><span><strong>Insights financieros</strong><small>Hallazgos con evidencia y feedback</small></span><b>›</b></a>
      <a href="/more"><span class="settings-icon">◷</span><span><strong>Recordatorio diario</strong><small>20:00 · Web Push + Telegram</small></span><b>›</b></a>
      <a href="/more"><span class="settings-icon">♙</span><span><strong>Nuestro hogar</strong><small>2 miembros · COP</small></span><b>›</b></a>
      <button onclick={downloadExport}><span class="settings-icon">⇩</span><span><strong>Exportar y respaldar</strong><small>Descargar un JSON portable</small></span><b>›</b></button>
      <label class="import-action"><span class="settings-icon">⇧</span><span><strong>Importar datos</strong><small>Restaurar una exportación JSON</small></span><b>›</b><input class="sr-only" type="file" accept="application/json" onchange={importFile} /></label>
      {#if !isServerMode()}<button onclick={reset}><span class="settings-icon">↺</span><span><strong>Restaurar demostración</strong><small>Elimina cambios locales</small></span><b>›</b></button>{/if}
      {#if isServerMode()}<button onclick={logout}><span class="settings-icon">↪</span><span><strong>Cerrar sesión</strong><small>Salir de este dispositivo</small></span><b>›</b></button>{/if}
    </div>
  </section>
  {#if message}<p class="success-message" role="status">{message}</p>{/if}
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
</div>
