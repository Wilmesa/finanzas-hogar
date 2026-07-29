<script lang="ts">
  import {
    archiveAccount,
    createAccount,
    financeData,
    updateAccount,
  } from "$lib/finance-store";
  import type { AccountView } from "$lib/types";
  import { currency } from "$lib/demo";

  let creating = $state(false);
  let saving = $state(false);
  let error = $state("");
  let message = $state("");
  let editing = $state<AccountView | null>(null);
  let name = $state("");
  let type = $state("checking");
  let currencyCode = $state("COP");
  let scope = $state<"household" | "private">("household");
  let openingBalance = $state<number | undefined>();
  let ownerMemberId = $state<string | null>(null);
  let icon = $state("🏦");
  let color = $state("#123C69");

  function openCreate(selectedScope: "household" | "private" = "household") {
    editing = null;
    name = "";
    type = "checking";
    currencyCode = "COP";
    scope = selectedScope;
    openingBalance = undefined;
    ownerMemberId = null;
    icon = "🏦";
    color = "#123C69";
    creating = true;
    error = "";
  }

  function openEdit(account: AccountView) {
    editing = account;
    name = account.name;
    currencyCode = account.currency;
    scope = account.scope;
    ownerMemberId = account.ownerMemberId ?? null;
    icon = account.icon;
    color = account.color;
    creating = true;
    error = "";
  }

  async function save() {
    error = message = "";
    if (!name.trim()) {
      error = "Escribe un nombre para identificar la cuenta.";
      return;
    }
    saving = true;
    try {
      if (editing) {
        await updateAccount(editing, { name: name.trim(), currency: currencyCode, ownerMemberId, icon, color });
        message = "Cuenta actualizada en Firefly.";
      } else {
        await createAccount({
          name: name.trim(), type, currency: currencyCode, scope,
          ...(openingBalance !== undefined ? { openingBalance } : {}),
          ...(openingBalance !== undefined ? { openingBalanceDate: new Date().toISOString().slice(0, 10) } : {}),
          ownerMemberId,
          icon,
          color,
        });
        message = "Cuenta creada y disponible para registrar movimientos.";
      }
      creating = false;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No pudimos guardar la cuenta";
    } finally {
      saving = false;
    }
  }

  async function archive(account: AccountView) {
    if (!confirm(`¿Archivar ${account.name}? Sus movimientos no se borrarán.`)) return;
    error = "";
    try {
      await archiveAccount(account);
      message = "Cuenta archivada. El historial permanece en Firefly.";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No pudimos archivar la cuenta";
    }
  }
</script>

<div class="page">
  <header class="page-header">
    <div><span class="eyebrow">Fuente contable · Firefly III</span><h1>Cuentas</h1><p>Administra cuentas y tarjetas sin salir de OKLE.</p></div>
    <button class="primary-button" onclick={() => openCreate()}>＋ Nueva cuenta</button>
  </header>

  <div class="connection-grid">
    {#each $financeData.accountConnections as connection}
      <div class="connection-status" class:unavailable={connection.status !== "available"}>
        <span class="status-dot"></span>
        <div><strong>{connection.scope === "household" ? "Libro compartido" : "Mi libro privado"}</strong><small>{connection.status === "available" ? "Conectado y disponible" : connection.configured ? "No disponible temporalmente" : "Token pendiente de configurar"}</small></div>
      </div>
    {/each}
  </div>

  {#if creating}
    <section class="panel inline-entry">
      <header class="section-heading"><div><span class="eyebrow">{editing ? "Editar" : "Nueva"}</span><h2>{editing ? editing.name : "Configura la cuenta"}</h2></div><button class="icon-button" aria-label="Cerrar" onclick={() => (creating = false)}>×</button></header>
      <div class="form-grid">
        <label>Nombre<input bind:value={name} placeholder="Ej. Cuenta nómina" /></label>
        <label>Emoji<input maxlength="16" bind:value={icon} placeholder="🏦" /></label>
        <label>Color<input type="color" bind:value={color} /></label>
        {#if !editing}<label>Tipo<select bind:value={type}><option value="cash">Efectivo</option><option value="checking">Cuenta corriente</option><option value="savings">Ahorros</option><option value="digital_wallet">Billetera digital</option><option value="credit_card">Tarjeta de crédito</option><option value="investment">Inversión</option><option value="other_asset">Otro activo</option><option value="liability">Pasivo</option></select></label>{/if}
        <label>Moneda<select bind:value={currencyCode}><option>COP</option><option>USD</option><option>EUR</option></select></label>
        {#if !editing}<label>Alcance<select bind:value={scope}><option value="household">Compartida</option><option value="private">Solo yo</option></select></label><label>Saldo inicial opcional<input type="number" bind:value={openingBalance} /></label>{/if}
        {#if scope === "household"}<label>Cuenta a nombre de<select bind:value={ownerMemberId}><option value={null}>Del hogar</option>{#each $financeData.members as member}<option value={member.id}>{member.displayName}</option>{/each}</select></label>{/if}
      </div>
      <p class="privacy-note">El saldo proviene de Firefly. Un saldo inicial crea el asiento contable correspondiente; no es una reserva virtual.</p>
      {#if error}<p class="form-error" role="alert">{error}</p>{/if}
      <button class="primary-button" disabled={saving} onclick={save}>{saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear cuenta"}</button>
    </section>
  {/if}

  {#if message}<p class="success-message" role="status">{message}</p>{/if}
  {#if error && !creating}<p class="form-error" role="alert">{error}</p>{/if}

  {#each ["household", "private"] as accountScope}
    <section class="section-block">
      <header class="section-heading"><div><span class="eyebrow">{accountScope === "household" ? "Los dos miembros" : "Visible solo para ti"}</span><h2>{accountScope === "household" ? "Cuentas compartidas" : "Cuentas privadas"}</h2></div><button class="text-button" onclick={() => openCreate(accountScope as "household" | "private")}>＋ Crear</button></header>
      <div class="account-list panel">
        {#each $financeData.accounts.filter((account) => account.scope === accountScope) as account}
          <div class="account-row">
            <span class="account-icon" style={`background:${account.color}20;color:${account.color}`}>{account.icon}</span>
            <span><strong>{account.name}</strong><small>{account.ownerName} · {account.type} · {account.currency} · {account.scope === "private" ? "Solo yo" : "Compartida"}</small></span>
            <span class="account-totals"><strong>{currency(account.availableBalance, account.currency)} disponible</strong><small>{currency(account.currentBalance, account.currency)} real · {currency(account.reservedAmount, account.currency)} en bolsillos</small></span>
            <div class="row-actions"><button onclick={() => openEdit(account)}>Editar</button><button class="danger-action" onclick={() => archive(account)}>Archivar</button></div>
          </div>
        {/each}
        {#if !$financeData.accounts.some((account) => account.scope === accountScope)}
          <div class="empty-state"><strong>No existen cuentas disponibles</strong><p>Crea una cuenta para registrar tu primer movimiento en este alcance.</p><button class="secondary-link" onclick={() => openCreate(accountScope as "household" | "private")}>Crear cuenta</button></div>
        {/if}
      </div>
    </section>
  {/each}
</div>
