module.exports = {
    extends: 'eslint:recommended',
    parser: 'babel-eslint',
    //note: this is overridden in webpack.config.js for the specific context
    env: {
        browser: true,
        node: true,
        es6: true
    },
    rules: {
        'no-unused-vars': 'off',
        'no-constant-condition': ['error', {
            checkLoops: false
        }]
    },
    reportUnusedDisableDirectives: true
};