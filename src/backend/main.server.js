import Http from 'http';
import Https from 'https';
import Express from 'express';
import Path from 'path';
import Fs from 'fs-extra';
import * as api from 'webpack-api-plugin/api';
import ApiMiddlewareServer from 'webpack-api-plugin-middleware-server';
import {Command as Commander} from 'commander';
import {version as packageVersion} from '../../package.json';

function parseArgv(){
    let parser = new Commander();
    parser.storeOptionsAsProperties(false);

    let version = packageVersion;
    if(VARIANT !== 'production')
        version = `${version}-${VARIANT}`;
    parser.version(version, '-v,--version');

    parser.option('--host <host>', '');
    parser.option('--port <port>', '');
    //only enable secure option in development (because it's forced on in production)
    if(VARIANT === 'development')
        parser.option('--secure', '');
    parser.option('--key-file <path>', '');
    parser.option('--cert-file <path>', '');
    if(VARIANT === 'development')
        parser.option('--context <context>', '', (value, arr) => [...arr, value], []);

    parser.parse();

    return {args: parser.args, options: parser.opts()};
}

//middleware to rewrite non-file paths to index.html
function rewritePaths(req, res, next){
    //note: 'http://localhost' is irrelevant, but URL forces us to pass something
    let url = new URL(req.url, 'http://localhost');

    //don't rewrite hmr
    if(VARIANT === 'development' && url.pathname === '/__webpack_hmr'){
        next();
        return;
    }

    //rewrite all paths that don't look like files (i.e. have no extension)
    if(Path.posix.extname(url.pathname) === '')
        url.pathname = '/client/index.html';

    req.url = url.pathname + url.search;
    next();
}

export async function main(args, options={}){
    let {
        host='localhost',
        port=8080,
        secure=VARIANT !== 'development',
        keyFile=null,
        certFile=null
    } = options;
    if(secure && (keyFile == null || certFile == null))
        throw new Error('Must specify --key-file and --cert-file');

    let express = new Express();

    //mount our API middleware
    express.use('/api', ApiMiddlewareServer(() => api));

    express.use(rewritePaths);

    if(VARIANT === 'development'){
        //in development, use a hot-reloading dev middleware
        const {default: WebpackHotMiddleware} = await import('webpack-hot-middleware');
        const {default: WebpackDevMiddleware} = await import('webpack-dev-middleware');
        const {default: Webpack} = await import('webpack');
        const {getWebpackConfigs} = await import('../../build/main');
        let {
            context=[],
            writeToDisk=undefined
        } = options;
        if(context.length === 0)
            context.push('client');
        let configs = getWebpackConfigs(context, VARIANT);
        let compiler = Webpack(configs);
        express.use(WebpackHotMiddleware(compiler));
        express.use(WebpackDevMiddleware(compiler, {
            index: false,
            writeToDisk
        }));
        express.use((req, res, next) => next(404));
    }else{
        //in production, use a static file server
        express.use('/client', Express.static('./dist/prod/client/', {
            dotfiles: 'allow',
            fallthrough: false,
            index: false
        }));
    }

    express.use((err, req, res, next) => {
        if(res.headersSent)
            return next(err);
        switch(err){
            case 404: {
                res.status(404).send();
                return;
            }
            default: {
                return next(err);
            }
        }
    });

    //create the http(s) server which uses the express app
    let server;
    if(secure){
        let [key, cert] = Promise.all([
            Fs.readFile(keyFile),
            Fs.readFile(certFile)
        ]);
        server = Https.createServer({
            key, cert
        }, express);
    }else{
        server = Http.createServer(express);
    }

    await new Promise((resolve, reject) => {
        server.listen({
            host,
            port,
            exclusive: false
        }, err => {
            if(err)
                reject(err);
            else
                resolve();
        });
    });

    let app = {
        options,
        server,
        express,
        get url(){
            return `${secure ? 'https' : 'http'}://${host}:${port}`;
        }
    };

    console.log(`Server now listening on ${app.url}`);

    return app;
}

if(IS_ENTRY_MODULE) {
    let {args, options} = parseArgv();
    main(args, options)
        .catch(console.error);
}

//allow the API to be hot-reloaded
if(module.hot)
    module.hot.accept('webpack-api-plugin/api');
