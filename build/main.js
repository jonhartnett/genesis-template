const Webpack = require('webpack');
const {Command: Commander} = require('commander');
const Fs = require('fs-extra');
const ElectronExe = require('electron');
const ChildProcess = require('child_process');
const ElectronBuilder = require('electron-builder');
const Path = require('path');

function parseArgv(){
    let parser = new Commander();
    parser.storeOptionsAsProperties(false);

    parser.version('1.0.0', '-v,--version');
    parser.option('--variant <variant>', 'environment variant to build for, production or development');
    parser.option('--stack <stack>', 'stack to build for, web or electron. Can be specified multiple times', (value, arr) => [...arr, value], []);
    parser.command('develop')
        .description('runs the application while watching for file system changes');
    parser.command('build')
        .description('builds the application for distribution');
    parser.command('package')
        .description('packages the application up for distribution');
    parser.command('run')
        .description('runs the application');

    parser.parse();

    return {args: parser.args, options: parser.opts()};
}

class BuildInfo {
    /** @returns {BuildInfo} */
    static get(context, variant){
        if(arguments.length === 1)
            [context, variant] = arguments[0].split(',');
        let key = `${context},${variant}`;
        let info = this._cache.get(key);
        if(info == null){
            info = new BuildInfo(context, variant);
            this._cache.set(key, info);
        }
        return info;
    }

    constructor(context, variant) {
        if(!['client', 'server', 'renderer', 'preload', 'electron'].includes(context))
            throw new Error(`Invalid context '${context}'. Expected 'client', 'server', 'renderer', 'preload', or 'electron'.`);
        if(!['development', 'production'].includes(variant))
            throw new Error(`Invalid variant '${variant}'. Expected 'development' or 'production'.`);
        this.context = context;
        this.variant = variant;
    }

    get key(){
        return `${this.context},${this.variant}`;
    }

    get shortVariant(){
        return select(this.variant, {
            development: () => 'dev',
            production: () => 'prod'
        });
    }

    get side(){
        switch(this.context){
            case 'client':
            case 'renderer':
            case 'preload':
                return 'frontend';
            case 'server':
            case 'electron':
                return 'backend';
            default:
                throw new Error(`Not implemented: ${this.context}`);
        }
    }

    get stack(){
        switch(this.context){
            case 'client':
            case 'server':
                return 'web';
            case 'renderer':
            case 'preload':
            case 'electron':
                return 'electron';
            default:
                throw new Error(`Not implemented: ${this.context}`);
        }
    }

    get webpackConfig(){
        let {context, variant} = this;
        let config = require('./webpack.config')({context, variant}, {});
        Object.defineProperty(this, 'webpackConfig', {value: config});
        return config;
    }

    get babelConfigPath(){
        let path = require.resolve('./babel.config');
        Object.defineProperty(this, 'babelConfigPath', {value: path});
        return path;
    }

    get postcssConfigPath(){
        let path = require.resolve('./postcss.config');
        Object.defineProperty(this, 'postcssConfigPath', {value: path});
        return path;
    }

    get browserListConfig(){
        let config = require('./browserlist.config')(this);
        Object.defineProperty(this, 'browserListConfig', {value: config});
        return config;
    }

    get eslintConfig(){
        let config = require('./eslint.config');
        Object.defineProperty(this, 'eslintConfig', {value: config});
        return config;
    }

    get electronBuilderConfig(){
        let config = require('./electron-builder.config')(this);
        Object.defineProperty(this, 'electronBuilderConfig', {value: config});
        return config;
    }
}
BuildInfo._cache = new Map();

function getWebpackConfigs(contexts, variant){
    const WebpackConfig = require('./webpack.config');
    return contexts.map(context => (
        WebpackConfig({context, variant}, {})
    ));
}

async function clearOutPaths(configs){
    const distDir = Path.resolve(`${__dirname}/../dist`);
    let paths = new Set();
    for(let config of configs){
        let path = Path.resolve(config.output.path);
        let relPath = Path.relative(distDir, path);
        if(!relPath || relPath.startsWith('../') || Path.isAbsolute(relPath))
            throw new Error(`Cannot remove output path '${path}' outside of '${distDir}'. This is a safety mechanism which prevent accidental removal of files`);
        paths.add(path);
    }
    paths = [...paths];
    await Promise.all(paths.map(path => (
        Fs.remove(path)
    )));
}

