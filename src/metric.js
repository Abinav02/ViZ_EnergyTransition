// metric.js
//
// Window-aware companion to deltaLowCarbon() in data.js.
//
// WHY THIS EXISTS
// The project brief defines transition speed as
//     Δ = low_carbon_share_elec(2025) − low_carbon_share_elec(1985)
// and states that countries without a comparable value at both endpoints are
// excluded from the ranking.
//
// deltaLowCarbon() in data.js does something different: it takes the first and
// last *non-null* years for each entity. Nobody is excluded — instead 148 of
// the 213 ranked countries are measured over a shorter window than 1985-2025.
// 93 of them are measured over 2000-2024, a 24-year window compared against
// the 40-year window used for the 65 countries with complete records.
//
// That matters because the research question asks which countries moved
// FASTEST. A country that shifted 30 pp in 24 years currently ranks below one
// that shifted 35 pp in 40 years, despite having transitioned faster.
//
// This module does NOT change that metric — deltaLowCarbon() is left exactly
// as it is, and every existing ranking is untouched. It only reports which
// window a given entity's Δ was actually measured over, so a view can say so
// out loud instead of implying all figures share the 1985-2025 period.
//
// perDecade is provided for the team's later decision about whether to switch
// the headline metric to a rate. Nothing currently reads it.

import { YEAR_MIN, YEAR_MAX } from "./data.js";

// Mirrors deltaLowCarbon()'s first/last non-null walk exactly, so `delta`
// here always equals what the ranking used. If that function's rule changes,
// this one has to change with it.
export function deltaWithWindow(rowsForOneEntity) {
    if (!rowsForOneEntity || !rowsForOneEntity.length) return null;

    const sorted = rowsForOneEntity
        .slice()
        .sort((a, b) => Number(a.year) - Number(b.year));

    let first = null;
    for (const d of sorted) {
        if (d.low_carbon_share_elec != null) { first = d; break; }
    }
    let last = null;
    for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].low_carbon_share_elec != null) { last = sorted[i]; break; }
    }

    if (!first || !last || first.year === last.year) return null;

    const from = Number(first.year);
    const to = Number(last.year);
    const span = to - from;
    const delta = last.low_carbon_share_elec - first.low_carbon_share_elec;

    return {
        delta,
        from,
        to,
        span,
        fromValue: first.low_carbon_share_elec,
        toValue: last.low_carbon_share_elec,
        // True only when the entity really is measured over the full period
        // the brief describes.
        isFullPeriod: from === YEAR_MIN && to === YEAR_MAX,
        // Not used by any view yet — see the note at the top of this file.
        perDecade: span > 0 ? (delta / span) * 10 : null,
    };
}

// One-line disclosure, e.g.
//   "Δ +41.2 pp, measured 2000–2024 (24 of 41 years)"
export function describeWindow(w) {
    if (!w) return "No comparable endpoints — excluded from the Δ ranking.";

    const sign = w.delta >= 0 ? "+" : "−";
    const magnitude = Math.abs(w.delta).toFixed(1);
    const total = YEAR_MAX - YEAR_MIN + 1;
    const covered = w.span + 1;

    const base = `Δ ${sign}${magnitude} pp, measured ${w.from}–${w.to}`;
    return w.isFullPeriod
        ? `${base} (full ${total}-year period)`
        : `${base} (${covered} of ${total} years — shorter than the study period)`;
}
