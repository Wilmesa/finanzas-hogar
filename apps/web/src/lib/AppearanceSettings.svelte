<script lang="ts">
  import { financeData, saveUiPreferences } from "$lib/finance-store";

  let primaryColor = $state($financeData.settings.uiPreferences.primaryColor);
  let accentColor = $state($financeData.settings.uiPreferences.accentColor);
  let saving = $state(false);
  let message = $state("");
  let error = $state("");

  const presets = [
    { name: "Azul y ámbar", primary: "#123C69", accent: "#B9862E" },
    { name: "Verde y dorado", primary: "#176B52", accent: "#D19A27" },
    { name: "Morado y coral", primary: "#553C9A", accent: "#D95D65" },
    { name: "Turquesa y azul", primary: "#087E8B", accent: "#2855A6" },
  ];

  function selectPreset(primary: string, accent: string) {
    primaryColor = primary;
    accentColor = accent;
  }

  async function save() {
    saving = true;
    error = message = "";
    try {
      await saveUiPreferences({
        ...$financeData.settings.uiPreferences,
        primaryColor,
        accentColor,
      });
      message = "Tus colores se guardaron solo para tu usuario.";
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "No pudimos guardar la apariencia";
    } finally {
      saving = false;
    }
  }
</script>

<section class="panel appearance-settings">
  <span class="eyebrow">Apariencia personal</span>
  <h2>Colores de mi interfaz</h2>
  <p>
    Cada miembro elige sus propios colores. El modo claro u oscuro permanece
    independiente.
  </p>
  <div class="appearance-presets">
    {#each presets as preset}
      <button
        type="button"
        aria-label={`Usar ${preset.name}`}
        title={preset.name}
        style={`--preset-primary:${preset.primary};--preset-accent:${preset.accent}`}
        onclick={() => selectPreset(preset.primary, preset.accent)}
      >
        <i></i><i></i><span>{preset.name}</span>
      </button>
    {/each}
  </div>
  <div class="form-row appearance-colors">
    <label
      >Color principal<input type="color" bind:value={primaryColor} /></label
    >
    <label>Color de acento<input type="color" bind:value={accentColor} /></label>
    <button class="primary-button" disabled={saving} onclick={save}
      >{saving ? "Guardando…" : "Guardar mis colores"}</button
    >
  </div>
  <small
    >Los colores de cada bolsillo se eligen al crearlo o desde
    <a href="/pockets">Bolsillos → Editar</a>.</small
  >
  {#if message}<p class="success-message" role="status">{message}</p>{/if}
  {#if error}<p class="form-error" role="alert">{error}</p>{/if}
</section>
