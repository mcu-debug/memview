import * as React from 'react';
import { FixedSizeList } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import AutoSizer from 'react-virtualized-auto-sizer';
// import 'react-virtualized/styles.css'; // only needs to be imported once
import {
    IHexDataRow,
    IHexHeaderRow,
    IHexTable,
    HexDataRow,
    HexHeaderRow,
    OnCellChangeFunc
} from './hex-elements';
import { myGlobals } from './globals';

interface IHexTableState {
    hasNextPage: boolean;
    isNextPageLoading: boolean;
    header: IHexHeaderRow;
    items: IHexDataRow[];
}

const estimatedRowHeight = 30;
const maxNumRows = (1024 * 1024) / 16; // 1Meg bytes

export const ExampleWrapper: React.FC<{
    // Are there more items to load?
    // (This information comes from the most recent API request.)
    hasNextPage: boolean;

    // Are we currently loading a page of items?
    // (This may be an in-flight flag in your Redux store for example.)
    isNextPageLoading: boolean;

    header: IHexHeaderRow;

    // Array of items loaded so far.
    items: IHexDataRow[];

    // Callback function responsible for loading the next page of items.
    loadNextPage: () => void;
}> = ({ hasNextPage, isNextPageLoading, header, items, loadNextPage }) => {
    // If there are more items to be loaded then add an extra row to hold a loading indicator.
    const itemCount = hasNextPage ? items.length + 1 : items.length;

    // Only load 1 page of items at a time.
    // Pass an empty callback to InfiniteLoader in case it asks us to load more than once.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const loadMoreItems = isNextPageLoading ? () => {} : loadNextPage;

    // Every row is loaded except for our loading indicator row.
    const isItemLoaded = (index: number) => {
        return !hasNextPage || index < items.length;
    };

    // Render an item or a loading indicator.
    const Item = (args: any) => {
        const { index, style } = args;
        // console.log('Item request', index);
        if (!isItemLoaded(index)) {
            return <div style={style}>Loading...</div>;
        } else {
            const props = items[index];
            return (
                <HexDataRow {...props} key={props.address.toString()} style={style}></HexDataRow>
            );
        }
        /*
        } else if (index === 0) {
            return <HexHeaderRow {...header} key={'header'} style={style}></HexHeaderRow>;
        } else if (index <= items.length) {
            const props = items[index - 1];
            return (
                <HexDataRow {...props} key={props.address.toString()} style={style}></HexDataRow>
            );
        } else {
            console.log(`Invalid index ${index}. Valid range is 0..${items.length}`);
            return null;
        }
        */
    };

    const onResize = (args: any) => {
        console.log('AutoSizer.onResize', args);
    };

    const [dimensions, setDimensions] = React.useState({
        height: window.innerHeight,
        width: window.innerWidth
    });

    React.useEffect(() => {
        let to: NodeJS.Timeout | undefined = undefined;
        function handleResize() {
            if (to) {
                clearTimeout(to);
            }
            to = setTimeout(() => {
                console.log('Window resize event', window.innerHeight, window.innerWidth);
                setDimensions({
                    height: window.innerHeight,
                    width: window.innerWidth
                });
                to = undefined;
            }, 100);
        }
        window.addEventListener('resize', handleResize);
    });

    return (
        <InfiniteLoader
            isItemLoaded={isItemLoaded}
            itemCount={itemCount}
            loadMoreItems={loadMoreItems}
            threshold={15}
            minimumBatchSize={16}
        >
            {({ onItemsRendered, ref }) => (
                <FixedSizeList
                    className='List'
                    itemCount={itemCount}
                    itemSize={estimatedRowHeight}
                    onItemsRendered={onItemsRendered}
                    ref={ref}
                    layout='vertical'
                    height={window.innerHeight * 2}
                    width={'100%'}
                >
                    {Item}
                </FixedSizeList>
            )}
        </InfiniteLoader>
    );
};

