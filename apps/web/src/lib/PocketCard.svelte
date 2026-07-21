<script lang="ts">
  import type { PocketView } from "./types";
  import { currency } from "./demo";
  let { pocket }: { pocket: PocketView } = $props();
  const progress = $derived(Math.min(100, Math.round((pocket.currentAmount / pocket.targetAmount) * 100)));
</script>

<article class="pocket-card tone-{pocket.color}">
  <header>
    <span class="pocket-symbol" aria-hidden="true">{pocket.visibility === "private" ? "✦" : "↗"}</span>
    <span class="privacy">{pocket.visibility === "private" ? "Solo yo" : "Compartido"}</span>
  </header>
  <div>
    <h3>{pocket.name}</h3>
    <p>{pocket.purpose}</p>
  </div>
  <div class="amount-row">
    <strong>{currency(pocket.currentAmount, pocket.currency)}</strong>
    <span>de {currency(pocket.targetAmount, pocket.currency)}</span>
  </div>
  <div class="progress" aria-label={`${progress} por ciento completado`}>
    <span style={`width: ${progress}%`}></span>
  </div>
  <footer><span>{pocket.note}</span><b>{progress}%</b></footer>
</article>

