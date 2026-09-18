import * as d3 from "d3";
import {
    CONTINENTS,
    getAllCountryRows,
    getCountriesInContinent,
    getContinentForIso,
} from "./data.js";
import { selectContinent, selectCountry } from "./state.js";

// A fixed comparison window makes "fastest" comparable between countries.
// 2025 is deliberately excluded because its country coverage is incomplete.
const START_YEAR = 2000;
const END_YEAR = 2024;
const GDP_YEAR = 2022; // latest year with broad GDP coverage in this dataset

const MARGIN = { top: 20, right: 24, bottom: 58, left: 72 };
const HEIGHT = 460;
const MIN_WIDTH = 600;

const CONTINENT_COLORS = new Map([
    ["Africa", "#b7791f"],
    ["Asia", "#d1495b"],
    ["Europe", "#3769b0"],
    ["North America", "#7a5195"],
    ["South America", "#238b8d"],
    ["Oceania", "#5c8a3c"],
]);

let top25Only = false;
let tooltip;

function getTooltip() {
    if (!tooltip) {
        tooltip = d3.select("body")
            .append("div")
            .attr("class", "scatter-tooltip")
            .style("position", "absolute")
            .style("pointer-events", "none")
            .style("opacity", 0);
    }
    return tooltip;
}

function valueAt(rows, year, key) {
    const row = rows.find(d => Number(d.year) === year);
    const value = row?.[key];
    return value == null || Number.isNaN(Number(value)) ? null : Number(value);
}

function dominantLowCarbonSource(row) {
    if (!row) return "No source breakdown";
    const sources = [
        ["Hydro", row.hydro_share_elec],
        ["Nuclear", row.nuclear_share_elec],
        ["Wind", row.wind_share_elec],
        ["Solar", row.solar_share_elec],
        ["Bioenergy + other", row.other_renewables_share_elec],
    ].filter(([, value]) => value != null && Number.isFinite(Number(value)));
    if (!sources.length) return "No source breakdown";
    sources.sort((a, b) => Number(b[1]) - Number(a[1]));
    return `${sources[0][0]} (${Number(sources[0][1]).toFixed(1)}%)`;
}

function buildPoints(rows) {
    return Array.from(d3.group(rows, d => d.country), ([country, series]) => {
        const startShare = valueAt(series, START_YEAR, "low_carbon_share_elec");
        const endShare = valueAt(series, END_YEAR, "low_carbon_share_elec");
        const gdp = valueAt(series, GDP_YEAR, "gdp");
        const population = valueAt(series, GDP_YEAR, "population");
        const endRow = series.find(d => Number(d.year) === END_YEAR);
        const generation = valueAt(series, END_YEAR, "electricity_generation");
        const iso = series.find(d => d.iso_code)?.iso_code;
        const continent = getContinentForIso(iso);

        if (
            startShare == null || endShare == null ||
            gdp == null || population == null || population <= 0 ||
            !continent
        ) return null;

        const delta = endShare - startShare;
        return {
            country,
            iso,
            continent,
            gdpPerCapita: gdp / population,
            speed: delta / (END_YEAR - START_YEAR),
            delta,
            startShare,
            endShare,
            generation: generation > 0 ? generation : null,
            dominantSource: dominantLowCarbonSource(endRow),
        };
    }).filter(Boolean);
}

function linearFit(points) {
    if (points.length < 2) return null;
    const xs = points.map(d => Math.log10(d.gdpPerCapita));
    const ys = points.map(d => d.speed);
    const xMean = d3.mean(xs);
    const yMean = d3.mean(ys);
    const denominator = d3.sum(xs, x => (x - xMean) ** 2);
    if (!denominator) return null;
    const slope = d3.sum(xs.map((x, i) => (x - xMean) * (ys[i] - yMean))) / denominator;
    const intercept = yMean - slope * xMean;
    return x => intercept + slope * Math.log10(x);
}

