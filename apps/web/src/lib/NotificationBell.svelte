<script lang="ts">
  import { apiRequest } from "$lib/api";
  import { isServerMode } from "$lib/auth";
  import { onMount } from "svelte";

  interface AppNotification {
    id: string;
    title: string;
    message: string;
    type: string;
    entityType?: string | null;
    entityId?: string | null;
    status: string;
    createdAt: string;
  }

  let notifications = $state<AppNotification[]>([]);
  let open = $state(false);
  const unread = $derived(
    notifications.filter((notification) => notification.status === "unread")
      .length,
  );

  onMount(async () => {
    if (!isServerMode()) return;
    try {
      notifications = await apiRequest<AppNotification[]>(
        "/v1/notifications/refresh",
        { method: "POST" },
      );
    } catch {
      notifications = [];
    }
  });

  async function markRead(notification: AppNotification) {
    if (notification.status === "read" || !isServerMode()) return;
    await apiRequest(`/v1/notifications/${notification.id}/read`, {
      method: "PATCH",
    });
    notification.status = "read";
    notifications = [...notifications];
  }

  function target(notification: AppNotification) {
    if (notification.type === "payment_due") return "/payments";
    if (notification.type === "income_confirmation") return "/planning";
    if (notification.entityType === "TransactionAttribution")
      return "/transactions";
    return "/calendar";
  }
</script>

<div class="notification-shell">
  <button
    class="notification-bell"
    aria-label={`Notificaciones${unread ? `, ${unread} sin leer` : ""}`}
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span aria-hidden="true">🔔</span>
    {#if unread}<b>{unread > 9 ? "9+" : unread}</b>{/if}
  </button>
  {#if open}
    <section class="notification-panel" aria-label="Notificaciones">
      <header><strong>Pendientes y avisos</strong><span><a href="/calendar">Calendario</a><button class="icon-button" aria-label="Cerrar notificaciones" onclick={() => (open = false)}>×</button></span></header>
      {#each notifications.slice(0, 10) as notification}
        <a
          class:unread={notification.status === "unread"}
          href={target(notification)}
          onclick={() => markRead(notification)}
        >
          <strong>{notification.title}</strong>
          <span>{notification.message}</span>
          <small>{new Date(notification.createdAt).toLocaleString("es-CO")}</small>
        </a>
      {/each}
      {#if notifications.length === 0}<p>No hay avisos pendientes.</p>{/if}
    </section>
  {/if}
</div>
