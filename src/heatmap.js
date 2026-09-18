// heatmap.js
import * as d3 from "d3";
import {
    YEAR_MIN,
    YEAR_MAX,
    getContinentSeries,
    getCountriesInContinent,
    rankByDelta,
} from "./data.js";
import { deltaWithWindow, describeWindow } from "./metric.js";
import { selectContinent, selectCountry, backToContinents } from "./state.js";

// Layout constants
const MARGIN = { top: 10, right: 30, bottom: 40, left: 160 };
const CELL_H = 22;
const YEAR_W = 14;

const BLUE_STOPS = ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"];
const colorScale = d3.scaleLinear()
    .domain([0, 25, 50, 75, 100])
    .range(BLUE_STOPS)
    .clamp(true);

// Six-band colors
const BAND_COLORS = {
    fossil:   "#4d4d4d",   // dark grey
    nuclear:  "#9e6bb0",   // purple
    hydro:    "#1f78b4",   // blue
    wind:     "#4daf4a",   // green
    solar:    "#ffb300",   // amber
    bioOther: "#8dd3c7",   // light teal
};
const BAND_LABELS = {
    fossil:   "Fossil",
    nuclear:  "Nuclear",
    hydro:    "Hydro",
    wind:     "Wind",
    solar:    "Solar",
    bioOther: "Bio+Other",
};

// Shared tooltip
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

// Helper functions

// Extract the six-band split from a raw data row.
// Returns null if there's no row
function sixBandSplit(row) {
    if (!row) return null;
    const num = v => (v == null || Number.isNaN(v)) ? 0 : Number(v);
    return {
        fossil:   num(row.coal_share_elec) + num(row.gas_share_elec) + num(row.oil_share_elec),
        nuclear:  num(row.nuclear_share_elec),
        hydro:    num(row.hydro_share_elec),
        wind:     num(row.wind_share_elec),
        solar:    num(row.solar_share_elec),
        bioOther: num(row.other_renewables_share_elec), // includes biofuel — do not add biofuel_share_elec
    };
}

// Render the mini-bar + labels HTML for the tooltip.
function buildSplitHTML(split) {
    if (!split) return "";

    const order = ["fossil", "nuclear", "hydro", "wind", "solar", "bioOther"];
    const total = order.reduce((sum, k) => sum + split[k], 0) || 1;


    const barSegments = order
        .filter(k => split[k] > 0.05)   // skip invisible slices
        .map(k => {
            const pct = (split[k] / total) * 100;
            const title = `${BAND_LABELS[k]}: ${split[k].toFixed(1)}%`;
            return `<span title="${title}" style="
                display:inline-block;
                width:${pct}%;
                height:8px;
                background:${BAND_COLORS[k]};
            "></span>`;
        })
        .join("");


    const textRows = order
        .filter(k => split[k] > 0.05)
        .map(k => `
            <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;line-height:1.5">
                <span><span style="display:inline-block;width:8px;height:8px;
                    background:${BAND_COLORS[k]};margin-right:5px;vertical-align:middle"></span>${BAND_LABELS[k]}</span>
                <span style="color:#333">${split[k].toFixed(1)}%</span>
            </div>
        `)
        .join("");

    return `
        <hr style="margin:6px 0;border:none;border-top:1px solid #eee"/>
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">
            Source breakdown
        </div>
        <div style="display:flex;height:8px;border-radius:2px;overflow:hidden;margin-bottom:6px">
            ${barSegments}
        </div>
        <div>${textRows}</div>
    `;
}

// Main render
export function renderHeatmap(container, state) {
    const el = typeof container === "string"
        ? document.querySelector(container)
        : container;

    if (!el) {
        console.error("[heatmap] container not found:", container);
        return;
    }

    d3.select(el).selectAll("*").remove();


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

    // Assemble year = value + source row per row
    const years = d3.range(YEAR_MIN, YEAR_MAX + 1);
    rows.forEach(r => {
        const byYear = new Map(
            r.rows.map(d => [Number(d.year), d])
        );
        r.byYear = byYear;
        r.values = years.map(y => {
            const d = byYear.get(y);
            const v = d?.low_carbon_share_elec;
            return v == null || Number.isNaN(v) ? null : Number(v);
        });

        r.window = deltaWithWindow(r.rows);
    });


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

    // SVG
    const svg = d3.select(el)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", width)
        .attr("height", height)
        .style("overflow", "visible");

    // No-data hatch pattern
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


    g.style("opacity", 0)
        .transition()
        .duration(400)
        .ease(d3.easeCubicOut)
        .style("opacity", 1);


    const flat = [];
    rows.forEach(r => {
        r.values.forEach((v, i) => {
            const year = years[i];
            flat.push({
                name: r.name,
                year,
                value: v,
                delta: r.delta,
                window: r.window,
                source: r.byYear.get(year) || null,
            });
        });
    });

    // Draw cells
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


    const tip = getTooltip();
    cells
        .on("mouseover", (event, d) => {
            const split = sixBandSplit(d.source);
            const header =
                `<div style="font-size:12px;margin-bottom:4px">
                    <strong>${d.name}</strong> · ${d.year}
                </div>
                <div style="font-size:11px;color:#555">
                    Low-carbon: <strong>${d.value == null
                    ? "no data"
                    : d.value.toFixed(1) + "%"}</strong><br/>
                    ${describeWindow(d.window)}
                </div>`;
            tip.style("opacity", 1).html(header + buildSplitHTML(split));
        })
        .on("mousemove", event => {
            tip.style("left", (event.pageX + 12) + "px")
                .style("top",  (event.pageY + 12) + "px");
        })
        .on("mouseout", () => tip.style("opacity", 0));

    // Click to select
    cells.on("click", (event, d) => {
        if (state.level === "continent") {
            selectContinent(d.name);
        } else {
            selectCountry(d.name);
        }
    });

    // Highlight selected country
    if (state.level === "country" && state.selectedCountry) {
        g.selectAll(".cells rect")
            .attr("stroke", d => d.name === state.selectedCountry
                ? "#d62728"
                : "#ffffff")
            .attr("stroke-width", d => d.name === state.selectedCountry ? 2 : 0.5);
    }

    // Y axis (row labels)
    g.append("g")
        .attr("class", "y-axis")
        .call(d3.axisLeft(y).tickSize(0))
        .call(sel => sel.select(".domain").remove())
        .selectAll("text")
        .style("font-size", "12px");

    // X axis (years, thinned)
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

    // Header (title + legend) + back button
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


    d3.select(el).append("p")
        .attr("class", "heatmap-note")
        .text("Hatched cells indicate years with no reported data for that entity. " +
            "2024–2025 are incomplete for many aggregates.");
}

// Legend
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