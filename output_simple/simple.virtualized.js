const __JSV_RUNTIME = typeof globalThis !== 'undefined' && globalThis.JSVM ? globalThis.JSVM : typeof require === 'function' ? require('./simple.vm.js') : null;
function add(a, b) {
    const __jsv_arg_22215a71 = b;
    const __jsv_arg_211afe3a = a;
    const VM = new __JSV_RUNTIME({
        'profileId': 'vm_f8f107d569',
        'registerCount': 192,
        'dispatcherVariant': 'clustered',
        'aliasBaseCount': 4,
        'aliasJitter': 3,
        'decoyCount': 44,
        'decoyStride': 1,
        'runtimeOpcodeDerivation': 'hybrid',
        'polyEndian': 'LE'
    });
    VM.enableMemoryProtection('0df9e80617667490fe20c925cdc06b7e');
    VM.setBytecodeIntegrityKey('c5fe4f01de82fae1104d76fa30827d46');
    VM.enableAntiDebug('b01f5227c28544efa0430b61f9ba8f4f');
    VM.enableSelfModifyingBytecode('61a0cf8f54f54e6f166117cc58c05040');
    VM.enableAntiDump('e6a5824b58cc47409f0ca981de371901');
    VM.write(191, 0);
    VM.loadFromString('JSCX1:1430f7c857b6115b:JSVK_bb95beff6a67:IJS:42a9e6804b272efd21d5aee09b0281d0:0Ocsjiy2cvzHfRJKZx40xmJFYAa3ACimQNMpaXvg7AKY/MhdW4WbYkPOtdGw0j6Yu09TWmW8OYyMebjiu41CT4sivgFIyhVJ/2ouig7YU5QJB2dUkC2vRIyukm+K3a5mS4T2cyOzXyLMS1TVvGuRYzlGMeXFCRPgVbBPSM7suvh5qPaBvZWxbSD/LwJ2nMD/jqz9eVOr2SOH9H8/UpbUqGMC7kLMZ2MOELnI8NgIKIgkqrubyO7R4eEaiZGNfQCUGVYjMeJaa+yI3k3oqhqrGPzFD4VK1Nqa+rji8URI6XYwJ2wI4JcV3puIDdk1deLoweVg/r1H7V/Oui8yhmutrNrT1j0aN+yIBQbFoItfoKQMYwzoPubri8AuqBUNftoG4JpqYYfWDt3pRLPnVRnMex8KVGtCG8LfZMlPpc/jSESNJwU5wj+GrTSRfA0oB7C4n1V/TScr0Kv1bMOwTlCvPfD8RvA=', 'base64');
    VM.loadDependencies({
        13: __jsv_arg_211afe3a,
        78: __jsv_arg_22215a71,
        187: console
    });
    VM.run();
    return VM.read(61);
}
const r = add(5, 3);
if (r !== 8) {
    console.log('Failed: r=' + r);
    process.exit(1);
}
console.log('SUCCESS');