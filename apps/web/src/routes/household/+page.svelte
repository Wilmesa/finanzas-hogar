<script lang="ts">
  import {
    financeData,
    updateHousehold,
    updateProfile,
  } from "$lib/finance-store";
  import {
    authMode,
    changeLocalPassword,
    isServerMode,
  } from "$lib/auth";
  import { apiRequest } from "$lib/api";
  import { onMount } from "svelte";

  let displayName = $state($financeData.settings.memberName);
  let color = $state($financeData.settings.memberColor);
  let householdName = $state($financeData.settings.householdName);
  let baseCurrency = $state($financeData.settings.baseCurrency);
  let message = $state("");
  let error = $state("");
  let saving = $state(false);
  let currentPassword = $state("");
  let newPassword = $state("");
  let activeSessions = $state<number | null>(null);
  let invitationLink = $state("");
  let invitationExpiresAt = $state("");

  onMount(async () => {
    if (!isServerMode() || authMode() !== "local") return;
    const result = await apiRequest<{
      supported: boolean;
      sessions: unknown[];
    }>("/v1/auth/sessions");
    if (result.supported) activeSessions = result.sessions.length;
  });

  async function saveProfile() {
    saving = true;
    error = message = "";
    try {
      await updateProfile({ displayName, color });
      message = "Tu perfil quedó actualizado.";
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "No pudimos actualizar el perfil";
    } finally {
      saving = false;
    }
  }

  async function saveHousehold() {
    saving = true;
    error = message = "";
    try {
      await updateHousehold({ name: householdName, baseCurrency });
      message = "La configuración del hogar quedó actualizada.";
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "No pudimos actualizar el hogar";
    } finally {
      saving = false;
    }
  }

  async function changePassword() {
    saving = true;
    error = message = "";
    try {
      await changeLocalPassword(currentPassword, newPassword);
      location.assign("/");
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "No pudimos cambiar la contraseña";
    } finally {
      saving = false;
    }
  }

  async function closeSessions() {
    await apiRequest("/v1/auth/logout-all", { method: "POST" });
    location.assign("/");
  }

  async function invitePartner() {
    saving = true;
    error = message = "";
    try {
      const invitation = await apiRequest<{
        token: string;
        expiresAt: string;
      }>("/v1/household/invitations", { method: "POST" });
      invitationLink = `${location.origin}/?invite=${encodeURIComponent(invitation.token)}`;
      invitationExpiresAt = invitation.expiresAt;
      try {
        await navigator.clipboard.writeText(invitationLink);
        message = "Enlace copiado. Envíalo a tu pareja; vence en 24 horas.";
      } catch {
        message =
          "Invitación creada. Copia el enlace mostrado y envíalo a tu pareja.";
      }
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "No pudimos crear la invitación";
    } finally {
      saving = false;
    }
  }
</script>

<div class="page">
  <header class="page-header">
    <div>
      <span class="eyebrow">Identidad y permisos</span>
      <h1>Hogar y perfiles</h1>
      <p>Los nombres que aparecen al registrar y analizar movimientos viven aquí.</p>
    </div>
  </header>

  <section class="profile-grid">
    <article class="panel">
      <span class="eyebrow">Mi perfil</span>
      <h2>{$financeData.settings.memberRole === "owner"
          ? "Propietario"
          : "Miembro"}</h2>
      <label>Nombre visible<input bind:value={displayName} /></label>
      <label>Color identificador<input type="color" bind:value={color} /></label>
      <label
        >Usuario o correo<input
          value={$financeData.settings.memberEmail}
          disabled
        /></label
      >
      <button class="primary-button" disabled={saving} onclick={saveProfile}
        >Guardar perfil</button
      >
    </article>
    <article class="panel">
      <span class="eyebrow">Miembros</span>
      <h2>{$financeData.settings.householdName}</h2>
      <div class="member-list">
        {#each $financeData.members as member}
          <div class="member-row">
            <span class="avatar" style={`background:${member.color}`}
              >{member.avatar ??
                member.displayName.slice(0, 1).toUpperCase()}</span
            >
            <span
              ><strong>{member.displayName}</strong><small
                >{member.username ?? member.email} · {member.role === "owner"
                  ? "Propietario"
                  : "Miembro"}</small
              ></span
            >
          </div>
        {/each}
      </div>
    </article>
  </section>

  {#if $financeData.settings.memberRole === "owner"}
    <section class="panel section-block">
      <span class="eyebrow">Configuración del hogar</span>
      <h2>Datos compartidos</h2>
      <div class="form-grid">
        <label>Nombre del hogar<input bind:value={householdName} /></label>
        <label
          >Moneda base<select bind:value={baseCurrency}
            ><option>COP</option><option>USD</option><option>EUR</option></select
          ></label
        >
      </div>
      <button class="primary-button" disabled={saving} onclick={saveHousehold}
        >Guardar hogar</button
      >
    </section>
  {/if}

  {#if isServerMode() && authMode() === "local" && $financeData.settings.memberRole === "owner"}
    <section class="panel section-block">
      <span class="eyebrow">Pareja</span>
      <h2>{$financeData.members.length >= 2
          ? "Hogar vinculado"
          : "Invita a tu pareja"}</h2>
      {#if $financeData.members.length >= 2}
        <p>Los dos accesos personales ya pertenecen al mismo hogar.</p>
      {:else}
        <p>Un clic crea un enlace de un solo uso. Tu pareja abre el enlace, define su contraseña y queda vinculada al hogar.</p>
        <button
          class="primary-button"
          disabled={saving}
          onclick={invitePartner}>Crear y copiar invitación</button
        >
        {#if invitationLink}
          <label class="wide-field"
            >Enlace de invitación<input
              value={invitationLink}
              readonly
              onclick={(event) =>
                (event.currentTarget as HTMLInputElement).select()}
            /><small
              >Vence {new Date(invitationExpiresAt).toLocaleString(
                "es-CO",
              )} y solo puede usarse una vez.</small
            ></label
          >
        {/if}
      {/if}
    </section>
  {/if}

  {#if isServerMode() && authMode() === "local"}
    <section class="panel section-block">
      <span class="eyebrow">Seguridad</span>
      <h2>Cambiar contraseña</h2>
      <p>{activeSessions === null
          ? "Consultando sesiones…"
          : `${activeSessions} sesión(es) activas`}</p>
      <div class="form-grid">
        <label
          >Contraseña actual<input
            type="password"
            bind:value={currentPassword}
          /></label
        >
        <label
          >Nueva contraseña<input
            type="password"
            minlength="12"
            bind:value={newPassword}
          /></label
        >
      </div>
      <div class="row-actions">
        <button
          class="primary-button"
          disabled={saving}
          onclick={changePassword}>Cambiar contraseña</button
        >
        <button class="danger-action" onclick={closeSessions}
          >Cerrar mis sesiones</button
        >
      </div>
    </section>
  {/if}

  {#if message}<p class="success-message" role="status">{message}</p>{/if}
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
</div>
