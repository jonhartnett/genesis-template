const { BuildInfo } = require('./main');

module.exports = ({file, options, env}) => {
    let info = BuildInfo.get(options.context, options.variant);
    return {
        plugins: [
            require('postcss-preset-env')({
                browsers: info.browserListConfig
            })
        ]
    };
};