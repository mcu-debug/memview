import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { globalsInit, myGlobals, vscodePostCommand } from './webview-globals';
import * as Utils from './utils';
import { RecoilRoot } from 'recoil';
import './index.css';
// import { HexTableVirtual } from './hex-table-virtual';
import { HexTableVirtual2 } from './hex-table-virtual2';
import { MemViewToolbar } from './top-panel';
import { DualViewDoc } from './dual-view-doc';
import {
    ICmdGetMemory,
    ICmdGetStartAddress,
    IMemoryInterfaceCommands,
    CmdType,
    ICmdBase,
    ICmdSetMemory,
    ICmdGetMaxBytes
} from './shared';

class MemoryInterfaceFromVSCode implements IMemoryInterfaceCommands {
    getStartAddress(arg: ICmdGetStartAddress): Promise<string> {
        return vscodePostCommand(arg);
    }
    getMaxBytes(arg: ICmdGetMaxBytes): Promise<string> {
        return vscodePostCommand(arg);
    }
    getMemory(arg: ICmdGetMemory): Promise<Buffer> {
        return vscodePostCommand(arg);
    }
    setMemory(arg: ICmdSetMemory): Promise<boolean> {
        return vscodePostCommand(arg);
    }
}

const timer = new Utils.Timekeeper();
// console.log('initializing webview');

function doStartup() {
    globalsInit();
    DualViewDoc.init(new MemoryInterfaceFromVSCode());

    const promises = [];
    const msg: ICmdBase = {
        type: CmdType.GetDocuments,
        seq: 0,
        sessionId: '',
        docId: ''
    };
    promises.push(vscodePostCommand(msg));
    msg.type = CmdType.GetDebuggerSessions;
    promises.push(vscodePostCommand(msg));

    Promise.all(promises)
        .catch((e) => {
            console.error('Failed to do startup sequence', e);
        })
        .finally(() => {
            startRender();
        });
}

function startRender() {
    ReactDOM.render(
        <RecoilRoot>
            <MemViewToolbar junk='abcd'></MemViewToolbar>
            <HexTableVirtual2 />
        </RecoilRoot>,
        document.getElementById('root')
    );

    myGlobals.vscode?.postMessage({ type: 'started' });
    false && console.log(`HexTable:render ${timer.deltaMs()}ms`);
}

doStartup();
