// main.js
import { loadData } from "./data.js";
import { subscribe } from "./state.js";
import { renderHeatmap } from "./heatmap.js";
import { renderScatterplot } from "./scatterplot.js";
import { renderStackedArea } from "./stacked-area.js";

async function init() {
    await loadData();

    const heatmapEl = document.getElementById("heatmap");
    const scatterEl = document.getElementById("scatterplot");
    const stackEl   = document.getElementById("stacked-area");

    subscribe(state => {
        renderHeatmap(heatmapEl, state);
        renderScatterplot(scatterEl, state);
        renderStackedArea(stackEl, state);
    });
}

init();