//note: this is not an official browserlist config format
//  it is specific to this project

const { select } = require('./main');
const { getElectronVersion } = require('./electron-version-query');

module.exports = info => {
    return select(info.context, {
        client: () => ['> 0.5%', 'last 2 versions', 'Firefox ESR', 'not dead'],
        server: () => ['current node'],
        renderer: () => [`chrome ${getElectronVersion('chrome')}`],
        preload: () => [`chrome ${getElectronVersion('chrome')}`],
        electron: () => [`node ${getElectronVersion('node')}`]
    });
};
