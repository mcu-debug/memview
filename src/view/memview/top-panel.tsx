import * as React from 'react';
import { DocDebuggerStatus, DualViewDoc, IDualViewDocGlobalEventArg } from './dual-view-doc';
import {
    VSCodeButton,
    VSCodeDivider,
    VSCodeDropdown,
    VSCodeOption,
    VSCodeRadio,
    VSCodeRadioGroup,
    VSCodeTextField
} from '@vscode/webview-ui-toolkit/react';
import { vscodePostCommandNoResponse } from './webview-globals';
import {
    CmdButtonName,
    CmdType,
    EndianType,
    ICmdButtonClick,
    IModifiableProps,
    RowFormatType,
    UnknownDocId
} from './shared';

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

    private getViewProps(): IViewSettingsProps {
        const props: IViewSettingsProps = {
            onDone: this.onEditPropsDone.bind(this),
            expr: DualViewDoc.currentDoc?.expr || '0',
            displayName: DualViewDoc.currentDoc?.displayName || 'Huh?',
            endian: 'little',
            format: '1-byte'
        };
        return props;
    }

    private onClickEditPropFunc = this.onClickEditProp.bind(this);
    private onClickEditProp(event: any) {
        ViewSettings.open(event, this.getViewProps());
    }
    private onEditPropsDone(props: IViewSettingsProps | undefined) {
        console.log(props);
    }

    render() {
        console.log('In MemViewToolbar.render');
        const docItems = [];
        let count = 0;
        let status = 'No status';
        for (const doc of DualViewDoc.getBasicDocumentsList()) {
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
                    onClick={this.onClickEditPropFunc}
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
                <ViewSettings {...this.getViewProps()}></ViewSettings>
            </div>
        );
    }
}

interface IViewSettingsProps extends IModifiableProps {
    onDone: (props: IViewSettingsProps | undefined) => void;
}

interface IViewSettingsState extends IViewSettingsProps {
    isOpen: boolean;
    clientX: number;
    clientY: number;
}
export class ViewSettings extends React.Component<IViewSettingsProps, IViewSettingsState> {
    static GlobalPtr: ViewSettings;
    private exprRef = React.createRef<any>();
    private displayNameRef = React.createRef<any>();
    private endianRef = React.createRef<any>();
    private formatRef = React.createRef<any>();

    constructor(props: IViewSettingsProps) {
        super(props);
        this.state = {
            ...props,
            isOpen: false,
            clientX: 0,
            clientY: 0
        };
        ViewSettings.GlobalPtr = this;
    }

    static open(event: any, props: IViewSettingsProps) {
        event.preventDefault();
        this.GlobalPtr.setState({
            ...props,
            clientX: event.clientX,
            clientY: event.clientY,
            isOpen: true
        });
    }

    private onClickCloseFunc = this.onClickClose.bind(this);
    private onClickClose(event: any) {
        event && event.preventDefault();
        this.setState({
            isOpen: false
        });
        this.state.onDone(undefined);
    }

    private onClickOkayFunc = this.onClickOkay.bind(this);
    private onClickOkay(event: any) {
        event && event.preventDefault();
        this.setState({
            isOpen: false
        });

        const ret = { ...this.state };
        let changed = false;
        if (ret.expr !== this.exprRef.current.value.trim()) {
            ret.expr = this.exprRef.current.value.trim();
            changed = true;
        }
        if (ret.displayName !== this.displayNameRef.current.value.trim()) {
            ret.displayName = this.displayNameRef.current.value.trim();
            changed = true;
        }
        if (ret.endian !== this.endianRef.current.value.trim()) {
            ret.endian = this.endianRef.current.value.trim();
            changed = true;
        }
        if (ret.format !== this.formatRef.current.value.trim()) {
            ret.format = this.formatRef.current.value.trim();
            changed = true;
        }

        this.state.onDone(changed ? ret : undefined);
    }

    render(): React.ReactNode {
        let key = 0;
        const bigLabel = 'Address: Constant or GDB Expression';
        return (
            <div style={{ display: +this.state.isOpen ? '' : 'none' }}>
                <div
                    className='popup'
                    id='view-settings'
                    style={{
                        width: `${bigLabel.length + 10}ch`,
                        // top: this.state.clientY,
                        top: 0,
                        left: this.state.clientX
                    }}
                >
                    <VSCodeButton
                        key={key++}
                        appearance='icon'
                        style={{ float: 'right' }}
                        title='Close this memory view'
                        onClick={this.onClickCloseFunc}
                    >
                        <span className='codicon codicon-close'></span>
                    </VSCodeButton>
                    <VSCodeTextField
                        key={key++}
                        autofocus
                        name='expr'
                        type='text'
                        style={{ width: '95%' }}
                        ref={this.exprRef}
                        value={this.state.expr}
                    >
                        {bigLabel}
                    </VSCodeTextField>
                    <br key={key++}></br>
                    <VSCodeTextField
                        key={key++}
                        name='displayName'
                        type='text'
                        style={{ width: '95%' }}
                        ref={this.displayNameRef}
                        value={this.state.displayName}
                    >
                        Display Name
                    </VSCodeTextField>
                    <br key={key++}></br>
                    <VSCodeRadioGroup
                        key={key++}
                        ref={this.endianRef}
                        orientation='horizontal'
                        value={this.state.format}
                    >
                        <span key={key++} className='radio-label'>
                            Format
                        </span>
                        <VSCodeRadio key={key++} value='1-byte'>
                            1-byte
                        </VSCodeRadio>
                        <VSCodeRadio key={key++} value='4-byte'>
                            4-byte
                        </VSCodeRadio>
                        <VSCodeRadio key={key++} value='8-byte'>
                            8-byte
                        </VSCodeRadio>
                    </VSCodeRadioGroup>
                    <VSCodeRadioGroup
                        key={key++}
                        ref={this.formatRef}
                        orientation='horizontal'
                        value={this.state.endian}
                    >
                        <span key={key++} className='radio-label'>
                            Endianness
                        </span>
                        <VSCodeRadio key={key++} value='little'>
                            Little
                        </VSCodeRadio>
                        <VSCodeRadio key={key++} value='big'>
                            Big
                        </VSCodeRadio>
                    </VSCodeRadioGroup>
                    <VSCodeButton
                        key={key++}
                        appearance='primary'
                        style={{ float: 'right', margin: '3px' }}
                        onClick={this.onClickOkayFunc}
                    >
                        Ok
                    </VSCodeButton>
                    <VSCodeButton
                        key={key++}
                        appearance='secondary'
                        style={{ float: 'right', margin: '3px' }}
                        onClick={this.onClickCloseFunc}
                    >
                        Cancel
                    </VSCodeButton>
                </div>
                <div className='popup-background' onClick={this.onClickCloseFunc}></div>
            </div>
        );
    }
}
