<script lang="ts">
  import { loginLocal } from "$lib/auth";

  let { onSuccess }: { onSuccess: () => Promise<void> | void } = $props();
  let identifier = $state("");
  let password = $state("");
  let error = $state("");
  let submitting = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    submitting = true;
    try {
      await loginLocal(identifier, password);
      password = "";
      await onSuccess();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No fue posible iniciar sesión";
    } finally {
      submitting = false;
    }
  }
</script>

<form class="auth-form" onsubmit={submit}>
  <label>Correo o usuario<input name="identifier" autocomplete="username" bind:value={identifier} required maxlength="254" /></label>
  <label>Contraseña<input name="password" type="password" autocomplete="current-password" bind:value={password} required maxlength="128" /></label>
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  <button class="primary-button" type="submit" disabled={submitting}>{submitting ? "Ingresando…" : "Ingresar"}</button>
</form>
