// stacked-area.js
//
// Electricity-generation composition over time, as six stacked bands.
//
// Where the heatmap answers "how much did the low-carbon share move?", this
// view answers the follow-up: *which sources* produced that movement. It is
// the decomposition described in section 3 of the project brief.
//
// Scope, per the agreed design:
//   * no year control here — the heatmap already owns the year dimension;
//     this view always shows the full 1985-2025 span.
//   * nothing selected  -> World aggregate
//     continent selected -> that continent
//     country selected   -> that country
//
// Two data honesty rules drive most of the code below. Both come from the
// same principle the team already applied in deltaLowCarbon(): never let a
// missing value masquerade as a real zero.
//   1. A year with no reported generation at all is a GAP, not 0%. Roughly
//      a quarter of country-years in the dataset are in this state, so
//      drawing them as zeros would invent a flat "all sources 0%" floor.
//   2. The six bands do not always sum to 100. The Europe aggregate reaches
//      only 88-92% before 2000. That shortfall is drawn explicitly as an
//      "unreported" band rather than normalised away, which would silently
//      inflate every visible share.

import * as d3 from "d3";
import {
    YEAR_MIN,
    YEAR_MAX,
    CONTINENTS,
    getCountryRows,
    getCountriesInContinent,
    toSixBandSeries,
} from "./data.js";
import {
    selectCountry,
    selectContinent,
    backToContinents,
} from "./state.js";
import { deltaWithWindow, describeWindow } from "./metric.js";
import {
    BAND_KEYS,
    BAND_COLORS,
    BAND_LABELS,
    BAND_LONG_LABELS,
} from "./palette.js";

// ---------- Layout ----------
const MARGIN = { top: 12, right: 132, bottom: 36, left: 46 };
const HEIGHT = 330;
const MIN_WIDTH = 520;

// A band must occupy at least this share to earn an inline label, otherwise
// the text collides with its neighbours.
const DIRECT_LABEL_MIN_PCT = 7;

// Below this total, a year is treated as having no reported data at all.
const NO_DATA_EPS = 0.05;

// Above this total the stack counts as complete. Set at 98 rather than ~100
// deliberately: OWID’s published shares round to one decimal, so a complete
// row lands at 99.3-100 (the World aggregate never exceeds 99.5). Treating
// that as a shortfall would paint an "unreported" sliver on data that has no
// gap at all. Europe’s genuine pre-2000 shortfall reaches 88%, well clear of
// this line.
const COMPLETE_PCT = 98;

// ---------- Tooltip ----------
// Its own element, not the heatmap's, so hiding one never hides the other.
let tooltip;
function getTooltip() {
    if (!tooltip) {
        tooltip = d3.select("body")
            .append("div")
            .attr("class", "stack-tooltip")
            .style("position", "absolute")
            .style("pointer-events", "none")
            .style("opacity", 0);
    }
    return tooltip;
}

// ---------- Which entity are we showing? ----------
// Country beats continent beats the World default.
export function resolveEntity(state) {
    if (state && state.selectedCountry) {
        return { name: state.selectedCountry, kind: "country" };
    }
    if (state && state.selectedContinent) {
        return { name: state.selectedContinent, kind: "continent" };
    }
    return { name: "World", kind: "world" };
}

function subtitleFor(entity) {
    if (entity.kind === "world") {
        return "World total — pick an entity below, or select one in the heatmap.";
    }
    if (entity.kind === "continent") {
        return "Continent aggregate — pick a country below, or select one in the heatmap.";
    }
    return "Country detail — choose “World” below to return to the global view.";
}

// ---------- Entity index for the picker ----------
// Built from the continent map rather than from a raw country list, so the
// dropdown offers exactly the countries the heatmap can also drill into —
// the two selection routes can never disagree about what exists.
// Built once and cached; the underlying data does not change after load.
let entityIndex = null;

function getEntityIndex() {
    if (entityIndex) return entityIndex;

    const continentOf = new Map();
    CONTINENTS.forEach(continent => {
        const names = new Set(
            getCountriesInContinent(continent).map(d => d.country)
        );
        names.forEach(name => continentOf.set(name, continent));
    });

    const countries = Array.from(continentOf.keys())
        .sort((a, b) => a.localeCompare(b));

    entityIndex = { countries, continentOf };
    return entityIndex;
}