export class HexTableVirtual extends React.PureComponent<IHexTable, IHexTableState> {
    private header: IHexHeaderRow = { address: 0n };
    private startAddr = 0n;
    private endAddr = 0n;
    private lastAddrLoaded = 0n;
    private eof = false;

    constructor(public props: IHexTable) {
        super(props);
        this.updatePrivates();
        const want = Math.round(window.innerHeight / estimatedRowHeight) + 20;
        const items = this.loadMoreRows(want, []);
        this.state = {
            hasNextPage: true,
            header: this.header,
            isNextPageLoading: false,
            items: items
        };
    }

    private updatePrivates() {
        this.header = { address: this.props.address };
        this.startAddr = (this.props.address / 16n) * 16n;
        this.endAddr = ((this.props.address + BigInt(this.props.numBytes + 15)) / 16n) * 16n;
    }

    private loadMoreRows(stopIndex: number, previousItems: IHexDataRow[]): IHexDataRow[] {
        console.log(
            `loadMoreRows want index = ${stopIndex}, already have ${previousItems?.length}`
        );
        if (stopIndex < previousItems.length) {
            console.log(`Returning early we already got index ${stopIndex}`);
            return previousItems;
        }
        const items = previousItems ? Array.from(previousItems) : [];
        const nItems = items.length;
        let addr = this.startAddr + BigInt(nItems * 16);
        let offset = this.props.byteStart + nItems * 16;
        for (let ix = nItems; ix <= stopIndex; ix++, offset += 16, addr = this.lastAddrLoaded) {
            if (addr >= this.endAddr || offset >= myGlobals.bytes.length) {
                break;
            }
            const tmp: IHexDataRow = {
                address: addr,
                byteOffset: offset,
                dirty: this.props.dirty,
                onChange: this.props.onChange
            };
            items.push(tmp);
            this.lastAddrLoaded = addr + 16n;
        }
        if (addr >= this.endAddr || offset >= myGlobals.bytes.length) {
            this.eof = true;
        }
        console.log(`loadMoreRows want index = ${stopIndex}, now have ${items.length}`);
        console.log(items[items.length - 1]);
        return items;
    }

    _loadNextPage = (...args: any) => {
        const [startIndex, stopIndex] = args;
        console.log('loadNextPage', JSON.stringify(args), startIndex, stopIndex);
        let topIndex = stopIndex;
        if (topIndex < this.state.items.length) {
            return;
        }
        const delta = this.state.items.length - topIndex;
        if (delta < 32) {
            topIndex += 32 - delta;
        }
        this.setState({ isNextPageLoading: true }, () => {
            setTimeout(() => {
                const items = this.loadMoreRows(topIndex, this.state.items);
                const update = {
                    hasNextPage: !this.eof && this.state.items.length < maxNumRows,
                    isNextPageLoading: false,
                    items: items
                };
                console.log('Updating state to', update);
                this.setState(update);
            }, 10);
        });
    };

    _loadNextPagex = (...args: any) => {
        console.log('loadNextPage', ...args);
        this.setState({ isNextPageLoading: true }, () => {
            setTimeout(() => {
                const items = new Array(10).fill(true).map((v, i) => {
                    // prettier-ignore
                    return ({ name: `Row ${i + this.state.items.length}`});
                });
                this.setState((state) => ({
                    hasNextPage: state.items.length < 100,
                    isNextPageLoading: false,
                    items: items as any
                    /*
                    // prettier-ignore
                    items: [...state.items].concat(
                        new Array(10).fill(true).map(() => ({ name: name.findName() }))
                    )
                    */
                }));
            }, 2500);
        });
    };

    render() {
        const { hasNextPage, isNextPageLoading, items, header } = this.state;
        return (
            <React.Fragment>
                <ExampleWrapper
                    hasNextPage={hasNextPage}
                    isNextPageLoading={isNextPageLoading}
                    header={header}
                    items={items}
                    loadNextPage={this._loadNextPage}
                />
            </React.Fragment>
        );
    }
}
