// Originally from https://codepen.io/abidibo/pen/dwgLJo
import React from 'react';
import { AutoSizer, /* IndexRange, InfiniteLoader,*/ List } from 'react-virtualized';
import InfiniteLoader = require('react-window-infinite-loader');

import 'react-virtualized/styles.css';
import { IHexDataRow, HexDataRow, HexHeaderRow, OnCellChangeFunc } from './hex-elements';
import { DualViewDoc, IDualViewDocGlobalEventArg } from './dual-view-doc';
import { vscodeGetState, vscodeSetState } from './webview-globals';
import { UnknownDocId } from './shared';

interface IHexTableState {
    items: IHexDataRow[];
    rowHeight: number;
    scrollTop: number;
    docId: string;
    sessionId: string;
    sessionStatus: string;
    baseAddress: bigint;
}

function getDocStateScrollTop(): number {
    let v = 0;
    if (DualViewDoc.currentDoc) {
        v = DualViewDoc.currentDoc.getClientState<number>('scrollTop', 0);
    }
    return v;
}

async function setDocStateScrollTop(v: number) {
    if (DualViewDoc.currentDoc) {
        await DualViewDoc.currentDoc.setClientState<number>('scrollTop', v);
    }
}

function getVscodeRowHeight(): number {
    const v = vscodeGetState<number>('rowHeight');
    return v || 18;
}

function setVscodeRowHeight(v: number) {
    vscodeSetState<number>('rowHeight', v);
}

const estimatedRowHeight = getVscodeRowHeight();
const maxNumBytes = 1024 * 1024;
const maxNumRows = maxNumBytes / 16;

export interface IHexTableVirtual {
    onChange?: OnCellChangeFunc;
}

export class HexTableVirtual2 extends React.Component<IHexTableVirtual, IHexTableState> {
    private loadMoreFunc = this.loadMore.bind(this);
    private renderRowFunc = this.renderRow.bind(this);
    private onScrollFunc = this.onScroll.bind(this);
    private lineHeightDetectTimer: NodeJS.Timeout | undefined = undefined;

    constructor(public props: IHexTableVirtual) {
        super(props);

        this.state = {
            items: [],
            rowHeight: estimatedRowHeight,
            docId: DualViewDoc.currentDoc?.docId || UnknownDocId,
            sessionId: DualViewDoc.currentDoc?.sessionId || UnknownDocId,
            sessionStatus: DualViewDoc.currentDoc?.sessionStatus || UnknownDocId,
            baseAddress: DualViewDoc.currentDoc?.baseAddress ?? 0n,
            scrollTop: getDocStateScrollTop()
        };
        DualViewDoc.globalEventEmitter.addListener('any', this.onGlobalEventFunc);
    }

    private onGlobalEventFunc = this.onGlobalEvent.bind(this);
    private onGlobalEvent(arg: IDualViewDocGlobalEventArg) {
        if (arg.docId !== this.state.docId) {
            this.setState({ docId: arg.docId || 'undefined' });
        }
        if (arg.sessionId !== this.state.sessionId) {
            this.setState({ sessionId: arg.sessionId || 'undefined' });
        }
        if (arg.sessionStatus !== this.state.sessionStatus) {
            this.setState({ sessionStatus: arg.sessionStatus || 'undefined' });
        }
        if (arg.baseAddress !== this.state.baseAddress) {
            this.setState({ baseAddress: arg.baseAddress ?? 0n, items: [] });
            // this.loadInitial();  We need the items to be empty before calling this, not yet sure how to do that
        }
    }

    private rowHeightDetected = false;
    async componentDidMount() {
        if (!this.lineHeightDetectTimer && !this.rowHeightDetected) {
            this.lineHeightDetectTimer = setInterval(() => {
                const elt = document.querySelector('.hex-cell-value');
                if (elt) {
                    const style = getComputedStyle(elt);
                    const h = style.lineHeight;
                    if (h && h.endsWith('px')) {
                        const tmp = parseFloat(h);
                        if (tmp !== this.state.rowHeight) {
                            this.setState({ rowHeight: tmp });
                            setVscodeRowHeight(tmp);
                        }
                    }
                    clearInterval(this.lineHeightDetectTimer);
                    this.lineHeightDetectTimer = undefined;
                    // TODO: This should be set back to false when theme/fonts change
                    this.rowHeightDetected = true;
                }
            }, 250);
        }
        try {
            await this.loadInitial();
        } catch (e) {}
    }

