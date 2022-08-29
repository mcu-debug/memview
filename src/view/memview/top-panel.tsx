import * as React from 'react';
import { DocDebuggerStatus, DualViewDoc, IDualViewDocGlobalEventArg } from './dual-view-doc';
import {
    VSCodeButton,
    VSCodeDivider,
    VSCodeDropdown,
    VSCodeOption
} from '@vscode/webview-ui-toolkit/react';
import { vscodePostCommandNoResponse } from './webview-globals';
import { CmdButtonName, CmdType, ICmdButtonClick, UnknownDocId } from './shared';

export interface IMemViewPanelProps {
    junk: string;
}

interface IMemViewPanelState {
    width: number;
    sessionId: string;
    sessionStatus: DocDebuggerStatus;
    docId: string;
}

export class MemViewToolbar extends React.Component<IMemViewPanelProps, IMemViewPanelState> {
    constructor(props: IMemViewPanelProps) {
        super(props);
        this.state = {
            width: window.innerWidth,
            sessionId: DualViewDoc.currentDoc?.sessionId || UnknownDocId,
            sessionStatus: DualViewDoc.currentDoc?.sessionStatus || DocDebuggerStatus.Default,
            docId: DualViewDoc.currentDoc?.docId || UnknownDocId
        };
        window.addEventListener('resize', this.onResize.bind(this));
        DualViewDoc.globalEventEmitter.addListener('any', this.onGlobalEvent.bind(this));
    }

    private onGlobalEvent(arg: IDualViewDocGlobalEventArg) {
        const newState: IMemViewPanelState = { ...this.state };
        if (arg.docId && arg.docId !== this.state.docId) {
            newState.docId = arg.docId;
        }
        if (arg.sessionId && arg.sessionId !== this.state.sessionId) {
            newState.sessionId = arg.sessionId;
        }
        if (arg.sessionStatus && arg.sessionStatus !== this.state.sessionStatus) {
            newState.sessionStatus = arg.sessionStatus;
        }
        this.setState(newState);
    }

    onResize() {
        // Just a dummy state to fore a redraw to re-render right justified elements
        console.log('Window width = ', window.innerWidth);
        this.setState({ width: window.innerWidth });
    }

    private createCmd(button: CmdButtonName) {
        const ret: ICmdButtonClick = {
            button: button,
            type: CmdType.ButtonClick,
            sessionId: this.state.sessionId,
            docId: this.state.docId
        };
        return ret;
    }

    private onClickAddFunc = this.onClickAdd.bind(this);
    private onClickAdd() {
        console.log('In onClickAdd');
        vscodePostCommandNoResponse(this.createCmd('new'));
    }

    private onClickCloseFunc = this.onClickClose.bind(this);
    private onClickClose() {
        console.log('In onClickClose');
        if (this.state.docId !== UnknownDocId) {
            vscodePostCommandNoResponse(this.createCmd('close'));
        }
    }

    private onClickSaveFunc = this.onClickSave.bind(this);
    private onClickSave() {
        console.log('In onClickSave');
    }

    private onClickRefreshFunc = this.onClickRefresh.bind(this);
    private onClickRefresh() {
        console.log('In onClickRefresh');
        vscodePostCommandNoResponse(this.createCmd('refresh'));
    }

    private onClickSettingsFunc = this.onClickSettings.bind(this);
    private onClickSettings() {
        console.log('In onClickSettings');
    }

    private currentDocChangedFunc = this.currentDocChanged.bind(this);
    private currentDocChanged(event: any) {
        // eslint-disable-next-line no-debugger
        const value = event?.target?.value;
        console.log(`In currentDocChanged ${value}`);
        if (value && value !== UnknownDocId) {
            const cmd = this.createCmd('select');
            cmd.docId = value; // Other items in cmd don't matter
            cmd.sessionId = '';
            vscodePostCommandNoResponse(cmd);
        }
    }

    render() {
        console.log('In MemViewToolbar.render');
        const docItems = [];
        let count = 0;
        let status = 'No status';
        for (const doc of DualViewDoc.getDocumentsList()) {
            docItems.push(
                <VSCodeOption key={count} selected={doc.isCurrent} value={doc.docId}>
                    {doc.displayName}
                </VSCodeOption>
            );
            status = doc.isCurrent ? doc.sessionStatus : status;
            count++;
        }
        const isModified = DualViewDoc.currentDoc?.isModified;
        const isStopped = this.state.sessionStatus === DocDebuggerStatus.Stopped;
        let key = 0;
        return (
            <div className='toolbar' style={{ width: 'auto' }}>
                <VSCodeDropdown
                    key={key++}
                    position='below'
                    value={this.state.docId}
                    onChange={this.currentDocChangedFunc}
                >
                    {docItems}
                </VSCodeDropdown>
                <span>&nbsp;</span>
                <VSCodeButton
                    key={key++}
                    appearance='icon'
                    title='Add new memory view'
                    onClick={this.onClickAddFunc}
                >
                    <span className='codicon codicon-add'></span>
                </VSCodeButton>
                <VSCodeButton
                    key={key++}
                    appearance='icon'
                    title='Edit memory view properties. Coming soon'
                >
                    <span className='codicon codicon-edit'></span>
                </VSCodeButton>
                <VSCodeButton
                    key={key++}
                    appearance='icon'
                    title='Save changes to program memory. Coming soon'
                    disabled={!isModified || !isStopped}
                    onClick={this.onClickSaveFunc}
                >
                    <span className='codicon codicon-save'></span>
                </VSCodeButton>
                <VSCodeButton key={key++} appearance='icon' onClick={this.onClickRefreshFunc}>
                    <span
                        className='codicon codicon-refresh'
                        title='Refresh this panel. New data is fetched if debugger is stopped'
                    ></span>
                </VSCodeButton>
                <VSCodeButton key={key++} appearance='icon' onClick={this.onClickSettingsFunc}>
                    <span
                        className='codicon codicon-gear'
                        title='Edit global settings. Coming soon'
                    ></span>
                </VSCodeButton>
                <span className='debug-status'>Status: {status}</span>
                <VSCodeButton
                    key={key++}
                    appearance='icon'
                    style={{ float: 'right' }}
                    title='Close this memory view'
                    disabled={this.state.docId === UnknownDocId}
                    onClick={this.onClickCloseFunc}
                >
                    <span className='codicon codicon-close'></span>
                </VSCodeButton>
                <VSCodeDivider key={key++} role='presentation'></VSCodeDivider>
            </div>
        );
    }
}
