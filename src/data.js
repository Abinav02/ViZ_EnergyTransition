// data.js
import * as d3 from "d3";
import { loadContinentMap } from "./continent-map.js";

// ---------- Constants ----------

const FOSSIL_COLS = ["coal_share_elec", "gas_share_elec", "oil_share_elec"];

export const CONTINENTS = [
    "Africa",
    "Asia",
    "Europe",
    "North America",
    "South America",
    "Oceania",
];

// Aggregate rows we keep alongside real countries.
// "World" is retained so the stacked-area can default to the world aggregate
// when nothing is selected, per the design brief.
export const AGGREGATES = [...CONTINENTS, "World"];

export const YEAR_MIN = 1985;
export const YEAR_MAX = 2025;

let raw = [];
let continentMap = {};

// ---------- Row-level filters ----------

// Keeps: real countries (3-letter iso_code) + our named aggregates.
// Drops: historical entities, and ~90+ noise rows like "Africa (EI)",
// "G20 (Ember)", "High-income countries", "ASEAN (Ember)".
const HISTORICAL_EXCLUDE = new Set([
    "USSR", // Soviet Union
    "SUN",  // alternative USSR tag
    "YUG",  // Yugoslavia
    "CSK",  // Czechoslovakia
    "DDR",  // East Germany
    "ANT",  // Netherlands Antilles
    "SCG",  // Serbia and Montenegro
]);

function isUsableRow(d) {
    if (HISTORICAL_EXCLUDE.has(d.iso_code)) return false;
    const isCountry =
        typeof d.iso_code === "string" && d.iso_code.length === 3;
    const isAggregate = AGGREGATES.includes(d.country);
    return isCountry || isAggregate;
}

function inYearRange(d) {
    const y = Number(d.year);
    return y >= YEAR_MIN && y <= YEAR_MAX;
}

// ---------- Missing-value reconstruction ----------

// Fill missing low_carbon_share_elec from other columns in the same row.
// Priority order:
//   1. direct           — OWID already published it
//   2. nuclear+renew    — the identity we verified (Germany 2023, etc.)
//   3. complement of fossil (100 − fossil_share_elec)
//   4. component sum    — nuclear + hydro + wind + solar + other_renewables
//   5. raw_electricity  — 100 × (nuclear_TWh + renewables_TWh) / generation_TWh
// Records the source in `__low_carbon_source` for auditing.
function fillLowCarbonShare(rows) {
    const tally = {
        direct: 0,
        nuclear_renewables: 0,
        complement_fossil: 0,
        component_sum: 0,
        raw_electricity: 0,
        still_missing: 0,
    };

    rows.forEach(d => {
        if (d.low_carbon_share_elec != null) {
            d.__low_carbon_source = "direct";
            tally.direct++;
            return;
        }

        const nuc = d.nuclear_share_elec;
        const ren = d.renewables_share_elec;
        const fos = d.fossil_share_elec;

        // Fallback 1 — the identity
        if (nuc != null && ren != null) {
            d.low_carbon_share_elec = nuc + ren;
            d.__low_carbon_source = "nuclear+renewables";
            tally.nuclear_renewables++;
            return;
        }

        // Fallback 2 — complement of fossil
        if (fos != null) {
            d.low_carbon_share_elec = 100 - fos;
            d.__low_carbon_source = "complement_of_fossil";
            tally.complement_fossil++;
            return;
        }

        // Fallback 3 — full renewables breakdown
        const hydro = d.hydro_share_elec;
        const wind  = d.wind_share_elec;
        const solar = d.solar_share_elec;
        const other = d.other_renewables_share_elec;
        if (
            nuc   != null &&
            hydro != null && wind != null &&
            solar != null && other != null
        ) {
            d.low_carbon_share_elec = nuc + hydro + wind + solar + other;
            d.__low_carbon_source = "component_sum";
            tally.component_sum++;
            return;
        }

        // Fallback 4 — raw TWh
        const gen    = d.electricity_generation;
        const nucTwh = d.nuclear_electricity;
        const renTwh = d.renewables_electricity;
        if (gen != null && gen > 0 && nucTwh != null && renTwh != null) {
            d.low_carbon_share_elec = 100 * (nucTwh + renTwh) / gen;
            d.__low_carbon_source = "raw_electricity";
            tally.raw_electricity++;
            return;
        }

        d.__low_carbon_source = "still_missing";
        tally.still_missing++;
    });

    console.log("[data] low_carbon_share_elec fill summary:", tally);
    return rows;
}

