import * as React from 'react';
import { myGlobals } from './webview-globals';
import { WebviewDoc } from './webview-doc';
// import { vsCodeDropdown } from '@vscode/webview-ui-toolkit';
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
}

export class MemViewToolbar extends React.Component<IMemViewPanelProps, IMemViewPanelState> {
    constructor(props: IMemViewPanelProps) {
        super(props);
        this.state = {
            currentTab: WebviewDoc.currentDoc ? WebviewDoc.currentDoc.sessionId : '',
            width: window.innerWidth
        };
        window.addEventListener('resize', this.onResize.bind(this));
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
        for (const doc of WebviewDoc.getDocumentsList()) {
            docItems.push(
                <VSCodeOption key={count} selected={doc.isCurrent} value={doc.sessionId}>
                    {doc.displayName}
                </VSCodeOption>
            );
            count++;
        }
        docItems.push(
            <VSCodeOption key={count} selected={count === 0} value='new'>
                Add new view
            </VSCodeOption>
        );
        const isModified = WebviewDoc.currentDoc?.isModified;
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
                <VSCodeButton key={key++} appearance='icon' style={{ float: 'right' }}>
                    <span className='codicon codicon-close'></span>
                </VSCodeButton>
                <VSCodeDivider key={key++} role='presentation'></VSCodeDivider>
            </div>
        );
    }
}