// ---------- Entity picker ----------
// A second route to the same state the heatmap drives. Selecting a country
// here also drills the heatmap to its continent, so the two views stay in
// agreement instead of showing different things at once.
function drawSelector(container, entity) {
    const { countries, continentOf } = getEntityIndex();

    const wrap = d3.select(container)
        .append("div")
        .attr("class", "stack-picker");

    wrap.append("label")
        .attr("for", "stack-entity-select")
        .text("Show:");

    const select = wrap.append("select")
        .attr("id", "stack-entity-select")
        .attr("class", "stack-select");

    select.append("option").attr("value", "__world__").text("World");

    const continentGroup = select.append("optgroup").attr("label", "Continents");
    continentGroup.selectAll("option")
        .data(CONTINENTS.slice().sort((a, b) => a.localeCompare(b)))
        .join("option")
        .attr("value", d => `c:${d}`)
        .text(d => d);

    const countryGroup = select.append("optgroup")
        .attr("label", `Countries (${countries.length})`);
    countryGroup.selectAll("option")
        .data(countries)
        .join("option")
        .attr("value", d => `k:${d}`)
        .text(d => d);

    // Reflect whatever the current state is, however it was reached.
    const current =
        entity.kind === "world"     ? "__world__" :
        entity.kind === "continent" ? `c:${entity.name}` :
                                      `k:${entity.name}`;
    select.property("value", current);

    // A country selected here may not exist in the option list if the heatmap
    // put it there some other way; fall back to World rather than showing a
    // blank control.
    if (!select.property("value")) select.property("value", "__world__");

    select.on("change", function () {
        const value = this.value;

        if (value === "__world__") {
            backToContinents();
            return;
        }
        if (value.startsWith("c:")) {
            selectContinent(value.slice(2));
            return;
        }

        const name = value.slice(2);
        const continent = continentOf.get(name);
        // Drill the heatmap to the right continent first, so its row for this
        // country is on screen and gets the selected-country highlight.
        if (continent) selectContinent(continent);
        selectCountry(name);
    });
}

// ---------- Shape the data ----------
// Adds hasData / total to each year so the renderer can distinguish
// "no reported data" from "genuinely zero across all six sources".
function buildSeries(entityName) {
    const rows = getCountryRows(entityName);
    if (!rows.length) return [];

    return toSixBandSeries(rows).map(d => {
        const total = BAND_KEYS.reduce((sum, k) => sum + (d[k] || 0), 0);
        return { ...d, total, hasData: total > NO_DATA_EPS };
    });
}

// Contiguous runs of no-data years, for the caption and the gap shading.
function findGaps(series) {
    const gaps = [];
    let start = null;
    series.forEach((d, i) => {
        if (!d.hasData && start === null) start = d.year;
        if ((d.hasData || i === series.length - 1) && start !== null) {
            const end = d.hasData ? series[i - 1].year : d.year;
            gaps.push({ start, end });
            start = null;
        }
    });
    return gaps;
}