// ---------- Load ----------

export async function loadData() {
    console.log("[data] fetching /owid-energy-data.csv …");
    const all = await d3.csv("/owid-energy-data.csv", d3.autoType);
    console.log("[data] total rows in file:", all.length);

    raw = all.filter(isUsableRow);
    const dropped = all.length - raw.length;
    console.log(
        `[data] rows after cleanup: ${raw.length} ` +
        `(dropped ${dropped} noise/historical rows)`
    );

    // Sanity check: warn if any expected aggregate is missing
    const names = new Set(raw.map(d => d.country));
    const missingAgg = AGGREGATES.filter(a => !names.has(a));
    if (missingAgg.length) {
        console.warn("[data] expected aggregates missing:", missingAgg);
    }

    // Reconstruct missing low_carbon_share_elec from components
    raw = fillLowCarbonShare(raw);

    continentMap = await loadContinentMap();
    console.log("[data] continent map size:", Object.keys(continentMap).length);

    return raw;
}

// ---------- Data accessors ----------

// Level 0 — the six continent aggregates
export function getContinentSeries() {
    return raw.filter(
        d => CONTINENTS.includes(d.country) && inYearRange(d)
    );
}

// Level 1 — every real country belonging to one continent
export function getCountriesInContinent(continent) {
    return raw.filter(
        d =>
            typeof d.iso_code === "string" &&
            d.iso_code.length === 3 &&
            continentMap[d.iso_code] === continent &&
            inYearRange(d)
    );
}

// Level 2 — full time series for a single country or aggregate
export function getCountryRows(countryName) {
    return raw.filter(d => d.country === countryName && inYearRange(d));
}

// World aggregate — handy default for the stacked-area
export function getWorldSeries() {
    return getCountryRows("World");
}

// ---------- Derived quantities ----------

export function fossilShare(d) {
    return FOSSIL_COLS.reduce((sum, key) => sum + (d[key] || 0), 0);
}

export function deltaLowCarbon(rowsForOneEntity) {
    const sorted = rowsForOneEntity
        .slice()
        .sort((a, b) => Number(a.year) - Number(b.year));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) return null;
    return (
        (last.low_carbon_share_elec ?? 0) -
        (first.low_carbon_share_elec ?? 0)
    );
}

export function groupByEntity(rows) {
    return d3.group(rows, d => d.country);
}

export function rankByDelta(rows) {
    const grouped = groupByEntity(rows);
    return Array.from(grouped, ([name, entityRows]) => ({
        name,
        delta: deltaLowCarbon(entityRows),
        rows: entityRows,
    }))
        .filter(d => d.delta !== null)
        .sort((a, b) => b.delta - a.delta);
}

// One 6-band row { fossil, nuclear, hydro, wind, solar, bioOther } per year.
// Order matches the intended stack order (bottom → top).
export function toSixBandSeries(rowsForOneEntity) {
    return rowsForOneEntity
        .slice()
        .sort((a, b) => Number(a.year) - Number(b.year))
        .map(d => ({
            year: Number(d.year),
            fossil: fossilShare(d),
            nuclear: d.nuclear_share_elec || 0,
            hydro: d.hydro_share_elec || 0,
            wind: d.wind_share_elec || 0,
            solar: d.solar_share_elec || 0,
            // Already includes biofuel — never add biofuel_share_elec on top,
            // or you'll double-count and the bands will exceed 100%.
            bioOther: d.other_renewables_share_elec || 0,
        }));
}