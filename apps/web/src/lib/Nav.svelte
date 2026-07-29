<script lang="ts">
  import { page } from "$app/state";
  import { financeData } from "$lib/finance-store";
  import { apiRequest } from "$lib/api";
  import { isServerMode } from "$lib/auth";
  import { onMount } from "svelte";

  let duePayments = $state(0);
  onMount(async () => {
    if (!isServerMode()) return;
    try {
      duePayments = (await apiRequest<{ count: number }>("/v1/payments/due-count")).count;
      const badgeNavigator = navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void> };
      if (badgeNavigator.setAppBadge) await badgeNavigator.setAppBadge(duePayments);
    } catch { /* El distintivo no debe bloquear la navegación. */ }
  });

  const items = [
    { href: "/", label: "Inicio", icon: "home" },
    { href: "/transactions", label: "Movimientos", icon: "movement" },
    { href: "/pockets", label: "Bolsillos", icon: "wallet" },
    { href: "/payments", label: "Pagos", icon: "payment" },
    { href: "/more", label: "Más", icon: "more" },
  ];
</script>

<aside class="nav-shell" aria-label="Navegación principal">
  <a class="brand" href="/" aria-label="OKLE, inicio">
    <img class="brand-logo" src="/icons/okle-master.png" alt="" aria-hidden="true" />
    <span>OKLE</span>
  </a>
  <nav>
    {#each items as item}
      <a href={item.href} class:active={page.url.pathname === item.href} aria-current={page.url.pathname === item.href ? "page" : undefined}>
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          {#if item.icon === "home"}<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
          {:else if item.icon === "movement"}<path d="M7 3v18m0 0-3-3m3 3 3-3M17 21V3m0 0-3 3m3-3 3 3" />
          {:else if item.icon === "wallet"}<path d="M4 5h14a2 2 0 0 1 2 2v12H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 0V3h13" /><path d="M16 11h4v4h-4a2 2 0 1 1 0-4Z" />
          {:else if item.icon === "payment"}<rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 15h4" />
          {:else}<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />{/if}
        </svg>
        <span>{item.label}</span>
        {#if item.href === "/payments" && duePayments > 0}<span class="nav-badge primary-nav-badge" aria-label={`${duePayments} pagos pendientes`}>{duePayments}</span>{/if}
      </a>
    {/each}
  </nav>
  <div class="secondary-nav">
    <span class="secondary-label">Planificación</span>
    <a class:active={page.url.pathname === "/planning" || page.url.pathname === "/future"} href="/planning">Plan financiero</a>
    <a class:active={page.url.pathname === "/copilot"} href="/copilot">Asesor IA</a>
    <a class:active={page.url.pathname === "/accounts"} href="/accounts">Cuentas y tarjetas</a>
    <a class:active={page.url.pathname === "/household"} href="/household">Hogar y perfiles</a>
    <a class:active={page.url.pathname === "/calendar"} href="/calendar">Calendario</a>
  </div>
  <div class="member">
    <span class="avatar" style={`background:${$financeData.settings.memberColor}`}>
      {$financeData.settings.memberAvatar ?? $financeData.settings.memberName.slice(0, 1).toUpperCase()}
    </span>
    <span><strong>{$financeData.settings.memberName || "Perfil"}</strong><small>{$financeData.settings.householdName || "Hogar"}</small></span>
  </div>
</aside>
