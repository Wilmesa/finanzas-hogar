<script lang="ts">
  import { page } from "$app/state";
  import { financeData } from "$lib/finance-store";

  const items = [
    { href: "/", label: "Hoy", icon: "⌂" },
    { href: "/planning", label: "Futuro", icon: "⌁" },
    { href: "/patrimony", label: "Patrimonio", icon: "◇" },
    { href: "/copilot", label: "Copiloto", icon: "✦" },
    { href: "/transactions", label: "Movimientos", icon: "↕" },
  ];
</script>

<aside class="nav-shell" aria-label="Navegación principal">
  <a class="brand" href="/" aria-label="FinNest, inicio">
    <span class="brand-mark">F</span>
    <span>FinNest</span>
  </a>
  <nav>
    {#each items as item}
      <a href={item.href} class:active={page.url.pathname === item.href || (item.href === "/planning" && page.url.pathname === "/future")} aria-current={page.url.pathname === item.href ? "page" : undefined}>
        <span class="nav-icon" aria-hidden="true">{item.icon}</span>
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>
  <div class="secondary-nav">
    <a href="/pockets">Bolsillos</a>
    <a href="/accounts">Cuentas</a>
    <a href="/more">Configuración</a>
  </div>
  <div class="member">
    <span class="avatar" style={`background:${$financeData.settings.memberColor}`}>
      {$financeData.settings.memberAvatar ?? $financeData.settings.memberName.slice(0, 1).toUpperCase()}
    </span>
    <span><strong>{$financeData.settings.memberName || "Perfil"}</strong><small>{$financeData.settings.householdName || "Hogar"}</small></span>
  </div>
</aside>
