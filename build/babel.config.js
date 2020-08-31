const { BuildInfo } = require('./main');

module.exports = api => {
    let info = BuildInfo.get(api.env());
    return {
        presets: [
            [require('@babel/preset-env'), {
                targets: info.browserListConfig,
                bugfixes: true,
                modules: false, //don't transform modules, let webpack do that
                ignoreBrowserslistConfig: true
            }]
        ],
        plugins: [
            [require('@babel/plugin-transform-runtime'), {
                proposals: true,
                useESModules: true
            }],
            require('@babel/plugin-proposal-class-properties'),
            require('@babel/plugin-proposal-export-default-from'),
            require('@babel/plugin-proposal-export-namespace-from'),
            require('@babel/plugin-proposal-function-bind'),
            require('@babel/plugin-proposal-nullish-coalescing-operator'),
            require('@babel/plugin-proposal-optional-chaining'),
            require('@babel/plugin-proposal-private-methods')
        ]
    };
};