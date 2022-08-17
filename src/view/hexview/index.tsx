import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { globalsInit, myGlobals, vscodePostCommand } from './webview-globals';
import * as Utils from './utils';
import { RecoilRoot } from 'recoil';
import './index.css';
import { HexTableVirtual } from './hex-table-virtual';
import { MemViewToolbar } from './top-panel';
import {
    WebviewDoc,
    IWebviewDocXfer,
    ICmdGetMemory,
    IMemoryInterfaceCommands,
    ICmdGetDocuments,
    CmdType,
    ICmdBase,
    ICmdSetMemory
} from './webview-doc';

class MemoryInterfaceFromVSCode implements IMemoryInterfaceCommands {
    getMemory(arg: ICmdGetMemory): Promise<Buffer> {
        return vscodePostCommand(arg);
    }
    setMemory(arg: ICmdSetMemory): Promise<boolean> {
        return vscodePostCommand(arg);
    }
}

globalsInit();
WebviewDoc.init(new MemoryInterfaceFromVSCode());

const timer = new Utils.Timekeeper();
function start() {
    const startAddr = WebviewDoc.currentDoc?.startAddress ?? 0n;
    const numBytes = Number((WebviewDoc.currentDoc?.maxAddress ?? 0n) - startAddr);
    ReactDOM.render(
        <RecoilRoot>
            <MemViewToolbar junk='abcd'></MemViewToolbar>
            <HexTableVirtual address={startAddr} byteStart={0} numBytes={numBytes} dirty={false} />
        </RecoilRoot>,
        document.getElementById('root')
    );

    myGlobals.vscode?.postMessage({ type: 'started' });
    console.log(`HexTable:render ${timer.deltaMs()}ms`);
}

const msg: ICmdBase = {
    type: CmdType.GetDocuments,
    seq: 0,
    sessionId: ''
};
vscodePostCommand(msg)
    .then((results) => {
        if (Array.isArray(results)) {
            for (const item of results) {
                const xferObj = item as IWebviewDocXfer;
                const doc = new WebviewDoc(xferObj);
                doc.isReady = true;
            }
        }
        if (Object.entries(WebviewDoc.allDocuments).length === 0) {
            WebviewDoc.createDummyDoc();
        }
        if (!WebviewDoc.currentDoc) {
            const [_key, doc] = Object.entries(WebviewDoc.allDocuments)[0];
            WebviewDoc.setCurrentDoc(doc);
        }
    })
    .catch((e) => {
        console.error('Failed to load documents', e);
    })
    .finally(() => {
        start();
    });