// ---------- Main render ----------
export function renderStackedArea(container, state) {
    const el = typeof container === "string"
        ? document.querySelector(container)
        : container;

    if (!el) {
        console.error("[stacked-area] container not found:", container);
        return;
    }

    d3.select(el).selectAll("*").remove();

    const entity = resolveEntity(state);

    let series;
    try {
        series = buildSeries(entity.name);
    } catch (err) {
        console.error("[stacked-area] data error:", err);
        d3.select(el).append("p").text("Error reading data — see console.");
        return;
    }

    // ---- Header (title + subtitle + legend), drawn even when empty ----
    const header = d3.select(el).append("div").attr("class", "view-header");
    const headerLeft = header.append("div").attr("class", "header-left");
    headerLeft.append("h2")
        .text(`${entity.name} — electricity generation by source`);
    headerLeft.append("p")
        .attr("class", "stack-subtitle")
        .text(subtitleFor(entity));

    // Δ disclosure. The ranking metric is measured over each entity's first
    // and last reported years, which for most countries is NOT 1985-2025.
    // Stating the window here means a reader comparing two panels can see
    // when they are not looking at equal spans of time.
    const window = deltaWithWindow(getCountryRows(entity.name));
    headerLeft.append("p")
        .attr("class", window && !window.isFullPeriod
            ? "stack-window stack-window-partial"
            : "stack-window")
        .text(describeWindow(window));

    // The picker sits on the right of the header, mirroring where the heatmap
    // puts its "Back to continents" button. Drawn before the empty-state
    // return below, so a dead-end selection can always be undone.
    drawSelector(header.node(), entity);

    if (!series.length) {
        d3.select(el).append("p")
            .attr("class", "stack-empty")
            .text(`No generation data available for ${entity.name}.`);
        return;
    }

    const withData = series.filter(d => d.hasData);
    if (!withData.length) {
        d3.select(el).append("p")
            .attr("class", "stack-empty")
            .text(`${entity.name} has no reported electricity-mix data between ${YEAR_MIN} and ${YEAR_MAX}.`);
        return;
    }

    // Legend sits in the header so it reads before the chart.
    drawLegend(headerLeft.append("div").attr("class", "legend-wrap").node());

    // ---- Geometry ----
    const outerW = Math.max(el.clientWidth || MIN_WIDTH, MIN_WIDTH);
    const innerW = outerW - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    const x = d3.scaleLinear()
        .domain([YEAR_MIN, YEAR_MAX])
        .range([0, innerW]);

    const y = d3.scaleLinear()
        .domain([0, 100])
        .range([innerH, 0]);

    const svg = d3.select(el)
        .append("svg")
        .attr("class", "stack-svg")
        .attr("viewBox", `0 0 ${outerW} ${HEIGHT}`)
        .attr("width", outerW)
        .attr("height", HEIGHT)
        .attr("role", "img")
        .attr("aria-label",
            `Stacked area chart of electricity generation by source for ${entity.name}, ${YEAR_MIN} to ${YEAR_MAX}.`);

    // Hatch for the unreported remainder — same idiom the heatmap uses for
    // missing cells, so "hatched means not reported" stays consistent.
    const defs = svg.append("defs");
    const hatch = defs.append("pattern")
        .attr("id", "stack-unreported-hatch")
        .attr("patternUnits", "userSpaceOnUse")
        .attr("width", 5).attr("height", 5)
        .attr("patternTransform", "rotate(45)");
    hatch.append("rect")
        .attr("width", 5).attr("height", 5)
        .attr("fill", "#f2f4f6");
    hatch.append("line")
        .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 5)
        .attr("stroke", "#cfd6dd")
        .attr("stroke-width", 1.2);

    const g = svg.append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    g.style("opacity", 0)
        .transition().duration(400).ease(d3.easeCubicOut)
        .style("opacity", 1);

    // ---- Grid (recessive, behind the data) ----
    g.append("g")
        .attr("class", "stack-grid")
        .call(d3.axisLeft(y).tickValues([0, 25, 50, 75, 100]).tickSize(-innerW).tickFormat(""))
        .call(sel => sel.select(".domain").remove());

    // ---- No-data shading, drawn before the areas ----
    const gaps = findGaps(series);
    g.append("g").attr("class", "stack-gaps")
        .selectAll("rect")
        .data(gaps)
        .join("rect")
        .attr("x", d => x(d.start - 0.5))
        .attr("y", 0)
        .attr("width", d => Math.max(0, x(d.end + 0.5) - x(d.start - 0.5)))
        .attr("height", innerH)
        .attr("fill", "url(#stack-unreported-hatch)")
        .attr("opacity", 0.55);

    // ---- Stack ----
    const stack = d3.stack().keys(BAND_KEYS);
    const stacked = stack(series);

    const area = d3.area()
        .defined(d => d.data.hasData)
        .x(d => x(d.data.year))
        .y0(d => y(d[0]))
        .y1(d => y(d[1]))
        .curve(d3.curveMonotoneX);

    g.append("g").attr("class", "stack-areas")
        .selectAll("path")
        .data(stacked)
        .join("path")
        .attr("class", d => `band band-${d.key}`)
        .attr("fill", d => BAND_COLORS[d.key])
        .attr("d", area)
        // A hairline in the surface colour separates adjacent bands so the
        // boundary survives even where two fills are close in value.
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 0.8);

    // ---- Unreported remainder: from the top of the stack up to 100% ----
    const remainder = series.filter(d => d.hasData && d.total < COMPLETE_PCT);
    if (remainder.length) {
        const remArea = d3.area()
            .defined(d => d.hasData && d.total < COMPLETE_PCT)
            .x(d => x(d.year))
            .y0(d => y(d.total))
            .y1(() => y(100))
            .curve(d3.curveMonotoneX);

        g.append("path")
            .datum(series)
            .attr("class", "stack-remainder")
            .attr("fill", "url(#stack-unreported-hatch)")
            .attr("d", remArea);
    }

    // ---- Axes ----
    const tickYears = d3.range(YEAR_MIN, YEAR_MAX + 1).filter(v => v % 5 === 0);
    g.append("g")
        .attr("class", "stack-x-axis")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(x).tickValues(tickYears).tickFormat(d3.format("d")).tickSize(4))
        .call(sel => sel.select(".domain").attr("stroke", "#d7dde3"));

    g.append("g")
        .attr("class", "stack-y-axis")
        .call(d3.axisLeft(y).tickValues([0, 25, 50, 75, 100]).tickFormat(d => `${d}%`).tickSize(4))
        .call(sel => sel.select(".domain").remove());

    // ---- Direct labels for the thick bands at the right edge ----
    // Only bands wide enough to hold text; the legend covers the rest.
    const lastWithData = withData[withData.length - 1];
    const labelData = stacked
        .map(s => {
            const point = s.find(p => p.data.year === lastWithData.year);
            if (!point) return null;
            const pct = point[1] - point[0];
            return pct >= DIRECT_LABEL_MIN_PCT
                ? { key: s.key, yMid: (point[0] + point[1]) / 2, pct }
                : null;
        })
        .filter(Boolean);

    g.append("g").attr("class", "stack-direct-labels")
        .selectAll("text")
        .data(labelData)
        .join("text")
        .attr("x", x(lastWithData.year) + 8)
        .attr("y", d => y(d.yMid))
        .attr("dy", "0.32em")
        .text(d => `${BAND_LABELS[d.key]} ${d.pct.toFixed(0)}%`);

    // ---- Crosshair + tooltip ----
    const focus = g.append("g").attr("class", "stack-focus").style("display", "none");
    focus.append("line")
        .attr("class", "stack-crosshair")
        .attr("y1", 0).attr("y2", innerH);

    const tip = getTooltip();
    const byYear = new Map(series.map(d => [d.year, d]));

    g.append("rect")
        .attr("class", "stack-hit")
        .attr("width", innerW)
        .attr("height", innerH)
        .attr("fill", "none")
        .style("pointer-events", "all")
        .on("mouseenter", () => focus.style("display", null))
        .on("mouseleave", () => {
            focus.style("display", "none");
            tip.style("opacity", 0);
        })
        .on("mousemove", event => {
            const [mx] = d3.pointer(event);
            const year = Math.round(x.invert(mx));
            const d = byYear.get(year);
            if (!d) return;

            focus.select(".stack-crosshair")
                .attr("x1", x(year)).attr("x2", x(year));

            tip.style("opacity", 1)
                .html(buildTooltipHTML(entity, d))
                .style("left", `${event.pageX + 14}px`)
                .style("top", `${event.pageY + 14}px`);
        });

    // ---- Caption: state the data caveats in the view itself ----
    const notes = [];
    if (gaps.length) {
        const spans = gaps
            .map(gp => (gp.start === gp.end ? `${gp.start}` : `${gp.start}–${gp.end}`))
            .join(", ");
        notes.push(`No reported data: ${spans} (shown hatched, not as zero).`);
    }
    if (remainder.length) {
        const worst = d3.min(remainder, d => d.total);
        notes.push(
            `In ${remainder.length} year${remainder.length > 1 ? "s" : ""} the six sources ` +
            `account for less than 100% of generation (lowest ${worst.toFixed(0)}%); ` +
            `the hatched remainder is generation not attributed to a source in the dataset.`
        );
    }
    notes.push("Shares are percentages of electricity generation, not primary energy.");

    d3.select(el).append("p")
        .attr("class", "heatmap-note")
        .text(notes.join(" "));

    // ---- Table view (accessibility relief + lets reviewers read values) ----
    drawTableToggle(el, entity, series);
}

