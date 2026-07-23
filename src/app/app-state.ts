// App-level toggle state shared across the app modules (and read by the
// broker via the compat bridge until it is migrated).

export const appState = {
    // Scroll to Selection: follow the highlighted flow (header toggle)
    scrollToSelectionEnabled: true,
    // Scroll to Change: follow connection-state / parameter changes
    // (header toggle; read by the view and the broker)
    scrollToChangeEnabled: true,
};
