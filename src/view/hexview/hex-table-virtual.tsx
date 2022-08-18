// Originally from https://codepen.io/abidibo/pen/dwgLJo
import React from 'react';
import { AutoSizer, IndexRange, InfiniteLoader, List } from 'react-virtualized';
import 'react-virtualized/styles.css';
import { IHexDataRow, IHexHeaderRow, IHexTable, HexDataRow, HexHeaderRow } from './hex-elements';
import { WebviewDoc } from './webview-doc';
import { vscodeGetState, vscodeSetState } from './webview-globals';

interface IHexTableState {
    header: IHexHeaderRow;
    items: IHexDataRow[];
    rowHeight: number;
    scrollTop: number;
}

function getVscodeScrollTop(): number {
    const v = vscodeGetState<number>('scrollTop');
    return v || 0;
}

function setVscodeScrollTop(v: number) {
    vscodeSetState<number>('scrollTop', v);
}

function getVscodeRowHeight(): number {
    const v = vscodeGetState<number>('rowHeight');
    return v || 18;
}

function setVscodeRowHeight(v: number) {
    vscodeSetState<number>('rowHeight', v);
}

const estimatedRowHeight = getVscodeRowHeight();
const maxNumRows = (1024 * 1024) / 16;
export class HexTableVirtual extends React.Component<IHexTable, IHexTableState> {
    private startAddr = 0n;
    private endAddr = 0n;
    private eof = false;
    private loadMoreFunc = this.loadMore.bind(this);
    private renderRowFunc = this.renderRow.bind(this);
    private onScrollFunc = this.onScroll.bind(this);
    private lineHeightDetectTimer: NodeJS.Timeout | undefined = undefined;

    constructor(public props: IHexTable) {
        super(props);

        this.startAddr = (this.props.address / 16n) * 16n;
        this.endAddr = ((this.props.address + BigInt(this.props.numBytes + 15)) / 16n) * 16n;
        this.state = {
            header: { address: this.props.address },
            items: [],
            rowHeight: estimatedRowHeight,
            scrollTop: getVscodeScrollTop()
        };
        console.log('In HexTableVirtual.ctor()');
    }

    private rowHeightDetected = false;
    async componentDidMount() {
        const top = Math.floor(this.state.scrollTop / this.state.rowHeight);
        const want = Math.ceil(window.innerHeight / estimatedRowHeight) + 15;
        await this.loadMore({ startIndex: top, stopIndex: top + want });
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
    }

    private scrollSettingTimeout: NodeJS.Timeout | undefined;
    onScroll(args: { clientHeight: number; scrollHeight: number; scrollTop: number }) {
        // We just remember the last top position to use next time we are mounted
        this.setState({ scrollTop: args.scrollTop });

        if (this.scrollSettingTimeout) {
            clearTimeout(this.scrollSettingTimeout);
        }
        this.scrollSettingTimeout = setTimeout(() => {
            setVscodeScrollTop(this.state.scrollTop);
            this.scrollSettingTimeout = undefined;
        }, 250);
    }

    loadMore(params: IndexRange): Promise<any> {
        return new Promise((resolve, _reject) => {
            const newItems = this.actuallyLoadMore(params);
            const promises = [];
            for (const item of newItems) {
                promises.push(WebviewDoc.getCurrentDocByte(item.address));
            }
            Promise.all(promises)
                .catch((e) => {
                    console.log('loadMore() failure not expected', e);
                })
                .finally(() => {
                    resolve(true);
                });
        });
    }

    actuallyLoadMore(params: IndexRange): IHexDataRow[] {
        // We intentionally copy the items to force a state change.
        const items = this.state.items ? [...this.state.items] : [];
        const newItems = [];
        let changed;
        for (let ix = items.length; ix <= params.stopIndex; ix++) {
            const addr = this.props.address + BigInt(ix * 16);
            if (addr >= this.endAddr) {
                break;
            }
            const tmp: IHexDataRow = {
                address: addr,
                dirty: this.props.dirty,
                onChange: this.props.onChange
            };
            items.push(tmp);
            newItems.push(tmp);
            changed = true;
        }
        // Nothing changed
        if (changed) {
            this.setState({ items: items });
        }
        this.eof = items[items.length - 1].address >= this.endAddr || items.length >= maxNumRows;
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
        // Use the parent windows height and subtract the header row and also a bit more so the
        // never displays a scrollbar
        const heightCalc = window.innerHeight - this.state.rowHeight - 2;
        return (
            <div className='container' style={{ overflowX: 'scroll' }}>
                <HexHeaderRow address={this.props.address}></HexHeaderRow>
                <InfiniteLoader
                    isRowLoaded={({ index }) => !!this.state.items[index]}
                    loadMoreRows={this.loadMoreFunc}
                    rowCount={maxNumRows}
                >
                    {({ onRowsRendered, registerChild }) => (
                        <AutoSizer disableHeight>
                            {({ width }) => (
                                <List
                                    ref={registerChild}
                                    onRowsRendered={onRowsRendered}
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
