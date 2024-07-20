import * as React from 'react';
import { DocDebuggerStatus, DualViewDoc, IDualViewDocGlobalEventArg } from './dual-view-doc';
import {
    VSCodeButton,
    VSCodeDivider,
    VSCodeDropdown,
    VSCodeOption,
    VSCodeTextField
} from '@vscode/webview-ui-toolkit/react';
import { vscodePostCommandNoResponse } from './webview-globals';
import {
    CmdButtonName,
    CmdType,
    EndianType,
    ICmdButtonClick,
    ICmdSettingsChanged,
    IModifiableProps,
    RowFormatType,
    UnknownDocId
} from './shared';
import { SelContext } from './selection';

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
        // false && console.log('MemViewToolbar.onGlobalEvent', arg);
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

    private onResizeTimeout: NodeJS.Timeout | undefined;
    onResize() {
        if (this.onResizeTimeout) {
            // console.log('Toolbar resize clearing timeout');
            clearTimeout(this.onResizeTimeout);
        }
        this.onResizeTimeout = setTimeout(() => {
            this.onResizeTimeout = undefined;
            // Just a dummy state to fore a redraw to re-render right justified elements
            // console.log('Window width = ', window.innerWidth);
            if (this.state.width !== window.innerWidth) {
                this.setState({ width: window.innerWidth });
            }
        }, 100);
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
        vscodePostCommandNoResponse(this.createCmd('new'));
    }

    private onClickCloseFunc = this.onClickClose.bind(this);
    private onClickClose() {
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

    private getViewProps(): IModifiableProps {
        const props: IModifiableProps = {
            expr: DualViewDoc.currentDoc?.expr || '0',
            displayName: DualViewDoc.currentDoc?.displayName || 'Huh?',
            endian: DualViewDoc.currentDoc?.endian || 'little',
            format: DualViewDoc.currentDoc?.format || '1-byte'
        };
        return props;
    }

    private onClickEditPropFunc = this.onClickEditProp.bind(this);
    private onClickEditProp(event: any) {
        ViewSettings.open(event, this.getViewProps());
    }
    private onEditPropsDoneFunc = this.onEditPropsDone.bind(this);
    private onEditPropsDone(props: IModifiableProps | undefined) {
        if (props && DualViewDoc.currentDoc) {
            const cmd: ICmdSettingsChanged = {
                settings: props,
                type: CmdType.SettingsChanged,
                sessionId: DualViewDoc.currentDoc.sessionId,
                docId: DualViewDoc.currentDoc.docId
            };
            vscodePostCommandNoResponse(cmd);
        }
    }

    private onClickCopyFunc = this.onClickCopy.bind(this);
    private onClickCopy(ev: React.MouseEvent) {
        if (ev.altKey) {
            vscodePostCommandNoResponse(this.createCmd('copy-all-to-clipboard'));
        } else {
            SelContext.current?.copyToClipboard();
        }
    }

    private onClickCopyToFileFunc = this.onClickCopyToFile.bind(this);
    private onClickCopyToFile(_ev: React.MouseEvent) {
        vscodePostCommandNoResponse(this.createCmd('copy-all-to-file'));
    }

    render() {
        // console.log('In MemViewToolbar.render');
        const docItems = [];
        let count = 0;
        let status = 'No status';
        let enableProps = false;
        for (const doc of DualViewDoc.getBasicDocumentsList()) {
            docItems.push(
                <VSCodeOption key={count} selected={doc.isCurrent} value={doc.docId}>
                    {doc.displayName}
                </VSCodeOption>
            );
            status = doc.isCurrent ? doc.sessionStatus : status;
            enableProps = enableProps || doc.docId !== UnknownDocId;
            count++;
        }
        const isModified = DualViewDoc.currentDoc?.isModified;
        const isStopped = this.state.sessionStatus === DocDebuggerStatus.Stopped;
        const editProps: IViewSettingsProps = {
            settings: this.getViewProps(),
            onDone: this.onEditPropsDoneFunc
        };
        let key = 0;
        const copyHelp =
            'Copy to clipboard.\nHold ' +
            (navigator.platform.startsWith('Mac') ? '⌥' : 'Alt') +
            ' for Copy All to clipboard';
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
                <VSCodeButton key={key++} appearance='icon' title='Add new memory view' onClick={this.onClickAddFunc}>
                    <span className='codicon codicon-add'></span>
                </VSCodeButton>
                <VSCodeButton
                    key={key++}
                    appearance='icon'
                    title='Edit memory view properties'
                    disabled={!enableProps}
                    onClick={this.onClickEditPropFunc}
                >
                    <span className='codicon codicon-edit'></span>
                </VSCodeButton>
                <VSCodeButton key={key++} appearance='icon' title={copyHelp} onClick={this.onClickCopyFunc}>
                    <span className='codicon codicon-copy'></span>
                </VSCodeButton>
                <VSCodeButton
                    key={key++}
                    appearance='icon'
                    title='Save to file...'
                    onClick={this.onClickCopyToFileFunc}
                >
                    <span className='codicon codicon-file-binary'></span>
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
                    <span className='codicon codicon-gear' title='Edit global settings. Coming soon'></span>
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
                <ViewSettings {...editProps}></ViewSettings>
            </div>
        );
    }
}

interface IViewSettingsProps {
    settings: IModifiableProps;
    onDone: (props: IModifiableProps | undefined) => void;
}

