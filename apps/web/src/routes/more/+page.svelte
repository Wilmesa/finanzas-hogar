<script lang="ts">
  import {
    archiveCategory,
    createCategory,
    exportFinanceData,
    financeData,
    importFinanceData,
    resetLocalData,
    updateCategory,
  } from "$lib/finance-store";
  import { authMode, changeLocalPassword, isServerMode, logout } from "$lib/auth";
  import { apiRequest } from "$lib/api";
  import PwaStatus from "$lib/PwaStatus.svelte";
  import NotificationSettings from "$lib/NotificationSettings.svelte";
  import { onMount } from "svelte";
  let message = $state("");
  let error = $state("");
  let currentPassword = $state("");
  let newPassword = $state("");
  let confirmPassword = $state("");
  let news = $state<Array<{ source: string; sourceUrl: string; title: string; factSummary: string; publishedAt: string }>>([]);
  let newsSources = $state<Array<{ source: string; ok: boolean; imported: number; error?: string }>>([]);
  let refreshingNews = $state(false);
  let categoryName = $state("");
  let categoryIcon = $state("tag");
  let categoryColor = $state("#123C69");
  let editingCategoryId = $state<string | null>(null);
  const newsPortals = [
    { name: "Banco de la República", area: "Política monetaria y economía colombiana", url: "https://www.banrep.gov.co/es/noticias-rss" },
    { name: "DANE", area: "Inflación, empleo y estadísticas oficiales", url: "https://www.dane.gov.co/index.php/estadisticas-por-tema" },
    { name: "Google News Economía", area: "Cobertura nacional, regional y mundial", url: "https://news.google.com/search?q=econom%C3%ADa%20Colombia&hl=es-419&gl=CO&ceid=CO%3Aes-419" },
  ];

  onMount(async () => {
    if (!isServerMode()) return;
    try {
      const result = await apiRequest<typeof news>("/v1/news");
      if (result.length) news = result;
      newsSources = (await apiRequest<{ sources: typeof newsSources }>("/v1/news/status")).sources;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible actualizar noticias";
    }
  });

  async function refreshNews() {
    refreshingNews = true;
    error = "";
    try {
      const result = await apiRequest<{ sources: typeof newsSources }>("/v1/news/refresh", { method: "POST" });
      newsSources = result.sources;
      news = await apiRequest<typeof news>("/v1/news");
      message = `Noticias actualizadas desde ${newsSources.filter((source) => source.ok).length} fuentes.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible actualizar noticias";
    } finally { refreshingNews = false; }
  }

  function downloadExport() {
    const blob = new Blob([exportFinanceData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `okle-${new Date().toISOString().slice(0, 10)}.json`;
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

  async function saveCategory() {
    if (!categoryName.trim()) return;
    const input = {
      name: categoryName.trim(),
      icon: categoryIcon,
      color: categoryColor,
    };
    try {
      if (editingCategoryId) await updateCategory(editingCategoryId, input);
      else await createCategory(input);
      categoryName = "";
      categoryIcon = "tag";
      categoryColor = "#123C69";
      editingCategoryId = null;
      message = "Categorías actualizadas.";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible guardar la categoría";
    }
  }

  function editCategory(category: (typeof $financeData.categories)[number]) {
    editingCategoryId = category.id;
    categoryName = category.name;
    categoryIcon = category.icon;
    categoryColor = category.color;
  }

  async function removeCategory(category: (typeof $financeData.categories)[number]) {
    if (!confirm(`¿Archivar la categoría “${category.name}”? Los movimientos conservarán su nombre.`)) return;
    await archiveCategory(category.id);
    message = "Categoría archivada sin alterar movimientos anteriores.";
  }
</script>

<div class="page">
  <header class="page-header"><div><span class="eyebrow">Contexto y control</span><h1>Configuración</h1><p>Hogar, apariencia, noticias, automatizaciones y respaldo.</p></div></header>
  <section class="planning-shortcuts" aria-labelledby="planning-shortcuts-title">
    <div class="section-heading"><div><span class="eyebrow">Accesos financieros</span><h2 id="planning-shortcuts-title">Planear y cumplir</h2></div></div>
    <div class="shortcut-grid">
      <a href="/planning"><span>⌁</span><strong>Plan financiero</strong><small>Sueldos futuros, primas y destinos</small></a>
      <a class="payments-shortcut" href="/payments"><span>✓</span><strong>Pagos</strong><small>Servicios, cuotas y vencimientos</small></a>
      <a href="/patrimony"><span>↗</span><strong>Patrimonio</strong><small>Inversiones, CDT e inmuebles</small></a>
      <a href="/future"><span>◫</span><strong>Simuladores</strong><small>Deudas y proyecciones futuras</small></a>
    </div>
  </section>
  <PwaStatus />
  <NotificationSettings />
  <section class="panel section-block">
    <span class="eyebrow">Clasificación del hogar</span><h2>Categorías</h2><p>Personaliza las etiquetas usadas al registrar y corregir movimientos.</p>
    <div class="category-grid">{#each $financeData.categories as category}<div class="category-chip" style={`--category-color:${category.color}`}><span>{category.name}</span><button onclick={() => editCategory(category)}>Editar</button><button class="danger-text" onclick={() => removeCategory(category)}>Archivar</button></div>{/each}</div>
    <div class="form-row category-form"><label>Nombre<input bind:value={categoryName} /></label><label>Icono<select bind:value={categoryIcon}><option value="tag">Etiqueta</option><option value="shopping-cart">Mercado</option><option value="bus">Transporte</option><option value="utensils">Restaurante</option><option value="home">Vivienda</option><option value="heart-pulse">Salud</option></select></label><label>Color<input type="color" bind:value={categoryColor} /></label><button class="secondary-button" onclick={saveCategory}>{editingCategoryId ? "Guardar" : "Agregar"}</button></div>
  </section>
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
  <section class="panel news-control"><div><span class="eyebrow">Colombia, región y mundo</span><h2>Noticias financieras verificadas</h2><p>Fuentes oficiales, cobertura agregada y RSS regionales configurables. Cada artículo conserva su enlace original.</p></div>{#if $financeData.settings.memberRole === "owner" && isServerMode()}<button class="secondary-button" disabled={refreshingNews} onclick={refreshNews}>{refreshingNews ? "Actualizando…" : "Actualizar ahora"}</button>{/if}<div class="news-source-status">{#each newsSources as source}<span class:failed={!source.ok} title={source.error ?? `${source.imported} artículos importados`}>{source.ok ? "●" : "×"} {source.source} · {source.imported}</span>{/each}</div></section>
  <section class="news-layout">
    {#if news[0]}<article class="featured-news"><span class="eyebrow">{news[0].source} · {new Date(news[0].publishedAt).toLocaleDateString("es-CO")}</span><h2>{news[0].title}</h2><p><strong>Hecho publicado:</strong> {news[0].factSummary}</p><a href={news[0].sourceUrl} target="_blank" rel="noreferrer">Abrir fuente original ↗</a></article>{:else}<article class="featured-news empty-news"><span class="eyebrow">Contexto económico</span><h2>{isServerMode() ? "Aún no se importaron noticias" : "Noticias disponibles al conectar el servidor"}</h2><p>Mientras se actualiza la ingesta puedes abrir las fuentes en vivo que aparecen debajo. Los errores de proveedor nunca bloquean tus finanzas.</p></article>{/if}
    <div class="settings-list">
      <a href="/copilot"><span class="settings-icon">✦</span><span><strong>Asesor OKLE</strong><small>Conversación, análisis y evidencia</small></span><b>›</b></a>
      <a href="/household"><span class="settings-icon">♙</span><span><strong>Hogar y perfiles</strong><small>{$financeData.members.length} miembros · {$financeData.settings.baseCurrency}</small></span><b>›</b></a>
      <a href="/accounts"><span class="settings-icon">◇</span><span><strong>Cuentas y tarjetas</strong><small>Libros compartido y privado en Firefly</small></span><b>›</b></a>
      <a href="/pockets"><span class="settings-icon">◎</span><span><strong>Bolsillos</strong><small>Propósitos, metas y privacidad</small></span><b>›</b></a>
      <a href="/onboarding"><span class="settings-icon">✓</span><span><strong>Revisar configuración</strong><small>Diagnóstico guiado de OKLE</small></span><b>›</b></a>
      <button onclick={downloadExport}><span class="settings-icon">⇩</span><span><strong>Exportar y respaldar</strong><small>Descargar un JSON portable</small></span><b>›</b></button>
      <label class="import-action"><span class="settings-icon">⇧</span><span><strong>Importar datos</strong><small>Restaurar una exportación JSON</small></span><b>›</b><input class="sr-only" type="file" accept="application/json" onchange={importFile} /></label>
      {#if !isServerMode()}<button onclick={reset}><span class="settings-icon">↺</span><span><strong>Restaurar demostración</strong><small>Elimina cambios locales</small></span><b>›</b></button>{/if}
      {#if isServerMode()}<button onclick={() => logout()}><span class="settings-icon">↪</span><span><strong>Cerrar sesión</strong><small>Salir de este dispositivo</small></span><b>›</b></button>{/if}
    </div>
  </section>
  {#if news.length > 1}<section class="section-block"><header class="section-heading"><div><span class="eyebrow">Últimas publicaciones</span><h2>Más noticias</h2></div><small>{news.length} artículos disponibles</small></header><div class="news-stream">{#each news.slice(1, 9) as article}<article class="panel"><span class="eyebrow">{article.source} · {new Date(article.publishedAt).toLocaleDateString("es-CO")}</span><h3>{article.title}</h3><p>{article.factSummary}</p><a href={article.sourceUrl} target="_blank" rel="noreferrer">Leer fuente original ↗</a></article>{/each}</div></section>{/if}
  <section class="section-block"><header class="section-heading"><div><span class="eyebrow">Acceso directo</span><h2>Fuentes económicas en vivo</h2></div></header><div class="source-directory">{#each newsPortals as portal}<a class="panel" href={portal.url} target="_blank" rel="noreferrer"><strong>{portal.name}</strong><small>{portal.area}</small><b>↗</b></a>{/each}</div></section>
  {#if message}<p class="success-message" role="status">{message}</p>{/if}
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
</div>
