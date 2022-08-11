import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { myGlobals } from './globals';
import * as Utils from './utils';
import { RecoilRoot } from 'recoil';
import './index.css';
import { HexTable } from './hex-elements';
import { HexTableVirtual } from './hex-table-virtual';

// const vscode = window.acquireVsCodeApi();

try {
    if ((window as any)?.initialDataFromVSCode) {
        const opts = JSON.parse((window as any).initialDataFromVSCode);
        myGlobals.bytes = new Uint8Array(opts.bytes.data);
        // console.log(`${Object.prototype.toString.call(opts.bytes)}`);
        // console.log(myGlobals.bytes.length);
        myGlobals.minAddress = 0n;
        myGlobals.maxAddress = BigInt(myGlobals.bytes.length - 1);
    } else {
        console.error('No initial data from vscode. Using random bytes');
    }
} catch (e: any) {
    console.log(e.toString());
}

if (!myGlobals.bytes) {
    const bytes = new Uint8Array(2 * 1024);
    for (let ix = 0; ix < bytes.length; ix++) {
        bytes[ix] = Math.floor(Math.random() * 255) & 0xff;
    }
    myGlobals.bytes = bytes;
    myGlobals.minAddress = 0n;
    myGlobals.maxAddress = BigInt(myGlobals.bytes.length - 1);
}

myGlobals.origBytes = Uint8Array.from(myGlobals.bytes);

const timer = new Utils.Timekeeper();
/*
ReactDOM.render(
    <RecoilRoot>
        <HexTable
            address={myGlobals.minAddress}
            byteStart={0}
            numBytes={myGlobals.bytes.length}
            dirty={false}
        />
    </RecoilRoot>,
    document.getElementById('root')
);
*/

ReactDOM.render(
    <RecoilRoot>
        <HexTableVirtual
            address={myGlobals.minAddress}
            byteStart={0}
            numBytes={myGlobals.bytes.length}
            dirty={false}
        />
    </RecoilRoot>,
    document.getElementById('root')
);

myGlobals.vscode.postMessage({ type: 'started' });
console.log(`HexTable:render ${timer.deltaMs()}ms`);
