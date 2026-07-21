<script lang="ts">
  import { exportFinanceData, financeData, importFinanceData, resetLocalData } from "$lib/finance-store";
  import { authMode, changeLocalPassword, isServerMode, logout } from "$lib/auth";
  import { apiRequest } from "$lib/api";
  import PwaStatus from "$lib/PwaStatus.svelte";
  import NotificationSettings from "$lib/NotificationSettings.svelte";
  import { onMount } from "svelte";
  import { themePreference, type ThemePreference } from "$lib/theme";
  let message = $state("");
  let error = $state("");
  let currentPassword = $state("");
  let newPassword = $state("");
  let confirmPassword = $state("");
  let news = $state<Array<{ source: string; sourceUrl: string; title: string; factSummary: string; publishedAt: string }>>([]);

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
    anchor.download = `finnest-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    message = "Exportación creada. Guárdala fuera de este dispositivo.";
  }

  function selectTheme(event: Event) {
    themePreference.set((event.currentTarget as HTMLSelectElement).value as ThemePreference);
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

  async function changePassword(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    message = "";
    if (newPassword !== confirmPassword) {
      error = "Las contraseñas nuevas no coinciden.";
      return;
    }
    try {
      await changeLocalPassword(currentPassword, newPassword);
      currentPassword = newPassword = confirmPassword = "";
      alert("Contraseña actualizada. Debes iniciar sesión nuevamente.");
      location.assign("/");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible cambiar la contraseña";
    }
  }
</script>

<div class="page">
  <header class="page-header"><div><span class="eyebrow">Contexto y control</span><h1>Configuración</h1><p>Hogar, apariencia, noticias, automatizaciones y respaldo.</p></div></header>
  <section class="panel"><span class="eyebrow">Apariencia</span><h2>Tema de FinNest</h2><label>Preferencia<select value={$themePreference} onchange={selectTheme}><option value="system">Seguir sistema</option><option value="light">Claro</option><option value="dark">Oscuro</option></select></label></section>
  <PwaStatus />
  <NotificationSettings />
  {#if isServerMode() && authMode() === "local"}
    <details class="panel-card">
      <summary><strong>Cambiar mi contraseña</strong></summary>
      <form class="auth-form" onsubmit={changePassword}>
        <label>Contraseña actual<input type="password" autocomplete="current-password" bind:value={currentPassword} required /></label>
        <label>Nueva contraseña<input type="password" autocomplete="new-password" minlength="12" maxlength="128" bind:value={newPassword} required /></label>
        <label>Repetir contraseña<input type="password" autocomplete="new-password" minlength="12" maxlength="128" bind:value={confirmPassword} required /></label>
        <button class="primary-button" type="submit">Cambiar y cerrar sesiones</button>
      </form>
    </details>
  {/if}
  <section class="news-layout">
    {#if news[0]}<article class="featured-news"><span class="eyebrow">{news[0].source} · {new Date(news[0].publishedAt).toLocaleDateString("es-CO")}</span><h2>{news[0].title}</h2><p><strong>Hecho publicado:</strong> {news[0].factSummary}</p><a href={news[0].sourceUrl} target="_blank" rel="noreferrer">Abrir fuente original ↗</a></article>{:else}<article class="featured-news empty-news"><span class="eyebrow">Contexto económico</span><h2>Sin noticias verificadas</h2><p>Cuando la ingesta encuentre fuentes oficiales, aparecerán aquí con fecha y enlace original.</p></article>{/if}
    <div class="settings-list">
      <a href="/copilot"><span class="settings-icon">✦</span><span><strong>AI-CFO</strong><small>Estado, análisis y evidencia</small></span><b>›</b></a>
      <a href="/household"><span class="settings-icon">♙</span><span><strong>Hogar y perfiles</strong><small>{$financeData.members.length} miembros · {$financeData.settings.baseCurrency}</small></span><b>›</b></a>
      <a href="/accounts"><span class="settings-icon">◇</span><span><strong>Cuentas y tarjetas</strong><small>Libros compartido y privado en Firefly</small></span><b>›</b></a>
      <a href="/pockets"><span class="settings-icon">◎</span><span><strong>Bolsillos</strong><small>Propósitos, metas y privacidad</small></span><b>›</b></a>
      <a href="/onboarding"><span class="settings-icon">✓</span><span><strong>Revisar configuración</strong><small>Diagnóstico guiado de FinNest</small></span><b>›</b></a>
      <button onclick={downloadExport}><span class="settings-icon">⇩</span><span><strong>Exportar y respaldar</strong><small>Descargar un JSON portable</small></span><b>›</b></button>
      <label class="import-action"><span class="settings-icon">⇧</span><span><strong>Importar datos</strong><small>Restaurar una exportación JSON</small></span><b>›</b><input class="sr-only" type="file" accept="application/json" onchange={importFile} /></label>
      {#if !isServerMode()}<button onclick={reset}><span class="settings-icon">↺</span><span><strong>Restaurar demostración</strong><small>Elimina cambios locales</small></span><b>›</b></button>{/if}
      {#if isServerMode()}<button onclick={() => logout()}><span class="settings-icon">↪</span><span><strong>Cerrar sesión</strong><small>Salir de este dispositivo</small></span><b>›</b></button>{/if}
    </div>
  </section>
  {#if message}<p class="success-message" role="status">{message}</p>{/if}
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
</div>
