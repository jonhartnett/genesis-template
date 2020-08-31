//note: this is not an official electron-builder config format
//  it is specific to this project

const Path = require('path');
const ElectronPackage = require('electron/package.json');

module.exports = info => {
    let root = Path.resolve(`${__dirname}/..`);

    return {
        appId: 'dev.hartnett.genesis-template',
        productName: 'Genesis Template',
        directories: {
            output: `${root}/dist/prod/electron/packaged`,
            app: root
        },
        linux: {
            target: ['deb'],
            executableName: 'genesis-template'
        },
        extraMetadata: {
            name: 'genesis-template',
            main: './dist/prod/electron/main.electron.js',
            dependencies: {},
            devDependencies: {
                'electron': ElectronPackage.version
            }
        },
        // readonly: true,
        files: [
            'dist/prod/electron/**/*',
            '!dist/prod/electron/packaged'
        ]
    };
};