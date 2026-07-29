<script lang="ts">
  import {
    allocateToPocket,
    archivePocket,
    createPocket,
    deletePocketCreatedByMistake,
    financeData,
    linkPocketAccount,
    releaseFromPocket,
    setPocketStatus,
    transferBetweenPockets,
    updatePocket,
  } from "$lib/finance-store";
  import PocketCard from "$lib/PocketCard.svelte";
  import type { PocketView } from "$lib/types";
  let filter = $state<"household" | "private">("household");
  let search = $state("");
  let ownerFilter = $state("all");
  let creating = $state(false);
  let name = $state("");
  let observations = $state("");
  let targetAmount = $state<number | undefined>();
  let policyKind = $state<"target_by_date" | "target_by_contribution" | "periodic_spend">("target_by_date");
  let targetDate = $state("");
  let monthlyContribution = $state<number | undefined>();
  let privatePocket = $state(false);
  let pocketIcon = $state("💰");
  let pocketColor = $state("#123C69");
  let currencyCode = $state("COP");
  let saving = $state(false);
  let error = $state("");
  let allocatingPocketId = $state<string | null>(null);
  let allocationAmount = $state<number | undefined>();
  let allocationAccountId = $state("");
  let allocationMode = $state<"account" | "initial_adjustment" | "correction">("account");
  let allocationReason = $state("");
  let releasingPocketId = $state<string | null>(null);
  let releaseAmount = $state<number | undefined>();
  let releaseAccountId = $state("");
  let actionError = $state("");
  let movingPocketId = $state<string | null>(null);
  let moveDestinationPocketId = $state("");
  let moveAmount = $state<number | undefined>();
  let editingPocket = $state<PocketView | null>(null);
  let editName = $state("");
  let editObservations = $state("");
  let editTargetAmount = $state<number | undefined>();
  let editPolicyKind = $state<NonNullable<PocketView["policyKind"]>>("target_by_date");
  let editTargetDate = $state("");
  let editMonthlyContribution = $state<number | undefined>();
  let editPrivate = $state(false);
  let editIcon = $state("💰");
  let editColor = $state("#123C69");
  let archivingPocket = $state<PocketView | null>(null);
  let archiveDisposition = $state<"transfer" | "release">("transfer");
  let destinationPocketId = $state("");
  let linkingPocket = $state<PocketView | null>(null);
  let linkAccountId = $state("");
  let deletingPocket = $state<PocketView | null>(null);
  let deletionReason = $state("");
  const pockets = $derived($financeData.pockets);
  const visible = $derived(
    pockets.filter((pocket) => {
      const matchesName = pocket.name
        .toLocaleLowerCase("es")
        .includes(search.trim().toLocaleLowerCase("es"));
      return (
        pocket.visibility === filter &&
        matchesName &&
        (filter === "private" ||
          ownerFilter === "all" ||
          pocket.ownerMemberId === ownerFilter)
      );
    }),
  );

  async function savePocket() {
    error = "";
    if (!name.trim() || !targetAmount || targetAmount <= 0) {
      error = "Escribe un nombre y una meta mayor que cero.";
      return;
    }
    if (policyKind === "target_by_date" && !targetDate) {
      error = "Selecciona la fecha límite.";
      return;
    }
    if (policyKind === "target_by_contribution" && (!monthlyContribution || monthlyContribution <= 0)) {
      error = "Escribe el aporte máximo mensual.";
      return;
    }
    saving = true;
    try {
      await createPocket({
        name: name.trim(), observations: observations.trim(), visibility: privatePocket ? "private" : "household", currency: currencyCode,
        targetAmount, policyKind, targetDate: targetDate || undefined, monthlyContribution,
        icon: pocketIcon,
        color: pocketColor,
      });
      name = "";
      observations = "";
      targetAmount = undefined;
      targetDate = "";
      monthlyContribution = undefined;
      privatePocket = false;
      pocketIcon = "💰";
      pocketColor = "#123C69";
      creating = false;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible crear el bolsillo";
    } finally {
      saving = false;
    }
  }

  async function applyAllocation() {
    if (!allocatingPocketId || !allocationAmount || allocationAmount <= 0) return;
    actionError = "";
    try {
      await allocateToPocket(
        allocatingPocketId,
        allocationAmount,
        allocationAccountId,
        allocationMode,
        allocationReason,
      );
      allocatingPocketId = null;
      allocationAmount = undefined;
      allocationAccountId = "";
      allocationReason = "";
      allocationMode = "account";
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : "No fue posible reservar el dinero";
    }
  }

  function beginAllocation(pocket: PocketView) {
    allocatingPocketId = pocket.id;
    allocationAmount = undefined;
    allocationMode = "account";
    allocationReason = "";
    allocationAccountId =
      $financeData.accounts.find(
        (account) =>
          account.id === pocket.defaultAccountId &&
          account.ownerMemberId === pocket.ownerMemberId &&
          account.currency === pocket.currency,
      )?.id ??
      $financeData.accounts.find(
        (account) =>
          account.currency === pocket.currency &&
          account.ownerMemberId === pocket.ownerMemberId &&
          account.availableBalance > 0,
      )?.id ?? "";
  }

  function beginRelease(pocket: PocketView) {
    releasingPocketId = pocket.id;
    releaseAmount = undefined;
    releaseAccountId =
      pocket.fundingLots?.find((lot) => lot.sourceAccountId)?.sourceAccountId ??
      "";
  }

  async function releaseReservation() {
    if (!releasingPocketId || !releaseAmount || releaseAmount <= 0 || !releaseAccountId) return;
    actionError = "";
    try {
      await releaseFromPocket(releasingPocketId, releaseAmount, releaseAccountId);
      releasingPocketId = null;
      releaseAmount = undefined;
      releaseAccountId = "";
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : "No fue posible liberar el dinero";
    }
  }

  async function changeStatus(pocket: (typeof pockets)[number], status: "active" | "paused" | "archived") {
    actionError = "";
    try { await setPocketStatus(pocket, status); }
    catch (cause) { actionError = cause instanceof Error ? cause.message : "No pudimos actualizar el bolsillo"; }
  }

  function beginMove(pocket: PocketView) {
    movingPocketId = pocket.id;
    moveAmount = undefined;
    moveDestinationPocketId =
      pockets.find(
        (candidate) =>
          candidate.id !== pocket.id &&
          candidate.status === "active" &&
          candidate.currency === pocket.currency &&
          candidate.visibility === pocket.visibility &&
          candidate.ownerMemberId === pocket.ownerMemberId,
      )?.id ?? "";
  }

  async function moveReservation() {
    if (!movingPocketId || !moveDestinationPocketId || !moveAmount || moveAmount <= 0) return;
    actionError = "";
    try {
      await transferBetweenPockets(
        movingPocketId,
        moveDestinationPocketId,
        moveAmount,
      );
      movingPocketId = null;
      moveAmount = undefined;
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : "No fue posible mover la reserva";
    }
  }

  function beginEdit(pocket: PocketView) {
    editingPocket = pocket;
    editName = pocket.name;
    editObservations = pocket.observations ?? "";
    editTargetAmount = pocket.targetAmount;
    editPolicyKind = pocket.policyKind ?? "target_by_date";
    editTargetDate = pocket.targetDate ?? "";
    editMonthlyContribution = pocket.monthlyContribution;
    editPrivate = pocket.visibility === "private";
    editIcon = pocket.icon;
    editColor = pocket.color;
  }

  async function saveEdit() {
    if (!editingPocket || !editName.trim() || !editTargetAmount) return;
    saving = true;
    actionError = "";
    try {
      await updatePocket(editingPocket, {
        name: editName.trim(),
        observations: editObservations.trim(),
        visibility: editPrivate ? "private" : "household",
        targetAmount: editTargetAmount,
        policyKind: editPolicyKind,
        targetDate: editTargetDate || undefined,
        monthlyContribution: editMonthlyContribution,
        icon: editIcon,
        color: editColor,
      });
      editingPocket = null;
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : "No pudimos guardar los cambios";
    } finally {
      saving = false;
    }
  }

  function beginArchive(pocket: PocketView) {
    archivingPocket = pocket;
    archiveDisposition = "transfer";
    destinationPocketId = pockets.find(
      (candidate) =>
        candidate.id !== pocket.id &&
        candidate.status === "active" &&
      candidate.currency === pocket.currency &&
        candidate.visibility === pocket.visibility &&
        candidate.ownerMemberId === pocket.ownerMemberId,
    )?.id ?? "";
  }

  async function confirmArchive() {
    if (!archivingPocket) return;
    if (
      archivingPocket.currentAmount > 0 &&
      archiveDisposition === "transfer" &&
      !destinationPocketId
    ) {
      actionError = "Selecciona un bolsillo compatible o devuelve el saldo al balance general.";
      return;
    }
    saving = true;
    try {
      await archivePocket(archivingPocket, {
        ...(archivingPocket.currentAmount > 0 ? { disposition: archiveDisposition } : {}),
        ...(archiveDisposition === "transfer" && destinationPocketId
          ? { destinationPocketId }
          : {}),
      });
      archivingPocket = null;
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : "No pudimos archivar el bolsillo";
    } finally {
      saving = false;
    }
  }

  function beginLink(pocket: PocketView) {
    linkingPocket = pocket;
    linkAccountId =
      pocket.defaultAccountId ??
      $financeData.accounts.find(
        (account) =>
          account.ownerMemberId === pocket.ownerMemberId &&
          account.currency === pocket.currency,
      )?.id ??
      "";
  }

  async function confirmLink() {
    if (!linkingPocket || !linkAccountId) return;
    actionError = "";
    saving = true;
    try {
      await linkPocketAccount(linkingPocket, linkAccountId);
      linkingPocket = null;
    } catch (cause) {
      actionError =
        cause instanceof Error
          ? cause.message
          : "No pudimos vincular la cuenta";
    } finally {
      saving = false;
    }
  }

  function beginDelete(pocket: PocketView) {
    deletingPocket = pocket;
    deletionReason = "";
  }

  async function confirmDelete() {
    if (!deletingPocket || deletionReason.trim().length < 5) {
      actionError = "Explica brevemente por qué el bolsillo fue creado por error.";
      return;
    }
    saving = true;
    actionError = "";
    try {
      await deletePocketCreatedByMistake(
        deletingPocket,
        deletionReason.trim(),
      );
      deletingPocket = null;
    } catch (cause) {
      actionError =
        cause instanceof Error
          ? cause.message
          : "No pudimos eliminar el bolsillo";
    } finally {
      saving = false;
    }
  }
