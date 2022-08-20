import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { globalsInit, myGlobals, vscodePostCommand } from './webview-globals';
import * as Utils from './utils';
import { RecoilRoot } from 'recoil';
import './index.css';
import { HexTableVirtual } from './hex-table-virtual';
import { MemViewToolbar } from './top-panel';
import { DualViewDoc } from './dual-view-doc';
import {
    ICmdGetMemory,
    IMemoryInterfaceCommands,
    CmdType,
    ICmdBase,
    ICmdSetMemory
} from './shared';

class MemoryInterfaceFromVSCode implements IMemoryInterfaceCommands {
    getMemory(arg: ICmdGetMemory): Promise<Buffer> {
        return vscodePostCommand(arg);
    }
    setMemory(arg: ICmdSetMemory): Promise<boolean> {
        return vscodePostCommand(arg);
    }
}

const timer = new Utils.Timekeeper();

function doStartup() {
    globalsInit();
    DualViewDoc.init(new MemoryInterfaceFromVSCode());

    const promises = [];
    const msg: ICmdBase = {
        type: CmdType.GetDocuments,
        seq: 0,
        sessionId: ''
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
    const startAddr = DualViewDoc.currentDoc?.startAddress ?? 0n;
    const numBytes = Number((DualViewDoc.currentDoc?.maxAddress ?? 0n) - startAddr);
    ReactDOM.render(
        <RecoilRoot>
            <MemViewToolbar junk='abcd'></MemViewToolbar>
            <HexTableVirtual address={startAddr} numBytes={numBytes} dirty={false} />
        </RecoilRoot>,
        document.getElementById('root')
    );

    myGlobals.vscode?.postMessage({ type: 'started' });
    console.log(`HexTable:render ${timer.deltaMs()}ms`);
}

doStartup();
