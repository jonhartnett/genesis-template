const ChildProcess = require('child_process');


function getElectronVersion(type){
    if('electron' in process.versions){
        let [major, minor] = process.versions[type].split('.', 3);
        return `${major}.${minor}`;
    }

    const ElectronExe = require('electron');

    let stdout = ChildProcess.execFileSync(ElectronExe, [__filename, type], {
        encoding: 'utf8',
        timeout: 1000
    });
    stdout = stdout.trim();
    if(!/\d+.\d+/.test(stdout))
        throw new Error(`Unexpected format for electron version query output:\n${stdout}`);
    return stdout;
}

Object.assign(module.exports, {
    getElectronVersion
});

if(require.main === module){
    let type = process.argv[2];
    console.log(getElectronVersion(type));
    process.exit(0);
}
