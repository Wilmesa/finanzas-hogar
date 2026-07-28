<script lang="ts">
  import { apiRequest } from "$lib/api";
  import { currency } from "$lib/demo";
  import { financeData, hydrateFinanceData } from "$lib/finance-store";
  import { isServerMode } from "$lib/auth";
  import { onMount } from "svelte";

  type ReviewItem = {
    id: string;
    merchant?: string;
    category?: string;
    amount: number;
    currency: string;
    occurredAt: string;
    reviewStatus: "PENDING" | "FLAGGED_FOR_PARTNER";
    pocketId?: string;
    origin: string;
    payer: { id: string; displayName: string };
  };
  type Rule = {
    id: string;
    name: string;
    conditions: { merchantPattern?: string };
    actions: { category?: string; pocketId?: string; reviewStatus?: string };
    priority: number;
    enabled: boolean;
  };

  let items = $state<ReviewItem[]>([]);
  let rules = $state<Rule[]>([]);
  let loading = $state(true);
  let error = $state("");
  let success = $state("");
  let actionId = $state<string | null>(null);
  let touchStart = $state<{ id: string; x: number } | null>(null);
  let ruleName = $state("");
  let merchantPattern = $state("");
  let ruleCategory = $state("");
  let rulePocketId = $state("");
  let autoReview = $state(true);

  onMount(load);

  async function load() {
    if (!isServerMode()) {
      loading = false;
      return;
    }
    loading = true;
    try {
      [items, rules] = await Promise.all([
        apiRequest<ReviewItem[]>("/v1/review"),
        apiRequest<Rule[]>("/v1/transaction-rules"),
      ]);
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "No fue posible abrir la bandeja";
    } finally {
      loading = false;
    }
  }

  async function review(
    item: ReviewItem,
    status: "REVIEWED" | "FLAGGED_FOR_PARTNER",
  ) {
    actionId = item.id;
    error = "";
    try {
      const partner = $financeData.members.find(
        (member) => member.id !== $financeData.settings.memberId,
      );
      await apiRequest(`/v1/review/${item.id}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          status,
          ...(item.category ? { category: item.category } : {}),
          ...(item.pocketId ? { pocketId: item.pocketId } : {}),
          ...(status === "FLAGGED_FOR_PARTNER" && partner
            ? { flaggedForMemberId: partner.id }
            : {}),
        }),
      });
      items = items.filter((candidate) => candidate.id !== item.id);
      success =
        status === "REVIEWED"
          ? "Movimiento revisado y conciliado."
          : "Movimiento enviado a tu pareja para revisión.";
      await hydrateFinanceData();
    } catch (cause) {
      error =
        cause instanceof Error ? cause.message : "No fue posible revisar";
    } finally {
      actionId = null;
    }
  }

  function finishSwipe(event: PointerEvent, item: ReviewItem) {
    if (!touchStart || touchStart.id !== item.id) return;
    const distance = event.clientX - touchStart.x;
    touchStart = null;
    if (distance > 70) void review(item, "REVIEWED");
    if (distance < -70) void review(item, "FLAGGED_FOR_PARTNER");
  }

  async function createRule() {
    if (!ruleName.trim() || !merchantPattern.trim()) {
      error = "Escribe un nombre y un patrón de comercio.";
      return;
    }
    try {
      await apiRequest("/v1/transaction-rules", {
        method: "POST",
        body: JSON.stringify({
          name: ruleName.trim(),
          conditions: { merchantPattern: merchantPattern.trim() },
          actions: {
            ...(ruleCategory ? { category: ruleCategory } : {}),
            ...(rulePocketId ? { pocketId: rulePocketId } : {}),
            reviewStatus: autoReview ? "REVIEWED" : "PENDING",
          },
          priority: 100,
          enabled: true,
        }),
      });
      ruleName = "";
      merchantPattern = "";
      ruleCategory = "";
      rulePocketId = "";
      success = "Regla creada. Se aplicará solo a movimientos importados futuros.";
      await load();
    } catch (cause) {
      error =
        cause instanceof Error ? cause.message : "No fue posible crear la regla";
    }
  }

  async function disableRule(rule: Rule) {
    await apiRequest(`/v1/transaction-rules/${rule.id}`, { method: "DELETE" });
    await load();
  }
</script>

<div class="page review-page">
  <header class="page-header">
    <div>
      <span class="eyebrow">Control colaborativo</span>
      <h1>Bandeja de revisión</h1>
      <p>
        Solo llegan aquí movimientos importados. Lo que registras manualmente
        queda aprobado desde el inicio.
      </p>
    </div>
    <span class="review-counter">{items.length} pendientes</span>
  </header>

  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  {#if success}<p class="success-message" role="status">{success}</p>{/if}

  <section class="review-instructions panel">
    <span>Desliza → para aprobar</span>
    <span>Desliza ← para preguntar a tu pareja</span>
  </section>

  <section class="review-stack" aria-live="polite">
    {#if loading}
      <div class="panel empty-state">Cargando movimientos…</div>
    {:else}
      {#each items as item (item.id)}
        <article
          class="panel review-card"
          class:flagged={item.reviewStatus === "FLAGGED_FOR_PARTNER"}
          onpointerdown={(event) =>
            (touchStart = { id: item.id, x: event.clientX })}
          onpointerup={(event) => finishSwipe(event, item)}
        >
          <header>
            <div>
              <span class="eyebrow">{item.origin.replaceAll("_", " ")}</span>
              <h2>{item.merchant ?? "Movimiento importado"}</h2>
              <small>
                {new Date(item.occurredAt).toLocaleDateString("es-CO")} ·
                {item.payer.displayName}
              </small>
            </div>
            <strong>{currency(Number(item.amount), item.currency)}</strong>
          </header>
          <div class="form-row">
            <label>
              Categoría
              <select bind:value={item.category}>
                <option value="">Sin categoría</option>
                {#each $financeData.categories as category}
                  <option value={category.name}>{category.name}</option>
                {/each}
              </select>
            </label>
            <label>
              Bolsillo
              <select bind:value={item.pocketId}>
                <option value="">Sin bolsillo</option>
                {#each $financeData.pockets.filter(
                  (pocket) => pocket.currency === item.currency,
                ) as pocket}
                  <option value={pocket.id}>{pocket.name}</option>
                {/each}
              </select>
            </label>
          </div>
          <div class="row-actions">
            <button
              class="primary-button"
              disabled={actionId === item.id}
              onclick={() => review(item, "REVIEWED")}>Aprobar</button
            >
            <button
              class="secondary-button"
              disabled={actionId === item.id}
              onclick={() => review(item, "FLAGGED_FOR_PARTNER")}
              >Preguntar a mi pareja</button
            >
          </div>
        </article>
      {/each}
      {#if items.length === 0}
        <div class="panel empty-state">
          <strong>Todo está revisado</strong>
          <p>Los movimientos manuales no requieren este paso.</p>
        </div>
      {/if}
    {/if}
  </section>

  <section class="panel section-block">
    <span class="eyebrow">Automatización controlada</span>
    <h2>Reglas para movimientos importados</h2>
    <p>
      Ejemplo: si el comercio coincide con <code>rappi</code>, asignar
      Restaurantes. Las reglas nunca modifican registros manuales anteriores.
    </p>
    <div class="form-grid">
      <label>Nombre<input bind:value={ruleName} placeholder="Rappi a restaurantes" /></label>
      <label>Patrón del comercio<input bind:value={merchantPattern} placeholder="rappi|rappi pay" /></label>
      <label>
        Categoría
        <select bind:value={ruleCategory}>
          <option value="">No cambiar</option>
          {#each $financeData.categories as category}
            <option value={category.name}>{category.name}</option>
          {/each}
        </select>
      </label>
      <label>
        Bolsillo
        <select bind:value={rulePocketId}>
          <option value="">No asignar</option>
          {#each $financeData.pockets as pocket}
            <option value={pocket.id}>{pocket.name}</option>
          {/each}
        </select>
      </label>
      <label class="switch-row">
        <input type="checkbox" bind:checked={autoReview} />
        <span>Aprobar automáticamente</span>
      </label>
    </div>
    <button class="primary-button" onclick={createRule}>Crear regla</button>
    <div class="rules-list">
      {#each rules as rule}
        <div>
          <span>
            <strong>{rule.name}</strong>
            <small>
              /{rule.conditions.merchantPattern ?? "—"}/ · prioridad
              {rule.priority}
            </small>
          </span>
          <button class="danger-text" onclick={() => disableRule(rule)}
            >Desactivar</button
          >
        </div>
      {/each}
    </div>
  </section>
</div>
