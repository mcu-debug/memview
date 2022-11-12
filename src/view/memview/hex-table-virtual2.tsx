import React from 'react';
import AutoSizer from '../../../import/auto-sizer';
import InfiniteLoader = require('react-window-infinite-loader');
import { FixedSizeList as List, ListOnScrollProps } from 'react-window';

// import 'react-virtualized/styles.css';
import { IHexDataRow, HexDataRow, HexHeaderRow, OnCellChangeFunc } from './hex-elements';
import { DualViewDoc, IDualViewDocGlobalEventArg } from './dual-view-doc';
import { vscodeGetState, vscodeSetState } from './webview-globals';
import { UnknownDocId } from './shared';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function scrollHorizontalSync(selector: string) {
    // return;
    let active: any = null;
    document.querySelectorAll(selector).forEach((div) => {
        div.addEventListener('mouseenter', (e: any) => {
            active = e.target;
        });

        div.addEventListener('scroll', (e: any) => {
            if (e.target !== active) return;

            document.querySelectorAll(selector).forEach((target: any) => {
                if (active !== target) {
                    // target.scrollTop = active.scrollTop;
                    console.log('scrollHorizontalSync', active, target);
                    target.scrollLeft = active.scrollLeft;
                }
            });
        });
    });
}

interface IHexTableState {
    items: IHexDataRow[];
    rowHeight: number;
    toolbarHeight: number;
    windowInnerHeight: number;
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
const maxNumBytes = 4 * 1024 * 1024;

export interface IHexTableVirtual {
    onChange?: OnCellChangeFunc;
}

export class HexTableVirtual2 extends React.Component<IHexTableVirtual, IHexTableState> {
    private loadMoreFunc = this.loadMore.bind(this);
    private renderRowFunc = this.renderRow.bind(this);
    private onScrollFunc = this.onScroll.bind(this);
    private lineHeightDetectTimer: NodeJS.Timeout | undefined = undefined;
    private maxNumRows: number;
    private bytesPerRow: number;
    private listElementRef: any;

    constructor(public props: IHexTableVirtual) {
        super(props);

        const doc = DualViewDoc.currentDoc;
        this.state = {
            items: [],
            toolbarHeight: estimatedToolbarHeight,
            rowHeight: estimatedRowHeight,
            windowInnerHeight: window.innerHeight,
            docId: doc?.docId || UnknownDocId,
            sessionId: doc?.sessionId || UnknownDocId,
            sessionStatus: doc?.sessionStatus || UnknownDocId,
            baseAddress: doc?.baseAddress ?? 0n,
            scrollTop: getDocStateScrollTop()
        };
        // console.log('HexTableVirtual2 ctor()', this.state);
        this.bytesPerRow = doc ? (doc.format === '1-byte' ? 16 : 32) : 16;
        this.maxNumRows = maxNumBytes * this.bytesPerRow;
        DualViewDoc.globalEventEmitter.addListener('any', this.onGlobalEventFunc);
        window.addEventListener('resize', this.onResize.bind(this));
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
        /*
        const elements = document.querySelectorAll('.infinite-list div');
        for (const item of elements || []) {
            item.classList.add('scrollHorizontalSync');
        }
        setTimeout(() => {
            scrollHorizontalSync('.scrollHorizontalSync');
        }, 250);
        */
        try {
            await this.loadInitial();
            this.restoreScroll();
        } catch (e) {
            // eslint-disable-next-line no-debugger
            // debugger;
            console.error(e);
        }
    }

    restoreScroll() {
        if (this.listElementRef) {
            this.listElementRef.scrollTo(this.state.scrollTop);
        }
    }

    private async loadInitial() {
        const top = Math.floor(this.state.scrollTop / this.state.rowHeight);
        const want = Math.ceil(window.innerHeight / estimatedRowHeight) + 15;
        await this.loadMore(top, top + want);
    }

    private onResize() {
        if (this.state.windowInnerHeight !== window.innerHeight) {
            this.setState({ windowInnerHeight: window.innerHeight });
        }
    }

    private scrollSettingDebouncer: NodeJS.Timeout | undefined;
    onScroll(args: ListOnScrollProps) {
        if (this.scrollSettingDebouncer) {
            clearTimeout(this.scrollSettingDebouncer);
        }
        this.scrollSettingDebouncer = setTimeout(async () => {
            this.scrollSettingDebouncer = undefined;
            // console.log('onScroll', args);
            // We just remember the last top position to use next time we are mounted
            this.setState({ scrollTop: args.scrollOffset });
            await setDocStateScrollTop(args.scrollOffset);
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
            const addr = this.state.baseAddress + BigInt(ix * this.bytesPerRow);
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
        item.style = { ...style };
        // We don't want a fixed sized width. We want the content control the width
        delete item.style.width;
        const ret = <HexDataRow {...item}></HexDataRow>;
        // console.log(ret);
        return ret;
    }

    private refWrapper(ref: (ref: any) => void, elt: any) {
        this.listElementRef = elt;
        ref(elt);
    }

    render() {
        // Use the parent windows height and subtract the header row and also a bit more so the
        // never displays a scrollbar
        const fudge = 6; // Seems to work better when horizontal scrollbar appears
        const heightCalc = window.innerHeight - this.state.rowHeight - this.state.toolbarHeight - fudge;
        false &&
            console.log(
                `In HexTableView2.render(), rowHeight=${this.state.rowHeight}, toolbarHeight=${this.state.toolbarHeight} scrollTop=${this.state.scrollTop}`
            );
        return (
            <div className='container' style={{ overflowX: 'visible' }}>
                <HexHeaderRow></HexHeaderRow>
                <InfiniteLoader
                    isItemLoaded={this.isItemLoadedFunc}
                    loadMoreItems={this.loadMoreFunc}
                    itemCount={this.maxNumRows}
                >
                    {({ onItemsRendered, ref }) => (
                        <AutoSizer disableHeight disableWidth className='hex-table-auto-sizer scrollHorizontalSync'>
                            {({ width }) => (
                                <List
                                    className='infinite-list scrollHorizontalSync'
                                    ref={this.refWrapper.bind(this, ref)}
                                    onItemsRendered={onItemsRendered}
                                    height={heightCalc}
                                    width={width}
                                    overscanCount={30}
                                    itemCount={this.state.items.length}
                                    itemSize={this.state.rowHeight}
                                    // setting it to this.state.scrollTop does not work because the upper level components
                                    // have taken it over and override our wish. We set it from restoreScrollTop
                                    initialScrollOffset={0}
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
