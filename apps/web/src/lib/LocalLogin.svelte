<script lang="ts">
  import {
    inspectHouseholdInvitation,
    joinLocalHousehold,
    localSetupStatus,
    loginLocal,
    setupLocalHousehold,
  } from "$lib/auth";
  import { onMount } from "svelte";

  let { onSuccess }: { onSuccess: () => Promise<void> | void } = $props();
  let mode = $state<"checking" | "login" | "setup" | "join">("checking");
  let identifier = $state("");
  let householdName = $state("");
  let displayName = $state("");
  let email = $state("");
  let username = $state("");
  let password = $state("");
  let confirmPassword = $state("");
  let invitationToken = $state("");
  let invitationHousehold = $state("");
  let error = $state("");
  let submitting = $state(false);

  onMount(async () => {
    invitationToken = new URLSearchParams(location.search).get("invite") ?? "";
    try {
      if (invitationToken) {
        const invitation = await inspectHouseholdInvitation(invitationToken);
        invitationHousehold = invitation.householdName;
        mode = "join";
        return;
      }
      const status = await localSetupStatus();
      mode = status.registrationAvailable ? "setup" : "login";
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "No fue posible comprobar el acceso";
      mode = "login";
    }
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    if (mode !== "login" && password !== confirmPassword) {
      error = "Las contraseñas no coinciden.";
      return;
    }
    submitting = true;
    try {
      if (mode === "login") {
        await loginLocal(identifier, password);
      } else if (mode === "setup") {
        await setupLocalHousehold({
          householdName,
          displayName,
          email,
          username,
          password,
        });
      } else if (mode === "join") {
        await joinLocalHousehold({
          token: invitationToken,
          displayName,
          email,
          username,
          password,
        });
        history.replaceState({}, "", "/");
      }
      password = "";
      confirmPassword = "";
      await onSuccess();
    } catch (cause) {
      error =
        cause instanceof Error ? cause.message : "No fue posible continuar";
    } finally {
      submitting = false;
    }
  }
</script>

{#if mode === "checking"}
  <p>Comprobando acceso…</p>
{:else}
  <form class="auth-form" onsubmit={submit}>
    {#if mode === "setup"}
      <div class="auth-form-intro">
        <strong>Crea el hogar en un solo paso</strong>
        <small>Serás la persona propietaria y luego podrás invitar a tu pareja.</small>
      </div>
      <label
        >Nombre del hogar<input
          name="householdName"
          autocomplete="organization"
          bind:value={householdName}
          required
          minlength="2"
          maxlength="80"
          placeholder="Nuestro hogar"
        /></label
      >
    {:else if mode === "join"}
      <div class="auth-form-intro">
        <strong>Únete a {invitationHousehold}</strong>
        <small>Crea tu acceso personal. Tus bolsillos privados seguirán siendo solo tuyos.</small>
      </div>
    {/if}

    {#if mode === "login"}
      <label
        >Correo o usuario<input
          name="identifier"
          autocomplete="username"
          bind:value={identifier}
          required
          maxlength="254"
        /></label
      >
    {:else}
      <label
        >Tu nombre<input
          name="displayName"
          autocomplete="name"
          bind:value={displayName}
          required
          minlength="2"
          maxlength="60"
        /></label
      >
      <label
        >Correo<input
          name="email"
          type="email"
          autocomplete="email"
          bind:value={email}
          required
          maxlength="254"
        /></label
      >
      <label
        >Usuario<input
          name="username"
          autocomplete="username"
          bind:value={username}
          required
          minlength="3"
          maxlength="32"
          pattern="[a-zA-Z0-9._-]+"
        /><small>De 3 a 32 caracteres: letras, números, punto, guion o guion bajo.</small></label
      >
    {/if}

    <label
      >Contraseña<input
        name="password"
        type="password"
        autocomplete={mode === "login" ? "current-password" : "new-password"}
        bind:value={password}
        required
        minlength={mode === "login" ? 1 : 12}
        maxlength="128"
      />{#if mode !== "login"}<small>Usa al menos 12 caracteres.</small>{/if}</label
    >
    {#if mode !== "login"}
      <label
        >Repetir contraseña<input
          name="confirmPassword"
          type="password"
          autocomplete="new-password"
          bind:value={confirmPassword}
          required
          minlength="12"
          maxlength="128"
        /></label
      >
    {/if}

    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    <button class="primary-button" type="submit" disabled={submitting}>
      {submitting
        ? "Guardando…"
        : mode === "setup"
          ? "Crear hogar y entrar"
          : mode === "join"
            ? "Crear cuenta y unirme"
            : "Ingresar"}
    </button>
    {#if mode === "login"}
      <p class="auth-help">¿Es tu primera vez? Pide a tu pareja el enlace de invitación desde <strong>Hogar y perfiles</strong>.</p>
    {/if}
  </form>
{/if}