function drawLegend(container, continents) {
    const legend = d3.select(container).append("div").attr("class", "scatter-legend");
    continents.forEach(continent => {
        const item = legend.append("span").attr("class", "scatter-legend-item");
        item.append("span")
            .attr("class", "scatter-legend-dot")
            .style("background", CONTINENT_COLORS.get(continent));
        item.append("span").text(continent);
    });
}

export function renderScatterplot(container, state) {
    const el = typeof container === "string" ? document.querySelector(container) : container;
    if (!el) return;
    d3.select(el).selectAll("*").remove();

    const sourceRows = state.selectedContinent
        ? getCountriesInContinent(state.selectedContinent)
        : getAllCountryRows();
    let points = buildPoints(sourceRows);
    const totalComparable = points.length;

    if (top25Only) {
        points = points
            .slice()
            .sort((a, b) => b.gdpPerCapita - a.gdpPerCapita)
            .slice(0, 25);
    }

    const header = d3.select(el).append("div").attr("class", "view-header scatter-header");
    const headerLeft = header.append("div").attr("class", "header-left");
    headerLeft.append("h2").text("Wealth and speed of the low-carbon transition");
    headerLeft.append("p")
        .attr("class", "scatter-subtitle")
        .text(`${state.selectedContinent ?? "All countries"} · fixed comparison ${START_YEAR}–${END_YEAR}`);

    const control = header.append("label").attr("class", "scatter-filter");
    control.append("input")
        .attr("type", "checkbox")
        .property("checked", top25Only)
        .on("change", function () {
            top25Only = this.checked;
            renderScatterplot(el, state);
        });
    control.append("span").text("Top 25 by GDP per capita");

    if (!points.length) {
        d3.select(el).append("p").attr("class", "scatter-empty")
            .text("No countries have comparable electricity and GDP data for this view.");
        return;
    }

    const shownContinents = CONTINENTS.filter(c => points.some(d => d.continent === c));
    drawLegend(headerLeft.node(), shownContinents);

    const outerW = Math.max(el.clientWidth || MIN_WIDTH, MIN_WIDTH);
    const innerW = outerW - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    const xExtent = d3.extent(points, d => d.gdpPerCapita);
    const yExtent = d3.extent(points, d => d.speed);
    const yPad = Math.max(0.08, (yExtent[1] - yExtent[0]) * 0.1);
    const x = d3.scaleLog()
        .domain([Math.max(200, xExtent[0] * 0.8), xExtent[1] * 1.2])
        .range([0, innerW])
        .nice();
    const y = d3.scaleLinear()
        .domain([Math.min(0, yExtent[0] - yPad), yExtent[1] + yPad])
        .range([innerH, 0])
        .nice();
    const sizeValues = points.map(d => d.generation).filter(v => v > 0);
    const radius = d3.scaleSqrt()
        .domain(sizeValues.length ? d3.extent(sizeValues) : [1, 2])
        .range([4, 15]);

    const svg = d3.select(el).append("svg")
        .attr("class", "scatter-svg")
        .attr("viewBox", `0 0 ${outerW} ${HEIGHT}`)
        .attr("width", outerW)
        .attr("height", HEIGHT)
        .attr("role", "img")
        .attr("aria-label", `Scatterplot of GDP per capita in ${GDP_YEAR} and annual low-carbon electricity transition speed from ${START_YEAR} to ${END_YEAR}.`);
    const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    g.append("g").attr("class", "scatter-grid")
        .call(d3.axisLeft(y).ticks(6).tickSize(-innerW).tickFormat(""))
        .call(sel => sel.select(".domain").remove());

    if (y.domain()[0] <= 0 && y.domain()[1] >= 0) {
        g.append("line").attr("class", "scatter-zero")
            .attr("x1", 0).attr("x2", innerW)
            .attr("y1", y(0)).attr("y2", y(0));
    }

    const fit = linearFit(points);
    if (fit) {
        const [x0, x1] = x.domain();
        g.append("line").attr("class", "scatter-trend")
            .attr("x1", x(x0)).attr("y1", y(fit(x0)))
            .attr("x2", x(x1)).attr("y2", y(fit(x1)));
    }

    const tip = getTooltip();
    const selected = state.selectedCountry;
    const circles = g.append("g").attr("class", "scatter-points")
        .selectAll("circle")
        .data(points, d => d.country)
        .join("circle")
        .attr("cx", d => x(d.gdpPerCapita))
        .attr("cy", d => y(d.speed))
        .attr("r", d => d.generation ? radius(d.generation) : 5)
        .attr("fill", d => CONTINENT_COLORS.get(d.continent))
        .attr("fill-opacity", d => selected && d.country !== selected ? 0.3 : 0.72)
        .attr("stroke", d => d.country === selected ? "#0b2545" : "#ffffff")
        .attr("stroke-width", d => d.country === selected ? 3 : 1)
        .style("cursor", "pointer");

    circles
        .on("mouseover", function (event, d) {
            d3.select(this).attr("fill-opacity", 1).attr("stroke-width", 2);
            const sign = d.delta >= 0 ? "+" : "";
            tip.style("opacity", 1).html(`
                <div class="scatter-tip-head"><strong>${d.country}</strong> · ${d.continent}</div>
                <div class="scatter-tip-row"><span>GDP per capita (${GDP_YEAR})</span><strong>${d3.format("$,.0f")(d.gdpPerCapita)}</strong></div>
                <div class="scatter-tip-row"><span>Low-carbon share (${START_YEAR})</span><strong>${d.startShare.toFixed(1)}%</strong></div>
                <div class="scatter-tip-row"><span>Low-carbon share (${END_YEAR})</span><strong>${d.endShare.toFixed(1)}%</strong></div>
                <div class="scatter-tip-row"><span>Total change</span><strong>${sign}${d.delta.toFixed(1)} pp</strong></div>
                <div class="scatter-tip-row"><span>Transition speed</span><strong>${sign}${d.speed.toFixed(2)} pp/year</strong></div>
                <div class="scatter-tip-row"><span>Largest low-carbon source</span><strong>${d.dominantSource}</strong></div>
                ${d.generation ? `<div class="scatter-tip-row"><span>Electricity generation (${END_YEAR})</span><strong>${d3.format(",.1f")(d.generation)} TWh</strong></div>` : ""}
                <div class="scatter-tip-action">Click to show this country in the linked views.</div>
            `);
        })
        .on("mousemove", event => {
            tip.style("left", `${event.pageX + 12}px`).style("top", `${event.pageY + 12}px`);
        })
        .on("mouseout", function (event, d) {
            d3.select(this)
                .attr("fill-opacity", selected && d.country !== selected ? 0.3 : 0.72)
                .attr("stroke-width", d.country === selected ? 3 : 1);
            tip.style("opacity", 0);
        })
        .on("click", (event, d) => {
            if (state.selectedContinent !== d.continent) selectContinent(d.continent);
            selectCountry(d.country);
        });

    const xAxis = d3.axisBottom(x)
        .ticks(6, "~s")
        .tickFormat(d3.format("$~s"));
    g.append("g").attr("class", "scatter-x-axis")
        .attr("transform", `translate(0,${innerH})`).call(xAxis);
    g.append("g").attr("class", "scatter-y-axis")
        .call(d3.axisLeft(y).ticks(6).tickFormat(d => `${d.toFixed(1)}`));

    g.append("text").attr("class", "scatter-axis-title")
        .attr("x", innerW / 2).attr("y", innerH + 48)
        .attr("text-anchor", "middle")
        .text(`GDP per capita, ${GDP_YEAR} (log scale)`);
    g.append("text").attr("class", "scatter-axis-title")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerH / 2).attr("y", -54)
        .attr("text-anchor", "middle")
        .text(`Low-carbon transition speed, ${START_YEAR}–${END_YEAR} (pp/year)`);

    d3.select(el).append("p").attr("class", "scatter-note")
        .text(`${points.length} of ${totalComparable} comparable countries shown. ` +
            `Speed is the change in low-carbon electricity share divided by ${END_YEAR - START_YEAR} years. ` +
            `Bubble area represents ${END_YEAR} electricity generation; the dashed line is a log-linear trend.`);
}
