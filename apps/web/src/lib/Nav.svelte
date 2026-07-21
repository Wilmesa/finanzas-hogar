<script lang="ts">
  import { page } from "$app/state";

  const items = [
    { href: "/", label: "Hoy", icon: "⌂" },
    { href: "/pockets", label: "Bolsillos", icon: "◫" },
    { href: "/transactions", label: "Movimientos", icon: "↕" },
    { href: "/planning", label: "Plan", icon: "⌁" },
    { href: "/more", label: "Más", icon: "•••" },
  ];
</script>

<aside class="nav-shell" aria-label="Navegación principal">
  <a class="brand" href="/" aria-label="Nuestro Dinero, inicio">
    <span class="brand-mark">N</span>
    <span>Nuestro Dinero</span>
  </a>
  <nav>
    {#each items as item}
      <a href={item.href} class:active={page.url.pathname === item.href || (item.href === "/planning" && page.url.pathname === "/future")} aria-current={page.url.pathname === item.href ? "page" : undefined}>
        <span class="nav-icon" aria-hidden="true">{item.icon}</span>
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>
  <div class="member">
    <span class="avatar">A</span>
    <span><strong>Ana</strong><small>Nuestro hogar</small></span>
  </div>
</aside>
