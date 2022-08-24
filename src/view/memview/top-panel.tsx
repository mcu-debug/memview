import * as React from 'react';
import { DualViewDoc, IDualViewDocGlobalEventArg } from './dual-view-doc';
import {
    VSCodeButton,
    VSCodeDivider,
    VSCodeDropdown,
    VSCodeOption
} from '@vscode/webview-ui-toolkit/react';

export interface IMemViewPanelProps {
    junk: string;
}

interface IMemViewPanelState {
    currentTab: string;
    width: number;
    sessionId: string;
    sessionStatus: string;
}

export class MemViewToolbar extends React.Component<IMemViewPanelProps, IMemViewPanelState> {
    constructor(props: IMemViewPanelProps) {
        super(props);
        this.state = {
            currentTab: DualViewDoc.currentDoc ? DualViewDoc.currentDoc.sessionId : '',
            width: window.innerWidth,
            sessionId: 'unknown',
            sessionStatus: 'unknown'
        };
        window.addEventListener('resize', this.onResize.bind(this));
        DualViewDoc.globalEventEmitter.addListener('any', this.onGlobalEvent.bind(this));
    }

    private onGlobalEvent(arg: IDualViewDocGlobalEventArg) {
        if (arg.sessionId) {
            this.setState({ sessionId: arg.sessionId });
        }
        if (arg.sessionStatus) {
            this.setState({ sessionStatus: arg.sessionStatus });
        }
    }

    onResize() {
        // Just a dummy state to fore a redraw to re-render right justified elements
        console.log('Window width = ', window.innerWidth);
        this.setState({ width: window.innerWidth });
    }

    render() {
        console.log('In MemViewToolbar.render');
        const docItems = [];
        let count = 0;
        let status = 'No status';
        for (const doc of DualViewDoc.getDocumentsList()) {
            docItems.push(
                <VSCodeOption key={count} selected={doc.isCurrent} value={doc.sessionId}>
                    {doc.displayName}
                </VSCodeOption>
            );
            status = doc.isCurrent ? doc.sessionStatus : status;
            count++;
        }
        docItems.push(
            <VSCodeOption key={count} selected={count === 0} value='new'>
                Add new view
            </VSCodeOption>
        );
        const isModified = DualViewDoc.currentDoc?.isModified;
        let key = 0;
        return (
            <div className='toolbar' style={{ width: 'auto' }}>
                <VSCodeDropdown key={key++} position='below'>
                    {docItems}
                </VSCodeDropdown>
                <VSCodeButton key={key++} appearance='icon'>
                    <span className='codicon codicon-edit'></span>
                </VSCodeButton>
                <VSCodeButton key={key++} appearance='icon' disabled={!isModified}>
                    <span className='codicon codicon-save'></span>
                </VSCodeButton>
                <VSCodeButton key={key++} appearance='icon'>
                    <span className='codicon codicon-refresh'></span>
                </VSCodeButton>
                <VSCodeButton key={key++} appearance='icon'>
                    <span className='codicon codicon-gear'></span>
                </VSCodeButton>
                <span style={{ textAlign: 'center' }}>{status}</span>
                <VSCodeButton key={key++} appearance='icon' style={{ float: 'right' }}>
                    <span className='codicon codicon-close'></span>
                </VSCodeButton>
                <VSCodeDivider key={key++} role='presentation'></VSCodeDivider>
            </div>
        );
    }
}
