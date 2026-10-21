import { CLASSES, type ClassId } from "../data";

const ICONS: Record<ClassId, string> = { warrior: "⚔️", dualblade: "🗡️", mage: "🔮", archer: "🏹" };

/** Relative bars on the cards, 0..1. */
function ratings(id: ClassId) {
  const c = CLASSES[id];
  return [
    { label: "Life", value: c.baseHp / 120 },
    { label: "Damage", value: c.damageMult / 1.25 },
    { label: "Range", value: c.attack.range / 14 },
    { label: "Speed", value: (c.moveSpeed * c.attack.animSpeed) / 2.5 },
  ];
}

/** Full-screen "choose your class" picker for a new character. Resolves with the chosen class. */
export function chooseClass(): Promise<ClassId> {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.id = "class-select";
    const cards = (Object.keys(CLASSES) as ClassId[])
      .map((id) => {
        const c = CLASSES[id];
        const bars = ratings(id)
          .map((r) => `<div class="cs-bar"><span>${r.label}</span><i style="--v:${Math.min(1, r.value)}"></i></div>`)
          .join("");
        return `<button class="cs-card" data-class="${id}" style="--tint:${c.tint}">
          <div class="cs-icon">${ICONS[id]}</div>
          <h3>${c.name}</h3>
          <p>${c.description}</p>
          ${bars}
        </button>`;
      })
      .join("");
    root.innerHTML = `<h1>Choose your class</h1><div class="cs-grid">${cards}</div>`;
    root.addEventListener("click", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>("[data-class]");
      if (!card) return;
      root.remove();
      resolve(card.dataset.class as ClassId);
    });
    document.body.appendChild(root);
  });
}
