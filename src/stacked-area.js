export function renderStackedArea(state) {
    const container = document.getElementById("stacked-area");
    container.textContent = `Stacked-area stub — country: ${state.selectedCountry ?? "aggregate"}`;
}