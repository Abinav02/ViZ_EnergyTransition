const listeners = new Set();

export const state = {
    level: "continent",       // "continent" | "country"
    selectedContinent: null,  // e.g. "Europe"
    selectedCountry: null,    // e.g. "Germany"
};

export function subscribe(fn) {
    listeners.add(fn);
    fn(state); // call once immediately with current state
    return () => listeners.delete(fn);
}

function notify() {
    listeners.forEach(fn => fn(state));
}

export function selectContinent(continent) {
    state.level = "country";
    state.selectedContinent = continent;
    state.selectedCountry = null;
    notify();
}

export function selectCountry(country) {
    state.selectedCountry = country;
    notify();
}

export function backToContinents() {
    state.level = "continent";
    state.selectedContinent = null;
    state.selectedCountry = null;
    notify();
}