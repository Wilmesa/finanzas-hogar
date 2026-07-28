<script lang="ts">
  import { apiRequest } from "$lib/api";
  import { isServerMode } from "$lib/auth";
  import { onMount } from "svelte";

  interface IntegrationStatus {
    editable: boolean;
    trm: {
      dailySyncEnabled: boolean;
      primarySource: string;
      fallbackSource: string;
      lastSync: {
        rate: string;
        effectiveDate: string;
        fetchedAt: string;
        source: string;
        sourceUrl?: string | null;
      } | null;
    };
    openFinance: {
      mode: "disabled" | "sandbox";
      sandboxAvailable: boolean;
      providerConnected: boolean;
      providerName: string | null;
    };
  }

  let status = $state<IntegrationStatus | null>(null);
  let trmDailySyncEnabled = $state(false);
  let openFinanceMode = $state<"disabled" | "sandbox">("disabled");
  let saving = $state(false);
  let message = $state("");
  let error = $state("");

  function apply(result: IntegrationStatus) {
    status = result;
    trmDailySyncEnabled = result.trm.dailySyncEnabled;
    openFinanceMode = result.openFinance.mode;
  }

  onMount(async () => {
    if (!isServerMode()) return;
    try {
      apply(await apiRequest<IntegrationStatus>("/v1/integrations"));
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "No fue posible consultar las integraciones";
    }
  });

  async function save() {
    saving = true;
    error = message = "";
    try {
      apply(
        await apiRequest<IntegrationStatus>("/v1/integrations", {
          method: "PATCH",
          body: JSON.stringify({
            trmDailySyncEnabled,
            openFinanceMode,
          }),
        }),
      );
      message = "Integraciones actualizadas.";
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "No fue posible guardar las integraciones";
    } finally {
      saving = false;
    }
  }

  async function refreshTrm() {
    saving = true;
    error = message = "";
    try {
      const result = await apiRequest<{
        rate: string;
        source: string;
      }>("/v1/integrations/trm/refresh", { method: "POST" });
      message = `TRM actualizada: ${Number(result.rate).toLocaleString("es-CO")} COP por USD · ${result.source}.`;
      apply(await apiRequest<IntegrationStatus>("/v1/integrations"));
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "No fue posible actualizar la TRM";
    } finally {
      saving = false;
    }
  }
</script>

{#if isServerMode()}
  <section class="panel section-block integrations-panel">
    <div class="section-heading">
      <div>
        <span class="eyebrow">Conexiones financieras</span>
        <h2>TRM y automatización bancaria</h2>
      </div>
    </div>
    {#if !status && !error}
      <p>Consultando integraciones…</p>
    {:else if status}
      <div class="integration-grid">
        <article class="panel-card">
          <span class="eyebrow">USD / COP</span>
          <h3>TRM oficial</h3>
          <p>La fuente primaria es la Superintendencia Financiera; Datos Abiertos solo se usa como respaldo.</p>
          <label class="switch-row">
            <input
              type="checkbox"
              bind:checked={trmDailySyncEnabled}
              disabled={!status.editable}
            />
            <span>Actualizar automáticamente una vez al día</span>
          </label>
          {#if status.trm.lastSync}
            <small
              >Última tasa: {Number(
                status.trm.lastSync.rate,
              ).toLocaleString("es-CO")} COP · {status.trm.lastSync.source} ·
              {new Date(
                status.trm.lastSync.fetchedAt,
              ).toLocaleString("es-CO")}</small
            >
          {:else}
            <small>Aún no hay una TRM guardada.</small>
          {/if}
          {#if status.editable}
            <button
              class="secondary-button"
              disabled={saving}
              onclick={refreshTrm}>Actualizar ahora</button
            >
          {/if}
        </article>
        <article class="panel-card">
          <span class="eyebrow">Finanzas Abiertas</span>
          <h3>Automatización bancaria</h3>
          <p>OKLE revisa movimientos importados antes de incorporarlos. Un proveedor bancario real todavía no está conectado.</p>
          <label
            >Modo<select
              bind:value={openFinanceMode}
              disabled={!status.editable}
            >
              <option value="disabled">Registro manual</option>
              <option
                value="sandbox"
                disabled={!status.openFinance.sandboxAvailable}
                >Sandbox de prueba</option
              >
            </select></label
          >
          <small
            >{status.openFinance.sandboxAvailable
              ? "El sandbox firmado está disponible para probar pending → posted sin duplicados."
              : "El administrador debe habilitar el sandbox firmado en el servidor."}</small
          >
          <small>Para bancos reales se necesita un proveedor autorizado, consentimiento y credenciales propias.</small>
        </article>
      </div>
      {#if status.editable}
        <button class="primary-button" disabled={saving} onclick={save}
          >Guardar integraciones</button
        >
      {/if}
    {/if}
    {#if message}<p class="success-message" role="status">{message}</p>{/if}
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
  </section>
{/if}