// ---------- Tooltip content ----------
function buildTooltipHTML(entity, d) {
    if (!d.hasData) {
        return `
            <div class="stack-tip-head"><strong>${entity.name}</strong> · ${d.year}</div>
            <div class="stack-tip-nodata">No reported generation data</div>`;
    }

    const rows = BAND_KEYS
        .slice()
        .reverse()   // top of the stack first, matching what the eye sees
        .map(k => {
            const v = d[k] || 0;
            const dim = v < 0.05 ? ' style="opacity:0.45"' : "";
            return `
                <div class="stack-tip-row"${dim}>
                    <span class="stack-tip-swatch" style="background:${BAND_COLORS[k]}"></span>
                    <span class="stack-tip-label">${BAND_LABELS[k]}</span>
                    <span class="stack-tip-value">${v.toFixed(1)}%</span>
                </div>`;
        })
        .join("");

    const shortfall = d.total < COMPLETE_PCT
        ? `<div class="stack-tip-row stack-tip-remainder">
               <span class="stack-tip-swatch stack-tip-swatch-hatch"></span>
               <span class="stack-tip-label">Unreported</span>
               <span class="stack-tip-value">${(100 - d.total).toFixed(1)}%</span>
           </div>`
        : "";

    const lowCarbon = d.total - (d.fossil || 0);

    return `
        <div class="stack-tip-head"><strong>${entity.name}</strong> · ${d.year}</div>
        ${rows}
        ${shortfall}
        <div class="stack-tip-total">
            <span>Low-carbon</span><span><strong>${lowCarbon.toFixed(1)}%</strong></span>
        </div>`;
}

