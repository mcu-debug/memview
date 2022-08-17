import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { myGlobals, vscodePostCommand } from './globals';
import * as Utils from './utils';
import { RecoilRoot } from 'recoil';
import './index.css';
import { HexTableVirtual } from './hex-table-virtual';
import { MemViewToolbar } from './top-panel';
import { WebviewDoc, IWebviewDocXfer, ICmdGetMemory, IGetMemoryCommand } from './webview-doc';

class FetchMemoryFromVSCode implements IGetMemoryCommand {
    getMoreMemory(arg: ICmdGetMemory): Promise<Buffer> {
        return vscodePostCommand(arg);
    }
}

try {
    if ((window as any)?.initialDataFromVSCode) {
        const opts = JSON.parse((window as any).initialDataFromVSCode);
        WebviewDoc.init(new FetchMemoryFromVSCode());
        if (Array.isArray(opts)) {
            for (const item of opts) {
                const xferObj = item as IWebviewDocXfer;
                const doc = new WebviewDoc(xferObj);
                WebviewDoc.addDocument(doc, !!xferObj.isCurrentDoc);
                doc.isReady = true;
                console.log(doc);
            }
        } else {
            myGlobals.bytes = new Uint8Array(opts.bytes.data);
            // console.log(`${Object.prototype.toString.call(opts.bytes)}`);
            // console.log(myGlobals.bytes.length);
            myGlobals.minAddress = 0n;
            myGlobals.maxAddress = BigInt(myGlobals.bytes.length - 1);
        }
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

const startAddr = WebviewDoc.currentDoc?.startAddress ?? 0n;
const numBytes = Number((WebviewDoc.currentDoc?.maxAddress ?? 0n) - startAddr);
ReactDOM.render(
    <RecoilRoot>
        <MemViewToolbar junk='abcd'></MemViewToolbar>
        <HexTableVirtual address={startAddr} byteStart={0} numBytes={numBytes} dirty={false} />
    </RecoilRoot>,
    document.getElementById('root')
);

myGlobals.vscode.postMessage({ type: 'started' });
console.log(`HexTable:render ${timer.deltaMs()}ms`);