interface IViewSettingsState {
    settings: IModifiableProps;
    isOpen: boolean;
    clientX: number;
    clientY: number;
}
export class ViewSettings extends React.Component<IViewSettingsProps, IViewSettingsState> {
    static GlobalPtr: ViewSettings;
    private exprRef = React.createRef<any>();
    private displayNameRef = React.createRef<any>();
    private endian: string;
    private format: string;

    constructor(props: IViewSettingsProps) {
        super(props);
        this.state = {
            settings: this.props.settings,
            isOpen: false,
            clientX: 0,
            clientY: 0
        };
        this.endian = props.settings.endian;
        this.format = props.settings.format;
        ViewSettings.GlobalPtr = this;
    }

    static open(event: any, settings: IModifiableProps) {
        event.preventDefault();
        this.GlobalPtr.setState({
            settings: settings,
            clientX: event.clientX,
            clientY: event.clientY,
            isOpen: true
        });
        this.GlobalPtr.endian = settings.endian;
        this.GlobalPtr.format = settings.format;
    }

    private onClickCloseFunc = this.onClickClose.bind(this);
    private onClickClose(event: any) {
        event && event.preventDefault();
        this.setState({
            isOpen: false
        });
        this.props.onDone(undefined);
    }

    private onClickOkayFunc = this.onClickOkay.bind(this);
    private onClickOkay(event: any) {
        event && event.preventDefault();
        this.setState({
            isOpen: false
        });

        const ret = { ...this.state.settings };
        let changed = false;
        if (ret.expr !== this.exprRef.current.value.trim()) {
            ret.expr = this.exprRef.current.value.trim();
            changed = true;
        }
        if (ret.displayName !== this.displayNameRef.current.value.trim()) {
            ret.displayName = this.displayNameRef.current.value.trim();
            changed = true;
        }

        if (ret.endian !== this.endian) {
            ret.endian = this.endian as EndianType;
            changed = true;
        }

        if (ret.format !== this.format) {
            ret.format = this.format as RowFormatType;
            changed = true;
        }

        this.props.onDone(changed ? ret : undefined);
    }

    private onEndiannessChangeFunc = this.onEndiannessChange.bind(this);
    private onEndiannessChange(e: any) {
        this.endian = e.target.value;
    }

    private onFormatChangeFunc = this.onFormatChange.bind(this);
    private onFormatChange(e: any) {
        this.format = e.target.value;
    }

    render(): React.ReactNode {
        let key = 0;
        const bigLabel = 'Address: Hex/decimal constant or expression';
        return (
            <div key={key++} style={{ display: +this.state.isOpen ? '' : 'none' }}>
                <div
                    key={key++}
                    className='popup'
                    id='view-settings'
                    style={{
                        width: `${bigLabel.length + 5}ch`,
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
                        style={{ width: '100%' }}
                        ref={this.exprRef}
                        value={this.state.settings.expr}
                    >
                        {bigLabel}
                    </VSCodeTextField>
                    <br key={key++}></br>
                    <VSCodeTextField
                        key={key++}
                        name='displayName'
                        type='text'
                        style={{ width: '100%' }}
                        ref={this.displayNameRef}
                        value={this.state.settings.displayName}
                    >
                        Display Name
                    </VSCodeTextField>
                    <br key={key++}></br>
                    <div key={key++} className='dropdown-label-div'>
                        <label key={key++} className='dropdown-label'>
                            Format
                        </label>
                        <VSCodeDropdown key={key++} value={this.format} onChange={this.onFormatChangeFunc}>
                            <VSCodeOption key={key++} value='1-byte'>
                                1-Byte
                            </VSCodeOption>
                            <VSCodeOption key={key++} value='2-byte'>
                                2-Byte
                            </VSCodeOption>
                            <VSCodeOption key={key++} value='4-byte'>
                                4-Byte
                            </VSCodeOption>
                            <VSCodeOption key={key++} value='8-byte'>
                                8-Byte
                            </VSCodeOption>
                        </VSCodeDropdown>
                    </div>
                    <div key={key++} className='dropdown-label-div'>
                        <label key={key++} className='dropdown-label'>
                            Endianness
                        </label>
                        <VSCodeDropdown key={key++} value={this.endian} onChange={this.onEndiannessChangeFunc}>
                            <VSCodeOption key={key++} value='little'>
                                Little
                            </VSCodeOption>
                            <VSCodeOption key={key++} value='big'>
                                Big
                            </VSCodeOption>
                        </VSCodeDropdown>
                    </div>
                    <div key={key++} style={{ marginTop: '10px' }}>
                        <VSCodeDropdown key={key++} style={{ width: '25ch' }}>
                            <VSCodeOption key={key++} value='view'>
                                Apply To: This View
                            </VSCodeOption>
                            <VSCodeOption key={key++} value='all-views' disabled>
                                Apply To: All Views
                            </VSCodeOption>
                            <VSCodeOption key={key++} value='all-views' disabled>
                                Apply To: Workspace Settings
                            </VSCodeOption>
                            <VSCodeOption key={key++} value='all-views' disabled>
                                Apply To: User Settings
                            </VSCodeOption>
                        </VSCodeDropdown>
                        <VSCodeButton
                            key={key++}
                            appearance='primary'
                            style={{ float: 'right', paddingRight: '1ch' }}
                            onClick={this.onClickOkayFunc}
                        >
                            Ok
                        </VSCodeButton>
                        <VSCodeButton
                            key={key++}
                            appearance='secondary'
                            style={{ float: 'right', marginRight: '10px' }}
                            onClick={this.onClickCloseFunc}
                        >
                            Cancel
                        </VSCodeButton>
                    </div>
                </div>
                <div className='popup-background' onClick={this.onClickCloseFunc}></div>
            </div>
        );
    }
}