// ---------- Legend ----------
function drawLegend(container) {
    const wrap = d3.select(container).append("div").attr("class", "stack-legend");

    wrap.selectAll("span.stack-legend-item")
        .data(BAND_KEYS)
        .join("span")
        .attr("class", "stack-legend-item")
        .html(k => `
            <span class="stack-legend-swatch" style="background:${BAND_COLORS[k]}"></span>${BAND_LABELS[k]}`)
        .attr("title", k => BAND_LONG_LABELS[k]);

    wrap.append("span")
        .attr("class", "stack-legend-item stack-legend-item-hatch")
        .html(`<span class="stack-legend-swatch stack-legend-swatch-hatch"></span>No data / unreported`);
}

// ---------- Table view ----------
function drawTableToggle(el, entity, series) {
    const wrap = d3.select(el).append("div").attr("class", "stack-table-wrap");

    const btn = wrap.append("button")
        .attr("class", "stack-table-toggle")
        .attr("aria-expanded", "false")
        .text("Show data table");

    const tableBox = wrap.append("div")
        .attr("class", "stack-table-box")
        .style("display", "none");

    let built = false;
    btn.on("click", () => {
        const open = tableBox.style("display") !== "none";
        tableBox.style("display", open ? "none" : "block");
        btn.text(open ? "Show data table" : "Hide data table")
            .attr("aria-expanded", String(!open));

        if (!built && !open) {
            buildTable(tableBox.node(), entity, series);
            built = true;
        }
    });
}

function buildTable(node, entity, series) {
    const table = d3.select(node).append("table").attr("class", "stack-table");

    table.append("caption")
        .text(`${entity.name} — electricity generation by source, % of total`);

    table.append("thead").append("tr")
        .selectAll("th")
        .data(["Year", ...BAND_KEYS.map(k => BAND_LABELS[k]), "Total"])
        .join("th")
        .attr("scope", "col")
        .text(d => d);

    const tbody = table.append("tbody");
    series.forEach(d => {
        const tr = tbody.append("tr");
        tr.append("th").attr("scope", "row").text(d.year);
        if (!d.hasData) {
            tr.append("td")
                .attr("colspan", BAND_KEYS.length + 1)
                .attr("class", "stack-table-nodata")
                .text("no reported data");
            return;
        }
        BAND_KEYS.forEach(k => tr.append("td").text((d[k] || 0).toFixed(1)));
        tr.append("td").attr("class", "stack-table-total").text(d.total.toFixed(1));
    });
}