function run(info, stack){
    let procs = [];
    if(info.variant === 'development' && stack.has('web') && stack.has('electron')){
        procs.push(runElectron(info, [
            '--dev-server-context=renderer',
            '--dev-server-context=preload',
            '--dev-server-context=client'
        ]));
    }else{
        if(stack.has('web'))
            procs.push(runServer(info));
        if(stack.has('electron'))
            procs.push(runElectron(info));
    }
    return procs;
}

function runServer(info, args=[]){
    const serverMain = require.resolve(`../dist/${info.shortVariant}/server/main`);
    return ChildProcess.fork(serverMain, args, {
        stdio: 'inherit'
    });
}

function runElectron(info, args=[]){
    const electronMain = require.resolve(`../dist/${info.shortVariant}/electron/main.electron`);
    let env = {...process.env};
    args.unshift(electronMain);
    if(process.versions.pnp){
        //region Remove --require '.pnp.js' from NODE_OPTIONS
        {
            let nodeOptions = env.NODE_OPTIONS.split(/\s+/);
            for(let i = 0; i < nodeOptions.length - 1; i++){
                if(nodeOptions[i] === '--require' && nodeOptions[i + 1] === module.pnpApiPath){
                    nodeOptions.splice(i, 2);
                    break;
                }
            }
            env.NODE_OPTIONS = nodeOptions.join(' ');
        }
        //endregion
        args.unshift(
            '--require',
            require.resolve('./electron.patch.js'),
            '--require',
            module.pnpApiPath
        );
    }
    return ChildProcess.spawn(ElectronExe, args, {
        stdio: 'inherit',
        env
    });
}

async function waitForExit(...procs){
    await Promise.all(procs.map(proc => (
        new Promise(resolve => {
            proc.once('exit', resolve);
        })
    )));
}

async function main([cmd, ...args], options={}){
    let {
        variant='production',
        stack=[]
    } = options;
    if(stack.length === 0)
        stack.push('web', 'electron');
    /** @type {Set} */
    stack = new Set(stack);
    let info = new BuildInfo('client', variant);
    switch(cmd){
        case 'develop': {
            let contexts = [];
            if(variant === 'development' && stack.has('web') && stack.has('electron')){
                //server is bundled into electron, so we don't need web
                contexts.push('electron');
            }else{
                if(stack.has('web'))
                    contexts.push('server');
                if(stack.has('electron'))
                    contexts.push('electron');
            }
            let configs = getWebpackConfigs(contexts, variant);
            await clearOutPaths(configs);
            let compiler = Webpack(configs);
            let watching;
            let procs = [];
            await new Promise(resolve => {
                watching = compiler.watch({
                    ignored: /[/\\]node_modules[/\\]/
                }, (err, stats) => {
                    if(err){
                        console.error(err);
                        return;
                    }
                    console.log(stats.toString({
                        chunks: false,
                        colors: true
                    }));
                    if(resolve != null){
                        resolve();
                        resolve = null;
                    }else{
                        //notify HMR
                        for(let proc of procs)
                            proc.kill('SIGUSR2');
                    }
                });
            });
            try{
                procs = run(info, stack);
                await waitForExit(...procs);
            }finally{
                watching.close();
            }
            break;
        }
        case 'build': {
            let contexts = [];
            if(stack.has('web'))
                contexts.push('client', 'server');
            if(stack.has('electron'))
                contexts.push('renderer', 'preload', 'electron');
            let configs = getWebpackConfigs(contexts, variant);
            await clearOutPaths(configs);
            let compiler = Webpack(configs);
            let stats = await new Promise((resolve, reject) => {
                compiler.run((err, stats) => {
                    if(err)
                        reject(err);
                    else
                        resolve(stats);
                });
            });
            console.log(stats.toString({
                chunks: false,
                colors: true
            }));
            break;
        }
        case 'package': {
            if(stack.has('electron')){
                let config = info.electronBuilderConfig;
                let result = await ElectronBuilder.build({
                    config
                });
                console.log(result);
            }
            break;
        }
        case 'run': {
            let procs = run(info, stack);
            await waitForExit(...procs);
            break;
        }
        default: throw new Error('Not implemented');
    }
}

function select(key, obj){
    if(key in obj)
        return obj[key]();
    else if('default' in obj)
        return obj.default(key);
    else
        throw new Error('Not implemented');
}

Object.assign(module.exports, {
    parseArgv,
    BuildInfo,
    getWebpackConfigs,
    main,
    select
});

if(require.main === module){
    let {args, options} = parseArgv();
    main(args, options).catch(console.error);
}