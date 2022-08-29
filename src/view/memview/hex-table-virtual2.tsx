import React from 'react';
import AutoSizer from '../../../import/auto-sizer';
import InfiniteLoader = require('react-window-infinite-loader');
import { FixedSizeList as List, ListOnScrollProps } from 'react-window';

// import 'react-virtualized/styles.css';
import { IHexDataRow, HexDataRow, HexHeaderRow, OnCellChangeFunc } from './hex-elements';
import { DualViewDoc, IDualViewDocGlobalEventArg } from './dual-view-doc';
import { vscodeGetState, vscodeSetState } from './webview-globals';
import { UnknownDocId } from './shared';

interface IHexTableState {
    items: IHexDataRow[];
    rowHeight: number;
    toolbarHeight: number;
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

function getVscodeToolbarHeight(): number {
    const v = vscodeGetState<number>('toolbarHeight');
    return v || 30;
}

function setVscodeToolbarHeight(v: number) {
    vscodeSetState<number>('toolbarHeight', v);
}

const estimatedRowHeight = getVscodeRowHeight();
const estimatedToolbarHeight = getVscodeToolbarHeight();
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
            toolbarHeight: estimatedToolbarHeight,
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
        const newState: IHexTableState = { ...this.state };
        if (arg.docId && arg.docId !== this.state.docId) {
            newState.docId = arg.docId;
        }
        if (arg.sessionId && arg.sessionId !== this.state.sessionId) {
            newState.sessionId = arg.sessionId;
        }
        if (arg.sessionStatus && arg.sessionStatus !== this.state.sessionStatus) {
            newState.sessionStatus = arg.sessionStatus;
        }
        if (arg.baseAddress && arg.baseAddress !== this.state.baseAddress) {
            newState.baseAddress = arg.baseAddress ?? 0n;
            newState.items = [];
            this.loadInitial(); // We need the items to be empty before calling this, not yet sure how to do that
        }
        this.setState(newState);
    }

    private rowHeightDetected = false;
    private toolbarHeightDetected = false;
    async componentDidMount() {
        if (!this.lineHeightDetectTimer) {
            this.rowHeightDetected = false;
            this.toolbarHeightDetected = false;
            this.lineHeightDetectTimer = setInterval(() => {
                for (const clsName of ['.hex-cell-value', '.toolbar']) {
                    const elt = document.querySelector(clsName);
                    if (elt) {
                        const tmp = (elt as any).offsetHeight;
                        const isCell = clsName === '.hex-cell-value';
                        if (isCell && !this.rowHeightDetected) {
                            this.rowHeightDetected = true;
                            if (tmp !== this.state.rowHeight) {
                                this.setState({ rowHeight: tmp });
                                setVscodeRowHeight(tmp);
                            }
                        } else if (!isCell && !this.toolbarHeightDetected) {
                            this.toolbarHeightDetected = true;
                            if (tmp !== this.state.toolbarHeight) {
                                this.setState({ toolbarHeight: tmp });
                                setVscodeToolbarHeight(tmp);
                            }
                        }
                        // TODO: This should be set back to false when theme/fonts change
                    }
                }
                if (this.rowHeightDetected && this.toolbarHeightDetected) {
                    clearInterval(this.lineHeightDetectTimer);
                    this.lineHeightDetectTimer = undefined;
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
    onScroll(args: ListOnScrollProps) {
        // We just remember the last top position to use next time we are mounted
        this.setState({ scrollTop: args.scrollOffset });

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

    private isItemLoadedFunc = this.isItemLoaded.bind(this);
    private isItemLoaded(index: number): boolean {
        return index >= 0 && index < this.state.items.length;
    }

    private showScrollingPlaceholder = false;
    renderRow(args: any) {
        // console.log('renderRow: ', args);
        // const { index, isScrolling, key, style } = args;
        const { index, isScrolling, _data, style } = args;
        const classNames = 'row isScrollingPlaceholder';
        let dummyContent = '';
        if (!this.isItemLoaded(index)) {
            dummyContent = 'Loading...';
        } else if (this.showScrollingPlaceholder && isScrolling) {
            dummyContent = 'Scrolling...';
        }

        if (dummyContent) {
            return (
                <div className={classNames} style={style}>
                    {dummyContent}
                </div>
            );
        }

        const item = this.state.items[index];
        item.style = style;
        const ret = <HexDataRow {...item}></HexDataRow>;
        // console.log(ret);
        return ret;
    }

    render() {
        // Use the parent windows height and subtract the header row and also a bit more so the
        // never displays a scrollbar
        const heightCalc = window.innerHeight - this.state.rowHeight - this.state.toolbarHeight - 2;
        console.log(
            `In HexTableView2.render(), rowHeight=${this.state.rowHeight}, toolbarHeight=${this.state.toolbarHeight}`
        );
        return (
            <div className='container' style={{ overflowX: 'scroll' }}>
                <HexHeaderRow></HexHeaderRow>
                <InfiniteLoader
                    isItemLoaded={this.isItemLoadedFunc}
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
                                    overscanCount={30}
                                    itemCount={this.state.items.length}
                                    itemSize={this.state.rowHeight}
                                    initialScrollOffset={this.state.scrollTop}
                                    onScroll={this.onScrollFunc}
                                >
                                    {this.renderRowFunc}
                                </List>
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