</script>

<div class="page">
  <header class="page-header"><div><span class="eyebrow">Dinero con propósito</span><h1>Tus bolsillos</h1><p>Organiza el presente sin perder de vista lo que viene.</p></div><button class="primary-button desktop-action" onclick={() => (creating = !creating)}>＋ Nuevo bolsillo</button></header>
  <div class="filter-tabs" aria-label="Filtrar bolsillos">
    <button class:active={filter === "household"} onclick={() => (filter = "household")}>Compartidos</button>
    <button class:active={filter === "private"} onclick={() => (filter = "private")}>Solo yo</button>
  </div>
  <div class="pocket-toolbar panel">
    <label class="pocket-search"><span>Buscar por nombre</span><input type="search" placeholder="Ej. viaje, mercado o regalo" bind:value={search} /></label>
    {#if filter === "household"}
      <div class="owner-filter" aria-label="Filtrar por creador">
        <button class:active={ownerFilter === "all"} onclick={() => (ownerFilter = "all")}>Ambos</button>
        {#each $financeData.members as member}<button class:active={ownerFilter === member.id} onclick={() => (ownerFilter = member.id)}>{member.id === $financeData.settings.memberId ? "Mis bolsillos" : `De ${member.displayName}`}</button>{/each}
      </div>
    {/if}
  </div>
  {#if creating}
    <section class="create-pocket panel">
      <header><div><span class="eyebrow">Nuevo propósito</span><h2>Crea un bolsillo</h2></div><span class="privacy-default">Compartido por defecto</span></header>
      <div class="form-grid">
        <label>Nombre<input placeholder="Ej. Fondo de emergencia" bind:value={name} /></label>
        <label>Emoji<input maxlength="16" placeholder="💰" bind:value={pocketIcon} /></label>
        <label>Color<input type="color" bind:value={pocketColor} /></label>
        <label class="wide-field">Observaciones (opcional)<textarea bind:value={observations} maxlength="1000" placeholder="Anota para qué usarán este bolsillo o cualquier acuerdo importante"></textarea></label>
        <label>¿Cuánto necesitas?<input inputmode="decimal" type="number" min="1" placeholder="0" bind:value={targetAmount} /></label>
        <label>Moneda<select bind:value={currencyCode}><option>COP</option><option>USD</option><option>EUR</option></select></label>
        <label>¿Cómo quieres calcularlo?<select bind:value={policyKind}><option value="target_by_date">Tengo una fecha límite</option><option value="target_by_contribution">Tengo un aporte máximo</option><option value="periodic_spend">Es un límite periódico</option></select></label>
        {#if policyKind === "target_by_date"}<label>Fecha límite<input type="date" bind:value={targetDate} /></label>{/if}
        {#if policyKind === "target_by_contribution"}<label>Aporte máximo mensual<input type="number" min="1" bind:value={monthlyContribution} /></label>{/if}
      </div>
      <label class="switch-row"><input type="checkbox" bind:checked={privatePocket} /> Solo yo <small>Tu pareja no verá el nombre, finalidad ni movimientos.</small></label>
      {#if error}<p class="form-error" role="alert">{error}</p>{/if}
      <button class="primary-button" disabled={saving} onclick={savePocket}>{saving ? "Creando…" : "Calcular y crear"}</button>
    </section>
  {/if}
  {#if actionError}<p class="form-error" role="alert">{actionError}</p>{/if}
  <div class="pocket-grid full">{#each visible as pocket}<div class="pocket-with-action"><PocketCard {pocket} /><div class="pocket-owner-line"><span>Creado por {pocket.ownerMemberId === $financeData.settings.memberId ? "ti" : pocket.ownerName}</span>{#if pocket.defaultAccountId}<small>Cuenta vinculada: {$financeData.accounts.find((account) => account.id === pocket.defaultAccountId)?.name ?? "Cuenta no disponible"}</small>{/if}</div>{#if (pocket.unreconciledAmount ?? 0) > 0}<p class="reconciliation-warning">⚠ {pocket.unreconciledAmount?.toLocaleString("es-CO")} {pocket.currency} por conciliar: no se restan de ninguna cuenta.</p>{/if}{#if pocket.canManage}<div class="pocket-actions"><button onclick={() => beginLink(pocket)}>Vincular cuenta</button><button onclick={() => beginAllocation(pocket)}>Reservar desde cuenta</button><button disabled={pocket.currentAmount <= 0} onclick={() => beginRelease(pocket)}>Liberar</button><button disabled={pocket.currentAmount <= 0} onclick={() => beginMove(pocket)}>Mover</button><button onclick={() => beginEdit(pocket)}>Editar</button><button onclick={() => changeStatus(pocket, pocket.status === "paused" ? "active" : "paused")}>{pocket.status === "paused" ? "Reanudar" : "Pausar"}</button><button class="danger-text" onclick={() => beginArchive(pocket)}>Archivar</button><button class="danger-text" onclick={() => beginDelete(pocket)}>Eliminar si fue un error</button></div>{:else}<p class="read-only-pocket">Puedes consultarlo, pero solo {pocket.ownerName ?? "su creador"} puede modificar o disponer de este bolsillo.</p>{/if}</div>{/each}</div>
  {#if visible.length === 0}<div class="empty-state panel"><strong>No hay bolsillos en esta vista</strong><p>Crea uno compartido o privado para reservar dinero con propósito.</p></div>{/if}
  <button class="fab mobile-only" onclick={() => (creating = !creating)}><span>＋</span> Nuevo</button>
</div>

{#if allocatingPocketId}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (allocatingPocketId = null)}>
    <div class="quick-entry compact" role="dialog" aria-modal="true" aria-labelledby="allocation-title">
      <header><div><span class="eyebrow">Reserva virtual</span><h2 id="allocation-title">Aportar a {pockets.find((pocket) => pocket.id === allocatingPocketId)?.name}</h2></div><button class="icon-button" onclick={() => (allocatingPocketId = null)} aria-label="Cerrar">×</button></header>
      <label>Cantidad<input type="number" min="1" bind:value={allocationAmount} /></label>
      <label>Tipo de registro<select bind:value={allocationMode}><option value="account">Reservar dinero de una cuenta</option><option value="initial_adjustment">Registrar saldo que ya existía</option><option value="correction">Corregir una reserva</option></select></label>
      {#if allocationMode === "account"}
        <label>Cuenta de origen<select bind:value={allocationAccountId}><option value="">Seleccionar…</option>{#each $financeData.accounts.filter((account) => account.currency === pockets.find((pocket) => pocket.id === allocatingPocketId)?.currency && account.ownerMemberId === pockets.find((pocket) => pocket.id === allocatingPocketId)?.ownerMemberId) as account}<option value={account.id}>{account.icon} {account.name} · disponible {account.availableBalance.toLocaleString("es-CO")} {account.currency}</option>{/each}</select></label>
      {:else}
        <label>Motivo obligatorio<textarea maxlength="500" bind:value={allocationReason} placeholder="Ej. saldo previo al comenzar a usar OKLE"></textarea></label>
      {/if}
      <p class="privacy-note">Reservar no mueve dinero en el banco: reduce lo disponible de la cuenta elegida y conserva la trazabilidad.</p>
      <button class="primary-button" onclick={applyAllocation}>Guardar aporte</button>
    </div>
  </div>
{/if}

{#if releasingPocketId}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (releasingPocketId = null)}>
    <div class="quick-entry compact" role="dialog" aria-modal="true" aria-labelledby="release-title">
      <header><div><span class="eyebrow">Volver a usar el dinero</span><h2 id="release-title">Liberar reserva</h2></div><button class="icon-button" onclick={() => (releasingPocketId = null)} aria-label="Cerrar">×</button></header>
      <label>Cantidad<input type="number" min="1" max={pockets.find((pocket) => pocket.id === releasingPocketId)?.currentAmount} bind:value={releaseAmount} /></label>
      <label>Cuenta de origen<select bind:value={releaseAccountId}><option value="">Seleccionar…</option>{#each $financeData.accounts.filter((account) => pockets.find((pocket) => pocket.id === releasingPocketId)?.fundingLots?.some((lot) => lot.sourceAccountId === account.id && lot.remainingAmount > 0)) as account}<option value={account.id}>{account.icon} {account.name}</option>{/each}</select></label>
      <p class="privacy-note">El dinero vuelve a estar disponible en su cuenta real. Después puedes registrar el pago o gasto desde esa cuenta.</p>
      <button class="primary-button" onclick={releaseReservation}>Liberar dinero</button>
    </div>
  </div>
{/if}

{#if movingPocketId}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (movingPocketId = null)}>
    <div class="quick-entry compact" role="dialog" aria-modal="true" aria-labelledby="move-pocket-title">
      <header><div><span class="eyebrow">Cambio de propósito</span><h2 id="move-pocket-title">Mover reserva</h2></div><button class="icon-button" onclick={() => (movingPocketId = null)} aria-label="Cerrar">×</button></header>
      <label>Cantidad<input type="number" min="1" max={pockets.find((pocket) => pocket.id === movingPocketId)?.currentAmount} bind:value={moveAmount} /></label>
      <label>Destino<select bind:value={moveDestinationPocketId}><option value="">Seleccionar…</option>{#each pockets.filter((candidate) => candidate.id !== movingPocketId && candidate.status === "active" && candidate.currency === pockets.find((pocket) => pocket.id === movingPocketId)?.currency && candidate.visibility === pockets.find((pocket) => pocket.id === movingPocketId)?.visibility) as candidate}<option value={candidate.id}>{candidate.name}</option>{/each}</select></label>
      <p class="privacy-note">Solo cambia el propósito reservado. No crea transferencias ni movimientos en Firefly.</p>
      <button class="primary-button" onclick={moveReservation}>Mover reserva</button>
    </div>
  </div>
{/if}

{#if editingPocket}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (editingPocket = null)}>
    <div class="quick-entry" role="dialog" aria-modal="true" aria-labelledby="edit-pocket-title">
      <header><div><span class="eyebrow">Cambios trazables</span><h2 id="edit-pocket-title">Editar bolsillo</h2></div><button class="icon-button" onclick={() => (editingPocket = null)} aria-label="Cerrar">×</button></header>
      <div class="form-grid">
        <label>Nombre<input bind:value={editName} /></label>
        <label>Emoji<input maxlength="16" bind:value={editIcon} /></label>
        <label>Color<input type="color" bind:value={editColor} /></label>
        <label class="wide-field">Observaciones (opcional)<textarea bind:value={editObservations} maxlength="1000" placeholder="Para qué existe este bolsillo o qué acordaron"></textarea></label>
        <label>Meta o límite<input type="number" min="1" bind:value={editTargetAmount} /></label>
        <label>Regla<select bind:value={editPolicyKind}><option value="target_by_date">Meta por fecha</option><option value="target_by_contribution">Meta por aporte</option><option value="periodic_spend">Límite mensual</option></select></label>
        {#if editPolicyKind === "target_by_date"}<label>Fecha límite<input type="date" bind:value={editTargetDate} /></label>{/if}
        {#if editPolicyKind === "target_by_contribution"}<label>Aporte mensual<input type="number" min="1" bind:value={editMonthlyContribution} /></label>{/if}
      </div>
      <label class="switch-row"><input type="checkbox" bind:checked={editPrivate} /> Solo yo</label>
      <button class="primary-button" disabled={saving} onclick={saveEdit}>{saving ? "Guardando…" : "Guardar cambios"}</button>
    </div>
  </div>
{/if}

{#if archivingPocket}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (archivingPocket = null)}>
    <div class="quick-entry compact" role="dialog" aria-modal="true" aria-labelledby="archive-pocket-title">
      <header><div><span class="eyebrow">Archivo seguro</span><h2 id="archive-pocket-title">Archivar {archivingPocket.name}</h2></div><button class="icon-button" onclick={() => (archivingPocket = null)} aria-label="Cerrar">×</button></header>
      {#if archivingPocket.currentAmount > 0}
        <p>Este bolsillo conserva {archivingPocket.currentAmount.toLocaleString("es-CO")} {archivingPocket.currency}. Elige qué hacer con ese saldo.</p>
        <label><input type="radio" bind:group={archiveDisposition} value="transfer" /> Mover a otro bolsillo</label>
        {#if archiveDisposition === "transfer"}<label>Destino<select bind:value={destinationPocketId}><option value="">Seleccionar…</option>{#each pockets.filter((candidate) => candidate.id !== archivingPocket?.id && candidate.status === "active" && candidate.currency === archivingPocket?.currency && candidate.visibility === archivingPocket?.visibility && candidate.ownerMemberId === archivingPocket?.ownerMemberId) as candidate}<option value={candidate.id}>{candidate.name}</option>{/each}</select></label>{/if}
        <label><input type="radio" bind:group={archiveDisposition} value="release" /> Devolver al balance general</label>
      {:else}
        <p>El bolsillo no tiene saldo reservado. Se ocultará de las vistas activas.</p>
      {/if}
      <button class="danger-button" disabled={saving} onclick={confirmArchive}>{saving ? "Archivando…" : "Confirmar archivo"}</button>
    </div>
  </div>
{/if}

{#if linkingPocket}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (linkingPocket = null)}>
    <div class="quick-entry compact" role="dialog" aria-modal="true" aria-labelledby="link-pocket-title">
      <header><div><span class="eyebrow">Cuenta de respaldo</span><h2 id="link-pocket-title">Vincular {linkingPocket.name}</h2></div><button class="icon-button" onclick={() => (linkingPocket = null)} aria-label="Cerrar">×</button></header>
      <label>Cuenta del creador<select bind:value={linkAccountId}><option value="">Seleccionar…</option>{#each $financeData.accounts.filter((account) => account.ownerMemberId === linkingPocket?.ownerMemberId && account.currency === linkingPocket?.currency) as account}<option value={account.id}>{account.icon} {account.name} · {account.ownerName} · {account.availableBalance.toLocaleString("es-CO")} disponible</option>{/each}</select></label>
      {#if (linkingPocket.unreconciledAmount ?? 0) > 0}<p class="reconciliation-warning">Al confirmar, {linkingPocket.unreconciledAmount?.toLocaleString("es-CO")} {linkingPocket.currency} de saldo legado quedarán reservados desde esta cuenta.</p>{:else}<p class="privacy-note">La cuenta quedará sugerida para futuros aportes. Las reservas ya trazadas conservan su cuenta original.</p>{/if}
      <button class="primary-button" disabled={saving || !linkAccountId} onclick={confirmLink}>{saving ? "Vinculando…" : "Vincular cuenta"}</button>
    </div>
  </div>
{/if}

{#if deletingPocket}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (deletingPocket = null)}>
    <div class="quick-entry compact" role="dialog" aria-modal="true" aria-labelledby="delete-pocket-title">
      <header><div><span class="eyebrow">Corrección excepcional</span><h2 id="delete-pocket-title">Eliminar {deletingPocket.name}</h2></div><button class="icon-button" onclick={() => (deletingPocket = null)} aria-label="Cerrar">×</button></header>
      <p>Se eliminarán el bolsillo, su saldo virtual y sus aportes de planificación. No se creará un ingreso, gasto ni movimiento bancario.</p>
      <label>Motivo obligatorio<textarea maxlength="500" bind:value={deletionReason} placeholder="Ej. saldo digitado por error antes de configurar las cuentas"></textarea></label>
      <p class="privacy-note">OKLE bloqueará esta acción si el bolsillo ya participa en movimientos reales, pagos, inversiones o planes.</p>
      <button class="danger-button" disabled={saving || deletionReason.trim().length < 5} onclick={confirmDelete}>{saving ? "Eliminando…" : "Eliminar definitivamente"}</button>
    </div>
  </div>
{/if}