    private async loadInitial() {
        const top = Math.floor(this.state.scrollTop / this.state.rowHeight);
        const want = Math.ceil(window.innerHeight / estimatedRowHeight) + 15;
        await this.loadMore(top, top + want);
    }

    private scrollSettingTimeout: NodeJS.Timeout | undefined;
    onScroll(args: { clientHeight: number; scrollHeight: number; scrollTop: number }) {
        // We just remember the last top position to use next time we are mounted
        this.setState({ scrollTop: args.scrollTop });

        if (this.scrollSettingTimeout) {
            clearTimeout(this.scrollSettingTimeout);
        }
        this.scrollSettingTimeout = setTimeout(async () => {
            this.scrollSettingTimeout = undefined;
            await setDocStateScrollTop(this.state.scrollTop);
        }, 250);
    }

    loadMore(startIndex: number, stopIndex: number): Promise<void> {
        return new Promise((resolve, _reject) => {
            const newItems = this.actuallyLoadMore(startIndex, stopIndex);
            const promises = [];
            for (const item of newItems) {
                promises.push(DualViewDoc.getCurrentDocByte(item.address));
            }
            Promise.all(promises)
                .catch((e) => {
                    console.error('loadMore() failure not expected', e);
                })
                .finally(() => {
                    resolve();
                });
        });
    }

    actuallyLoadMore(startIndex: number, stopIndex: number): IHexDataRow[] {
        // We intentionally copy the items to force a state change.
        const items = this.state.items ? [...this.state.items] : [];
        const newItems = [];
        let changed = false;
        const endAddr = this.state.baseAddress + BigInt(maxNumBytes);
        for (let ix = items.length; ix <= stopIndex; ix++) {
            const addr = this.state.baseAddress + BigInt(ix * 16);
            if (addr >= endAddr) {
                break;
            }
            const tmp: IHexDataRow = {
                address: addr,
                onChange: this.props.onChange
            };
            items.push(tmp);
            if (ix >= startIndex && ix <= stopIndex) {
                // Actual items requested, ignore any fillers, so we prime only the right rows for rendering
                // By priming, we mean load from debugger/vscode
                newItems.push(tmp);
            }
            changed = true;
        }
        // Nothing changed
        if (changed) {
            this.setState({ items: items });
        }
        return newItems;
    }

    private showScrollingPlaceholder = false;
    renderRow(args: any) {
        // console.log('renderRow: ', args);
        const { index, isScrolling, key, style } = args;
        const classNames = 'row isScrollingPlaceholder';
        if (this.showScrollingPlaceholder && isScrolling) {
            return (
                <div className={classNames} key={key} style={style}>
                    Scrolling...
                </div>
            );
        }
        const item = this.state.items[index];
        item.style = style;
        const ret = <HexDataRow {...item} key={key}></HexDataRow>;
        // console.log(ret);
        return ret;
    }

    render() {
        console.log('In HexTableView.render()');
        // Use the parent windows height and subtract the header row and also a bit more so the
        // never displays a scrollbar
        const heightCalc = window.innerHeight - this.state.rowHeight - 2;
        return (
            <div className='container' style={{ overflowX: 'scroll' }}>
                <HexHeaderRow></HexHeaderRow>
                <InfiniteLoader
                    isItemLoaded={(index) => !!this.state.items[index]} // TODO: looks dangerous
                    loadMoreItems={this.loadMoreFunc}
                    itemCount={maxNumRows}
                >
                    {({ onItemsRendered, ref }) => (
                        <AutoSizer disableHeight>
                            {({ width }) => (
                                <List
                                    ref={ref}
                                    onItemsRendered={onItemsRendered}
                                    height={heightCalc}
                                    width={width}
                                    overscanRowCount={30}
                                    rowCount={this.state.items.length}
                                    rowHeight={this.state.rowHeight}
                                    rowRenderer={this.renderRowFunc}
                                    scrollTop={this.state.scrollTop}
                                    onScroll={this.onScrollFunc}
                                />
                            )}
                        </AutoSizer>
                    )}
                </InfiniteLoader>
            </div>
        );
    }
}

/*
html {
   height: 100%;
}

body {
   background: #633;
   color: #fff;
   display: flex;
   min-height: 100%;
}

#root {
   flex: 1;
}

.container {
   display: flex;
   flex: 1;
   flex-direction: column;
   width: 98%;
}

.table-row-xxx {
   border-top: 1px solid rgba(255, 255, 255, .2);
}

.ReactVirtualized__Table__headerRow {
   border: 0;
   color: #ff0;
}
*/
