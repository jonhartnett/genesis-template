/*
 * This file contains some miscellaneous patches that we need to make electron work properly
 */

//region PnP support
{
    const Module = require('module');
    //add electron to builtinModules list so pnp doesn't try to intercept it
    Module.builtinModules = Object.preventExtensions([
        ...Module.builtinModules,
        'electron'
    ]);
}
//endregion

//region Fix args
{
    //bizarrely, default_app (the thing that loads your script when electron is not yet bundled)
    //  doesn't remove its own flags from process.argv, so we're left to deal with them ourselves
    let i = 1;
    while(i < process.argv.length && process.argv[i] === '--require')
        i += 2;
    process.argv.splice(1, i - 1);
}
//endregion