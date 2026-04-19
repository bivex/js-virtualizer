const __JSV_RUNTIME = typeof globalThis !== 'undefined' && globalThis.JSVM ? globalThis.JSVM : typeof require === 'function' ? require('./verify.vm.js') : null;
function add(a, b) {
    const __jsv_arg_36543198 = a;
    const __jsv_arg_1c19bc53 = b;
    const VM = new __JSV_RUNTIME({
        'profileId': 'vm_6e0c5120ea',
        'registerCount': 192,
        'dispatcherVariant': 'striped',
        'aliasBaseCount': 3,
        'aliasJitter': 2,
        'decoyCount': 45,
        'decoyStride': 1,
        'runtimeOpcodeDerivation': 'stateful',
        'polyEndian': 'BE'
    });
    VM.enableMemoryProtection('3846f8fd5a49f2e2e614e167a3f7b9b9');
    VM.setBytecodeIntegrityKey('79ad87f6c8f0ada9712e332638ce283c');
    VM.enableAntiDebug('35edbe547a7b7dcb6e2b3a9d1b3c9b32');
    VM.enableSelfModifyingBytecode('865315e6ed161617568c116dc1af6140');
    VM.enableAntiDump('0d20b2048d5e3bdbb0f1ce186b2c1102');
    VM.write(191, 1468289234);
    VM.loadFromString('JSCX1:61d0a18f33b05346:JSVK_29e4752837ce:IJS:d6cb3e606fec9aa93be67c123b8469b3:5tX8Bj969VZqqQ0kMvR6QQKCU7JT5SjYqH4ddM/CjspyvpGAOSvYJf40UzKDkQQg7SCGIh0gcw6NCAAEAFxxbMVU6Jpvup+/uHqHKA==', 'base64');
    VM.loadDependencies({
        108: __jsv_arg_36543198,
        147: __jsv_arg_1c19bc53
    });
    VM.run();
    return VM.read(65);
}
function sub(a, b) {
    const __jsv_arg_7df567a8 = b;
    const __jsv_arg_004d587b = a;
    const VM = new __JSV_RUNTIME({
        'profileId': 'vm_6e0c5120ea',
        'registerCount': 192,
        'dispatcherVariant': 'striped',
        'aliasBaseCount': 3,
        'aliasJitter': 2,
        'decoyCount': 45,
        'decoyStride': 1,
        'runtimeOpcodeDerivation': 'stateful',
        'polyEndian': 'BE'
    });
    VM.enableMemoryProtection('b0f78a389e41227835a508ac68ae80db');
    VM.setBytecodeIntegrityKey('79ad87f6c8f0ada9712e332638ce283c');
    VM.enableAntiDebug('e923462ff4464936e1653b1b0007305d');
    VM.enableSelfModifyingBytecode('b8f999fa7a815e14fd9da7994079e1f7');
    VM.enableAntiDump('56844faeaf3ac3649637b27757f6b573');
    VM.write(191, 2083227582);
    VM.loadFromString('JSCX1:25dea031055b19d1:JSVK_8b307f05b843:IJS:850f91438b0e63282858df57107406ef:qaSCtAlx6mFGQIgTvma4CBATJczZ/RW9c9FBEH86OX1z1kwSCZcbCkVcrb7iUGWtaQoM2XP4tfhlj5WmBwmRHknp4TVejnIb1Is59Q==', 'base64');
    VM.loadDependencies({
        149: __jsv_arg_004d587b,
        162: __jsv_arg_7df567a8
    });
    VM.run();
    return VM.read(105);
}
const r1 = add(10, 5);
const r2 = sub(10, 5);
console.log('RESULT_ADD=' + r1);
console.log('RESULT_SUB=' + r2);