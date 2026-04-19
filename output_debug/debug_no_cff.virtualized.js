const __JSV_RUNTIME = typeof globalThis !== 'undefined' && globalThis.JSVM ? globalThis.JSVM : typeof require === 'function' ? require('./debug_no_cff.vm.js') : null;
function add(a, b) {
    const __jsv_arg_7dba2b9d = b;
    const __jsv_arg_4e8add6e = a;
    const VM = new __JSV_RUNTIME({
        'profileId': 'vm_c07fb118f0',
        'registerCount': 192,
        'dispatcherVariant': 'clustered',
        'aliasBaseCount': 3,
        'aliasJitter': 3,
        'decoyCount': 43,
        'decoyStride': 1,
        'runtimeOpcodeDerivation': 'hybrid',
        'polyEndian': 'BE'
    });
    VM.enableMemoryProtection('51574cef503a0572f8ff45a5a14fd0b4');
    VM.setBytecodeIntegrityKey('00b5b656220cb85d697776b8e940bd87');
    VM.enableAntiDebug('1832b1e8ddeacdbabfbe2ce16ec6a6ae');
    VM.enableSelfModifyingBytecode('67fa76ff6758bddb4e0bc718b9cb3558');
    VM.enableAntiDump('5e2c00db399c0c82731747cb1f704c48');
    VM.write(191, 0);
    VM.loadFromString('JSCX1:a06c5f5f9b04e15c:JSVK_8d412747a01a:IJS:68a75db3a9339ee5f53eb46ad3bd2d76:ggzmXmyYsa7lhbRSYGbaGh+qVWTnmyJLX7px9erUMijHBafgOcsnMlaWet/PtL5l7iiJQsSvzp4LZHzLfrEjnf7rZru/Pd1TVJOTVUgNMmkBY4b1gJ3lcQpqykknny13C4WpOqMYuYOjgBF5a1HF3JW1s/jZQru2P+MyAfILZmmVjQSF67crEJBmtUNcFju1QIhDIJwYZA3gR5FJm8jbtq7j9IRvRqveiW2li5kwTWj0RYNw5sL8rwU6MI3d4vUGJ3MsMI2RrWj7t62OJxwAEY2JxokkVq42VPP7lT1GXNM2c+2JiG+YlbKcsbaw7IzrZhrfPw0L/pg4vzfkhgd3oBsBEEK7VOV1e8evkhrTeHKFCjLpkG9qx+k2mZMHMdP1/fNrtmiapHmx2AxPycTEmwC/LIgwkITtwZpa6HkmaD78jTS2PeKw2OqXgmvFJrUAnZUSIV3zSOg0c4k0lZZuRm4LbZ9P/G+cqkaqw4CXQOXs31sV1qt6fbMgXX+wkPkxee90Fe+8f9kzdtYfmckPMc3muLPGZAy3LKTIypTJJx3SZkhzLrq4C2URSdaA7ijSgeR38VpGrWbPKfHZ', 'base64');
    VM.loadDependencies({
        116: console,
        141: __jsv_arg_7dba2b9d,
        177: __jsv_arg_4e8add6e
    });
    VM.run();
    return VM.read(33);
}
function sub(a, b) {
    const __jsv_arg_4980f1fd = b;
    const __jsv_arg_e8e86b34 = a;
    const VM = new __JSV_RUNTIME({
        'profileId': 'vm_c07fb118f0',
        'registerCount': 192,
        'dispatcherVariant': 'clustered',
        'aliasBaseCount': 3,
        'aliasJitter': 3,
        'decoyCount': 43,
        'decoyStride': 1,
        'runtimeOpcodeDerivation': 'hybrid',
        'polyEndian': 'BE'
    });
    VM.enableMemoryProtection('6ebc73c98b528bab3e762f5a8cbd954c');
    VM.setBytecodeIntegrityKey('00b5b656220cb85d697776b8e940bd87');
    VM.enableAntiDebug('8b4919b09ce6c0fbe8bcdf5768f8b752');
    VM.enableSelfModifyingBytecode('d9b58e8d871f0039717b51f97e824ac9');
    VM.enableAntiDump('b049c3d84887b16e92051dea68e7be44');
    VM.write(191, 0);
    VM.loadFromString('JSCX1:bad2ae36e9a201a3:JSVK_31c2700a27b8:IJS:d5f602beb387442f9a119530fb3e7be0:nlPEnmTPDAOBEKMLjOS1ualWTTqyELLRRIJaY6wezvMyvWLMB5cerZrwzyqLu2QbNOcXBYVRkV29EAoXJ9ym++0olJgpToX0wgClAbLL2AXeR2u4wYSGvvsUL3qv4XiIAs8YvLXkWv2RK5flWxB//hAEjp0kcqO9otjjII0Q8VkXRXjhTT5V0iweeIjkHVp/UgrDrNwlE3ZEunpOfakXdCsoIwcvyqiE9vfUHD9BOcxVbFd3Dus5jRlrTE+MFL2Xh+e5fWxM9KTuyB9Lg6/leIV2ir1lfXGZLsAXB9SUZnfvPDVG5HKYaDhkeqi2/qygxDwoVPDguX535xwykStY/hUCdYgCQLHl2V7ChPKOsAuIFeWicUuddlXlLRZk5T3TpY5hjRx5ROMh1Qfkmw6vTicXfYpge/9ywY0yfcigzKsQK9Y4MJ4pGBZikLkB0uIdvay/TEKqG2ubc5HtmiFXEf57Kx8fY3XFuD2TaO757RM=', 'base64');
    VM.loadDependencies({
        96: __jsv_arg_4980f1fd,
        130: __jsv_arg_e8e86b34,
        141: console
    });
    VM.run();
    return VM.read(166);
}
const r1 = add(20, 10);
const r2 = sub(20, 10);
if (r1 !== 30 || r2 !== 10) {
    console.log('Failed values: r1=' + r1 + ', r2=' + r2);
    process.exit(1);
}
console.log('SUCCESS');