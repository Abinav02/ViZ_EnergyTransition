export function renderScatterplot(state) {
    const container = document.getElementById("scatterplot");
    container.textContent = `Scatterplot stub — level: ${state.level}, continent: ${state.selectedContinent ?? "none"}`;
}