// heatmap.js
import * as d3 from "d3";
import {
    YEAR_MIN,
    YEAR_MAX,
    getContinentSeries,
    getCountriesInContinent,
    rankByDelta,
} from "./data.js";
import { selectContinent, selectCountry, backToContinents } from "./state.js";

// ---------- Layout constants ----------
const MARGIN = { top: 10, right: 30, bottom: 40, left: 160 };
const CELL_H = 22;
const YEAR_W = 14;

// ---------- Sequential blues, hand-picked stops ----------
const BLUE_STOPS = ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"];
const colorScale = d3.scaleLinear()
    .domain([0, 25, 50, 75, 100])
    .range(BLUE_STOPS)
    .clamp(true);

// ---------- Shared tooltip ----------
let tooltip;
function getTooltip() {
    if (!tooltip) {
        tooltip = d3.select("body")
            .append("div")
            .attr("class", "heatmap-tooltip")
            .style("position", "absolute")
            .style("pointer-events", "none")
            .style("opacity", 0);
    }
    return tooltip;
}

// ---------- Main render ----------
export function renderHeatmap(container, state) {
    const el = typeof container === "string"
        ? document.querySelector(container)
        : container;

    if (!el) {
        console.error("[heatmap] container not found:", container);
        return;
    }

    d3.select(el).selectAll("*").remove();

    // ---- Pick data slice based on drill level ----
    let rows;
    let titleText;

    try {
        if (state.level === "continent") {
            rows = rankByDelta(getContinentSeries());
            titleText = "Continents — low-carbon share of electricity";
        } else {
            rows = rankByDelta(getCountriesInContinent(state.selectedContinent));
            titleText = `${state.selectedContinent} — low-carbon share of electricity`;
        }
    } catch (err) {
        console.error("[heatmap] data error:", err);
        d3.select(el).append("p").text("Error reading data — see console.");
        return;
    }

    if (!rows || rows.length === 0) {
        d3.select(el).append("p")
            .style("color", "#b00")
            .text("No data for this selection.");
        return;
    }

    // ---- Assemble year -> value per row ----
    const years = d3.range(YEAR_MIN, YEAR_MAX + 1);
    rows.forEach(r => {
        const byYear = new Map(
            r.rows.map(d => [Number(d.year), d.low_carbon_share_elec])
        );
        r.values = years.map(y => {
            const v = byYear.get(y);
            return v == null || Number.isNaN(v) ? null : Number(v);
        });
    });

    // ---- Geometry ----
    const innerW = years.length * YEAR_W;
    const innerH = rows.length * CELL_H;
    const width  = MARGIN.left + innerW + MARGIN.right;
    const height = MARGIN.top  + innerH + MARGIN.bottom;

    const x = d3.scaleBand()
        .domain(years)
        .range([0, innerW])
        .paddingInner(0.05);

    const y = d3.scaleBand()
        .domain(rows.map(r => r.name))
        .range([0, innerH])
        .paddingInner(0.08);

    // ---- SVG ----
    const svg = d3.select(el)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", width)
        .attr("height", height)
        .style("overflow", "visible");

    // ---- No-data hatch pattern ----
    const defs = svg.append("defs");
    const hatch = defs.append("pattern")
        .attr("id", "no-data-hatch")
        .attr("patternUnits", "userSpaceOnUse")
        .attr("width", 4)
        .attr("height", 4)
        .attr("patternTransform", "rotate(45)");
    hatch.append("rect")
        .attr("width", 4)
        .attr("height", 4)
        .attr("fill", "#f3f3f3");
    hatch.append("line")
        .attr("x1", 0).attr("y1", 0)
        .attr("x2", 0).attr("y2", 4)
        .attr("stroke", "#c8c8c8")
        .attr("stroke-width", 1.2);

    const g = svg.append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    // ---- Fade in on render ----
    g.style("opacity", 0)
        .transition()
        .duration(400)
        .ease(d3.easeCubicOut)
        .style("opacity", 1);

    // ---- Flatten cells ----
    const flat = [];
    rows.forEach(r => {
        r.values.forEach((v, i) => {
            flat.push({
                name: r.name,
                year: years[i],
                value: v,
                delta: r.delta,
            });
        });
    });

    // ---- Draw cells ----
    const cells = g.append("g")
        .attr("class", "cells")
        .selectAll("rect")
        .data(flat)
        .join("rect")
        .attr("x", d => x(d.year))
        .attr("y", d => y(d.name))
        .attr("width", x.bandwidth())
        .attr("height", y.bandwidth())
        .attr("fill", d => d.value == null
            ? "url(#no-data-hatch)"
            : colorScale(d.value))
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 0.5)
        .style("cursor", "pointer");

    // ---- Tooltip ----
    const tip = getTooltip();
    cells
        .on("mouseover", (event, d) => {
            tip.style("opacity", 1).html(
                `<strong>${d.name}</strong><br/>` +
                `Year: ${d.year}<br/>` +
                `Low-carbon: ${d.value == null
                    ? "<em>no data</em>"
                    : d.value.toFixed(1) + "%"}<br/>` +
                `Δ 1985→2025: ${d.delta.toFixed(1)} pp`
            );
        })
        .on("mousemove", event => {
            tip.style("left", (event.pageX + 12) + "px")
                .style("top",  (event.pageY + 12) + "px");
        })
        .on("mouseout", () => tip.style("opacity", 0));

    // ---- Click to drill / select ----
    cells.on("click", (event, d) => {
        if (state.level === "continent") {
            selectContinent(d.name);
        } else {
            selectCountry(d.name);
        }
    });

    // ---- Highlight selected country ----
    if (state.level === "country" && state.selectedCountry) {
        g.selectAll(".cells rect")
            .attr("stroke", d => d.name === state.selectedCountry
                ? "#d62728"
                : "#ffffff")
            .attr("stroke-width", d => d.name === state.selectedCountry ? 2 : 0.5);
    }

    // ---- Y axis (row labels) ----
    g.append("g")
        .attr("class", "y-axis")
        .call(d3.axisLeft(y).tickSize(0))
        .call(sel => sel.select(".domain").remove())
        .selectAll("text")
        .style("font-size", "12px");

    // ---- X axis (years, thinned) ----
    const tickYears = years.filter(y => y % 5 === 0);
    g.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0,${innerH})`)
        .call(
            d3.axisBottom(x)
                .tickValues(tickYears)
                .tickFormat(d3.format("d"))
                .tickSize(3)
        )
        .call(sel => sel.select(".domain").remove())
        .selectAll("text")
        .style("font-size", "11px");

    // ---- Header (title + legend) + back button ----
    const header = d3.select(el).insert("div", ":first-child")
        .attr("class", "view-header");

    const headerLeft = header.append("div").attr("class", "header-left");
    headerLeft.append("h2").text(titleText);

    const legendWrap = headerLeft.append("div").attr("class", "legend-wrap");
    drawLegend(legendWrap.node());

    if (state.level === "country") {
        header.append("button")
            .text("← Back to continents")
            .on("click", () => backToContinents());
    }

    // ---- Caption: hatched cells + coverage caveat ----
    d3.select(el).append("p")
        .attr("class", "heatmap-note")
        .text("Hatched cells indicate years with no reported data for that entity. " +
            "2024–2025 are incomplete for many aggregates.");
}

// ---------- Legend ----------
function drawLegend(container) {
    const w = 220, h = 10;
    const legend = d3.select(container)
        .append("svg")
        .attr("class", "heatmap-legend")
        .attr("width", w + 4)
        .attr("height", h + 22);

    const defs = legend.append("defs");
    const grad = defs.append("linearGradient")
        .attr("id", "heatmap-grad")
        .attr("x1", "0%").attr("x2", "100%");

    [0, 0.25, 0.5, 0.75, 1].forEach(t => {
        grad.append("stop")
            .attr("offset", `${t * 100}%`)
            .attr("stop-color", colorScale(t * 100));
    });

    legend.append("rect")
        .attr("x", 0).attr("y", 4)
        .attr("width", w).attr("height", h)
        .attr("fill", "url(#heatmap-grad)")
        .attr("stroke", "#ccc");

    legend.append("text")
        .attr("x", 0).attr("y", h + 18)
        .attr("text-anchor", "start")
        .style("font-size", "11px").style("fill", "#444")
        .text("0% — all fossil");

    legend.append("text")
        .attr("x", w).attr("y", h + 18)
        .attr("text-anchor", "end")
        .style("font-size", "11px").style("fill", "#444")
        .text("100% — all low-carbon");
}