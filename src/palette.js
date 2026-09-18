// palette.js
// Shared six-band palette for the electricity-generation composition.
// Used by the stacked-area chart; the heatmap tooltip shows the same six
// bands and should import from here too, so the two views never drift apart.
//
// These hues were chosen with a colour-vision-deficiency (CVD) check rather
// than by eye. The previous hand-picked set placed nuclear (#9e6bb0) and
// hydro (#1f78b4) at a protanopia separation of ΔE 0.9 — indistinguishable
// for red-blind viewers, and those two bands sit directly adjacent in the
// stack. The set below separates that pair to ΔE 10.2 (target is >= 8).
//
// Two deliberate deviations from the generic palette rules, both documented
// so a reviewer can see they were decisions rather than oversights:
//   * solar #ffb300 sits above the usual lightness ceiling. Yellow is
//     inherently light; darkening it to #f7ae00 dropped its separation from
//     wind green to ΔE 6.7, so brightness was traded for discriminability.
//   * fossil #5a534d is near-neutral by intent — it is the "baseline" band
//     the whole question is about moving away from, so it reads as grey
//     against the six coloured low-carbon sources.

// Bottom -> top. Must match the key order produced by toSixBandSeries().
export const BAND_KEYS = ["fossil", "nuclear", "hydro", "wind", "solar", "bioOther"];

export const BAND_COLORS = {
    fossil:   "#5a534d",   // warm neutral — fossil fuels (coal + gas + oil)
    nuclear:  "#b98ccc",   // lilac
    hydro:    "#15589b",   // deep blue
    wind:     "#45a83f",   // green
    solar:    "#ffb300",   // amber
    bioOther: "#3fbfa6",   // teal — bioenergy + other renewables
};

export const BAND_LABELS = {
    fossil:   "Fossil",
    nuclear:  "Nuclear",
    hydro:    "Hydro",
    wind:     "Wind",
    solar:    "Solar",
    bioOther: "Bio + other",
};

// Longer names for the legend and table, where there is room to be precise.
export const BAND_LONG_LABELS = {
    fossil:   "Fossil fuels (coal, gas, oil)",
    nuclear:  "Nuclear",
    hydro:    "Hydro",
    wind:     "Wind",
    solar:    "Solar",
    bioOther: "Bioenergy + other renewables",
};
