import {app, BrowserWindow, ipcMain} from 'electron';
import installExtension, {VUEJS_DEVTOOLS as vueExtension} from 'electron-devtools-installer';
import Path from 'path';
import * as api from 'webpack-api-plugin/api';
import ApiIpcMainServer from 'webpack-api-plugin-electron-ipc-main-server';
import {Command as Commander} from 'commander';
import { version as packageVersion } from '../../package.json';


function parseArgv(args){
    let parser = new Commander();
    parser.storeOptionsAsProperties(false);

    let version = packageVersion;
    if(VARIANT !== 'production')
        version = `${version}-${VARIANT}`;
    parser.version(version, '-v,--version');

    if(VARIANT === 'development'){
        //parse arguments destined for the dev server
        parser.option('--dev-server-host <host>', '');
        parser.option('--dev-server-port <port>', '');
        parser.option('--dev-server-secure', '');
        parser.option('--dev-server-key-file <path>', '');
        parser.option('--dev-server-cert-file <path>', '');
        parser.option('--dev-server-context <context>', '', (value, arr) => [...arr, value], []);
    }

    parser.parse();

    if(VARIANT === 'development'){
        //pull dev-server options into separate object
        let options = parser.opts();
        let devServer = {};
        for(let [key, value] of Object.entries(options)){
            let match = /^devServer([A-Z])(.+)/.exec(key);
            if(match == null)
                continue;
            delete options[key];
            key = match[1].toLowerCase() + match[2];
            devServer[key] = value;
        }
        options.devServer = devServer;
    }

    return {args: parser.args, options: parser.opts()};
}

//opens the given url in a new window
async function createWindow(url){
    const window = new BrowserWindow({
        show: false,
        //isolate the frontend for security reasons
        webPreferences: {
            preload: Path.join(__dirname, 'main.preload.js'),
            contextIsolation: true,
            worldSafeExecuteJavaScript: true,
            enableRemoteModule: false
        }
    });

    window.once('ready-to-show', () => {
        window.maximize();
        window.show();
    });

    if(VARIANT === 'development')
        window.webContents.openDevTools();

    await window.loadURL(url);

    return window;
}

async function main(args, options={}){
    //disable some stuff for better security
    app.on('web-contents-created', (event, webContents) => {
        //don't allow new views to be mounted
        webContents.on('will-attach-webview', (event, webPreferences, params) => {
            event.preventDefault();
        });
        //don't allow navigation
        webContents.on('will-navigate', (event, url) => {
            event.preventDefault();
        });
        //don't allow new windows to be opened
        webContents.on('new-window', (event, url) => {
            event.preventDefault();
        });
    });

    //add our API handler
    ipcMain.handle('api', ApiIpcMainServer(() => api));

    await app.whenReady();

    // await installExtension(vueExtension);

    let url = `file://${__dirname}/index.html`;

    //in development, start the integrated server and load off that so we get hot reload and such
    if(VARIANT === 'development'){
        const {main: serverMain} = await import('./main.server');

        let {
            host=undefined,
            port=undefined,
            secure=undefined,
            keyFile=undefined,
            certFile=undefined,
            context=[]
        } = options.devServer;
        if(context.length === 0)
            context.push('renderer', 'preload');
        let app = await serverMain([], {
            host, port,
            secure, keyFile, certFile,
            context,
            writeToDisk: true
        });

        url = `${app.url}/renderer/index.html`;
    }

    while(true){
        let window = await createWindow(url);

        await new Promise(resolve => {
            window.on('closed', resolve);
        });

        //on mac, it's common to keep the application open when the window is closed
        if(process.platform !== 'darwin')
            break;

        await new Promise(resolve => {
            app.once('activate', resolve);
        });
    }
}

if(IS_ENTRY_MODULE){
    let {args, options} = parseArgv();
    main(args, options)
        .catch(console.error)
        .finally(() => app.quit());
}

//allow the API to be hot-reloaded
if(module.hot)
    module.hot.accept('webpack-api-plugin/api');
