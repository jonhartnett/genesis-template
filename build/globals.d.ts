declare enum Context {
    Client='client',
    Server='server',
    Renderer='renderer',
    Preload='preload',
    Electron='electron'
}
declare var CONTEXT: Context;

declare enum Variant {
    Development='development',
    Production='production'
}
declare var VARIANT: Variant;

declare enum Side {
    Frontend='frontend',
    Backend='backend'
}
declare var SIDE: Side;

declare var IS_ENTRY_MODULE: boolean;