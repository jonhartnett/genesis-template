const Path = require('path');
const WebpackNodeExternals = require('webpack-node-externals');
const PnpWebpackPlugin = require('pnp-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const VueLoaderPlugin = require('vue-loader/lib/plugin');
const TerserWebpackPlugin = require('terser-webpack-plugin');
const OptimizeCssAssetsWebpackPlugin = require('optimize-css-assets-webpack-plugin');
const {HotModuleReplacementPlugin, DefinePlugin, SourceMapDevToolPlugin} = require('webpack');
const {BuildInfo, select} = require('./main');
const {WebpackPnpExternals} = require('webpack-pnp-externals');
const {WebpackApiClientPlugin, WebpackApiServerPlugin} = require('webpack-api-plugin');
const {CleanWebpackPlugin} = require('clean-webpack-plugin');


module.exports = (env, argv) => {
    let info = BuildInfo.get(env.context || 'client', env.variant || 'development');
    let root = Path.resolve(`${__dirname}/..`);

    let cacheDir = `${__dirname}/.cache`;

    /** @type {(string|RegExp|function)[]} */
    let sandbox = [
        `${root}/src/${info.side}/`,
        `${root}/src/common/`
    ];

    const jsLoaders = [];
    const cssLoaders = [];

    let mainPath = require.resolve('./main');
    let config = {
        name: info.context,
        mode: info.variant,
        entry: [
            select(info.context, {
                client: () => './src/frontend/main.js',
                server: () => './src/backend/main.server.js',
                renderer: () => './src/frontend/main.js',
                preload: () => './src/frontend/preload.renderer.js',
                electron: () => './src/backend/main.electron.js'
            })
        ],
        output: {
            path: (() => {
                let context = select(info.context, {
                    //renderer/preload also outputs to electron folder so we get all electron stuff together
                    renderer: () => 'electron',
                    preload: () => 'electron',
                    default: () => info.context
                });
                return `${root}/dist/${info.shortVariant}/${context}`;
            })(),
            filename: select(info.stack, {
                web: () => `[name].js`,
                electron: () => `[name].${info.context}.js`
            }),
            publicPath: select(`${info.context},${info.variant}`, {
                'renderer,production': () => './',
                'preload,production': () => './',
                default: () => `/${info.context}`
            }),
            libraryTarget: select(info.side, {
                frontend: () => undefined,
                backend: () => 'umd2'
            })
        },
        module: {
            /** @type {Object[]} */
            rules: [
                {
                    test: /\.m?js$/i,
                    exclude: /[/\\]node_modules[/\\]/,
                    use: jsLoaders
                },
                {
                    test: /\.css$/i,
                    use: cssLoaders,
                    sideEffects: true
                }
            ]
        },
        resolve: {
            alias: {
                '@': `${root}/src`
            },
            extensions: ['.js', '.json'],
            plugins: []
        },
        optimization: {
            moduleIds: 'hashed'
        },
        devtool: false,
        context: root,
        target: select(info.context, {
            client: () => 'web',
            server: () => 'async-node',
            renderer: () => 'web',
            preload: () => 'electron-preload',
            electron: () => 'electron-main'
        }),
        externals: [
            (context, request, callback) => {
                if(!Path.isAbsolute(request) && !/^\.\.?\//.test(request))
                    return callback();
                let path = Path.resolve(context, request);
                try{
                    path = require.resolve(path);
                }catch(err){
                    if(err.code === 'MODULE_NOT_FOUND')
                        return callback();
                    throw err;
                }
                if(path !== mainPath)
                    return callback();
                return callback(null, path, 'commonjs');
            }
        ],
        resolveLoader: {
            plugins: []
        },
        recordsPath: `${__dirname}/records.json`,
        plugins: [
            new SourceMapDevToolPlugin({
                filename: select(info.context, {
                    //preload needs to be inlined or the browser can't load it
                    preload: () => null,
                    default: () => '[file].map[query]',
                }),
                module: true,
                columns: true,
                moduleFilenameTemplate: '[resource-path]',
                sourceRoot: select(info.side, {
                    frontend: () => undefined,
                    backend: () => `${root}/`
                })
            }),
            new DefinePlugin({
                //contextual information
                CONTEXT: JSON.stringify(info.context),
                VARIANT: JSON.stringify(info.variant),
                SIDE: JSON.stringify(info.side),
                //helps identify if a module is the entry point
                IS_ENTRY_MODULE: DefinePlugin.runtimeValue(({module}) => {
                    let path = module.userRequest;
                    if(!path.startsWith(`${root}/src`))
                        return undefined;
                    for(let entry of config.entry){
                        if(!/^\.\.?\//.test(entry)) //don't process entries from node_modules
                            continue;
                        entry = Path.resolve(root, entry);
                        if(entry === path){
                            return select(info.side, {
                                frontend: () => 'true', //always entry
                                backend: () => '(require.main.filename === __filename)' //unless we're the server, in which case only maybe
                            });
                        }
                    }
                    return 'false';
                })
            }),
            //just handles removing files in watch mode. initial wipe is handled externally because electron stack has a unified output dir
            new CleanWebpackPlugin({
                cleanStaleWebpackAssets: false,
                cleanOnceBeforeBuildPatterns: []
            })
        ],
        node: select(info.side, {
            frontend: () => ({
                global: true,
                __filename: true,
                __dirname: true
            }),
            backend: () => ({
                global: false,
                __filename: false,
                __dirname: false
            })
        })
    };

    //node needs a little help to support source maps
    if(info.side === 'backend')
        config.entry.unshift('source-map-support/register');

    //don't bundle electron itself on the electron stack
    if(info.stack === 'electron')
        config.externals.push({electron: 'commonjs2 electron'});

    //region Babel: modern Js transpiling
    {
        jsLoaders.push({
            loader: 'babel-loader',
            options: {
                configFile: require.resolve('./babel.config'),
                envName: info.key,
                babelrc: false,
                cacheDirectory: `${cacheDir}/babel-loader`
            }
        });
    }
    //endregion

    //region Css: importing Css from Js
    if(info.side === 'frontend'){
        cssLoaders.push(
            {
                loader: 'style-loader',
                options: {
                    esModule: true
                }
            },
            {
                loader: 'css-loader',
                options: {
                    // modules: {
                    //     localIdentName: select(info.variant, {
                    //         development: () => '[name]_[local]_[hash:base64]',
                    //         production: () => '[hash:base64]'
                    //     })
                    // }
                }
            }
        );
    }
    //endregion

    //region PostCss: modern Css transpiling
    if(info.side === 'frontend'){
        cssLoaders.push({
            loader: 'postcss-loader',
            options: {
                config: {
                    path: require.resolve('./postcss.config'),
                    ctx: {
                        variant: info.variant,
                        context: info.context
                    }
                }
            }
        });
    }
    //endregion

    //region Sass/Scss: better Css
    if(info.side === 'frontend'){
        config.module.rules.push({
            //apply all the css modifications
            test: /\.s[ac]ss$/i,
            use: cssLoaders,
            sideEffects: true
        });
        config.module.rules.push({
            test: /\.s[ac]ss$/i,
            use: [
                {
                    //fixes relative imports in sass files
                    //  IMO this should be built into sass-loader
                    loader: 'resolve-url-loader'
                },
                {
                    loader: 'sass-loader',
                    options: {
                        //required by resolve-url-loader whether or not devtool is set
                        sourceMap: true
                    }
                }
            ]
        });
    }
    //endregion

    //region Vue: support for single file components
    if(info.side === 'frontend'){
        config.module.rules.push({
            test: /\.vue$/i,
            loader: 'vue-loader'
        });
        config.resolve.extensions.push('.vue');
        config.plugins.push(new VueLoaderPlugin());
    }
    //endregion

    //region Images: importing images from Js
    {
        config.module.rules.push({
            test: /\.(png|svg|jpe?g|gif)$/i,
            loader: 'file-loader',
            options: {
                name: '[path][name].[ext][query]',
                outputPath: 'assets/images'
            }
        });
    }
    //endregion

    //region Fonts: importing fonts from Js
    {
        config.module.rules.push({
            test: /\.(woff2?|eot|ttf|otf)$/i,
            loader: 'file-loader',
            options: {
                name: '[path][name].[ext][query]',
                outputPath: 'assets/fonts'
            }
        });
    }
    //endregion

    //region Json5: Json with comments
    {
        config.module.rules.push({
            test: /\.json5$/i,
            loader: 'json5-loader'
        });
    }
    //endregion

    //region Html: index file generation
    if(info.side === 'frontend' && info.context !== 'preload'){
        config.plugins.push(
            new HtmlWebpackPlugin({
                filename: 'index.html',
                template: `${root}/src/frontend/index.html`
            })
        );
    }
    //endregion

    //region Sandbox: prevent accidental inclusion of the other side's files
    {
        config.module.rules.push({
            include: path => {
                if(!path.startsWith(`${root}/src/`))
                    return false;
                for(let pattern of sandbox){
                    if(isMatch(pattern, path))
                        return false;
                }
                return true;
            },
            loader: info => ({
                loader: 'webpack-error-loader',
                options: {
                    message(){
                        return `Sandbox: cannot import '${info.resource}' from '${info.issuer}'`;
                    }
                }
            })
        });

        function isMatch(pattern, path){
            if(typeof pattern === 'string')
                return path.startsWith(pattern);
            else if(pattern instanceof RegExp)
                return pattern.test(path);
            else if(pattern instanceof Function)
                return pattern(path);
        }
    }
    //endregion

    //region Api: importing functions from the other side directly
    {
        let otherSide = select(info.side, {
            frontend: () => 'backend',
            backend: () => 'frontend'
        });
        select(info.side, {
            frontend: () => {
                //add the other side's api to the sandbox so it's accessible
                sandbox.push(path => (
                    path.startsWith(`${root}/src/${otherSide}/api/`)
                    && /\.api\.js$/i.test(path)
                ));
                config.plugins.push(
                    new WebpackApiClientPlugin({
                        root: `${root}/src/${otherSide}/api/`,
                        include: /\.api\.js$/i,
                        publicPath: select(info.context, {
                            client: () => '/api',
                            default: () => ''
                        }),
                        impl: select(info.context, {
                            client: () => 'webpack-api-plugin-xhr-client',
                            default: () => 'webpack-api-plugin-electron-ipc-renderer-client'
                        })
                    })
                );
            },
            backend: () => {
                config.plugins.push(
                    new WebpackApiServerPlugin({
                        root: `${root}/src/${info.side}/api/`,
                        include: /\.api\.js$/i
                    })
                );
            }
        });
    }
    //endregion

    //region Eslint: Js linting
    {
        let globals = [
            //built-in webpack variables
            '__resourceQuery',
            '__webpack_public_path__',
            '__webpack_require__',
            '__webpack_chunk_load__',
            '__webpack_modules__',
            '__webpack_hash__',
            '__non_webpack_require__',
            '__webpack_exports_info__'
        ];
        let definePlugin = config.plugins.find(plugin => plugin instanceof DefinePlugin);
        if(definePlugin != null)
            globals.push(...Object.keys(definePlugin.definitions));

        jsLoaders.push({
            loader: 'eslint-loader',
            options: {
                cache: `${cacheDir}/eslint-loader`,
                baseConfig: require('./eslint.config'),
                envs: select(info.side, {
                    frontend: () => ['browser'],
                    backend: () => ['node', 'es6']
                }),
                globals,
                useEslintrc: false
            }
        });
    }
    //endregion

    //region Hot Module Reload
    if(info.variant === 'development'){
        config.entry.unshift(
            ...select(info.side, {
                frontend: () => [`webpack-hot-middleware/client?name=${info.context}&noInfo=true`],
                backend: () => ['webpack/hot/signal']
            })
        );
        config.plugins.push(new HotModuleReplacementPlugin());
    }
    //endregion

    //region Pnp: support for yarn's Pnp resolution
    {
        config.resolve.plugins.push(PnpWebpackPlugin);
        config.resolveLoader.plugins.push(PnpWebpackPlugin.moduleLoader(module));
    }
    //endregion

    //region Optimization: exclude node modules from bundle
    if(info.context === 'server' || (info.context === 'electron' && info.variant === 'development')){
        let isHotReloadEnabled = config.plugins.some(plugin => plugin instanceof HotModuleReplacementPlugin);
        let isPnpEnabled = config.resolve.plugins.includes(PnpWebpackPlugin);
        let isServerApiEnabled = config.plugins.some(plugin => plugin instanceof WebpackApiServerPlugin);

        let exclude = [];
        if(isHotReloadEnabled)
            exclude.push(/^webpack\/hot\//);
        if(isServerApiEnabled)
            exclude.push(/^webpack-api-plugin\/api(\?|$)/);
        config.externals.push(
            WebpackNodeExternals({
                allowlist: exclude
            })
        );
        if(isPnpEnabled){
            config.externals.push(
                WebpackPnpExternals({
                    exclude
                })
            );
        }
    }
    //endregion

    //region Optimization: cache busting
    if(info.context === 'client' && info.variant === 'production'){
        config.output.filename = config.output.filename.replace(/\.js$/i, `.[contenthash].js`);
    }
    //endregion

    //region Optimization: chunk splitting
    if(info.context === 'client' && info.variant === 'production'){
        config.optimization.runtimeChunk = 'single';
        config.optimization.splitChunks = {
            cacheGroups: {
                vendor: {
                    test: /[/\\]node_modules[/\\]/,
                    name: 'vendor',
                    chunks: 'all',
                    enforce: true
                }
            }
        };
    }
    //endregion

    //region Optimization: minification
    if(info.variant === 'production'){
        config.optimization.minimize = true;
        config.optimization.minimizer = [
            new TerserWebpackPlugin({
                cache: `${cacheDir}/terser-webpack-plugin`
            }),
            new OptimizeCssAssetsWebpackPlugin()
        ];
    }else{
        config.optimization.minimize = false;
    }
    //endregion

    return config;
};