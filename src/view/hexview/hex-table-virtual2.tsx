// Originally from https://codepen.io/abidibo/pen/dwgLJo
import React from 'react';
import clsx from 'clsx';
import './example.css';
import { Table, Column, AutoSizer, InfiniteLoader, List } from 'react-virtualized';
import { faker } from '@faker-js/faker';
import 'react-virtualized/styles.css';
import {
    IHexDataRow,
    IHexHeaderRow,
    IHexTable,
    HexDataRow,
    HexHeaderRow,
    OnCellChangeFunc
} from './hex-elements';

const generateRandomItem = (idx: number) => ({
    id: idx,
    name: faker.name.fullName(),
    email: faker.internet.email()
});

interface IHexTableState {
    items: any[];
}

export class HexTableVirtual2 extends React.Component<IHexTable, IHexTableState> {
    private promiseResolve: any;
    constructor(public props: IHexTable) {
        super(props);
        this.loadMore = this.loadMore.bind(this);
        // fake data
        const items = [];
        for (let i = 0, l = 100; i < l; i++) {
            items.push(generateRandomItem(i));
        }
        this.state = {
            items: items
        };
    }

    loadMore() {
        // simulate a request
        setTimeout(() => {
            this.actuallyLoadMore();
        }, 100);
        // we need to return a promise
        return new Promise((resolve, _reject) => {
            this.promiseResolve = resolve;
        });
    }

    actuallyLoadMore() {
        // fake new data
        const newItems = [];
        const s = this.state.items.length + 1;
        for (let i = 0, l = 100; i < l; i++) {
            newItems.push(generateRandomItem(s + i));
        }
        this.setState({ items: this.state.items.concat(newItems) });
        // resolve the promise after data where fetched
        this.promiseResolve();
    }

    private showScrollingPlaceholder = false;
    renderRow(args: any) {
        console.log('renderRow: ', args);
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
        console.log('Item: ', item);
        const itemSpan = (str: string, width: number) => {
            return <span style={{ width: `${width}ch` }}>{str}</span>;
        };
        return (
            <div className={classNames} key={key} style={style}>
                {itemSpan(item.id.toString(), 10)}
                {itemSpan(item.name, 30)}
                {itemSpan(item.email, 30)}
            </div>
        );
    }
    private renderRowFunc = this.renderRow.bind(this);

    render() {
        return (
            <div className='container'>
                <InfiniteLoader
                    isRowLoaded={({ index }) => !!this.state.items[index]}
                    loadMoreRows={this.loadMore}
                    rowCount={1000000}
                >
                    {({ onRowsRendered, registerChild }) => (
                        <AutoSizer>
                            {({ width }) => (
                                <List
                                    ref={registerChild}
                                    onRowsRendered={onRowsRendered}
                                    height={window.innerHeight}
                                    width={width}
                                    overscanRowCount={30}
                                    rowCount={this.state.items.length}
                                    rowHeight={30}
                                    rowRenderer={this.renderRowFunc}
                                />
                            )}
                        </AutoSizer>
                    )}
                </InfiniteLoader>
            </div>
        );
    }
}

export class HexTableVirtual2Table extends React.Component<IHexTable, IHexTableState> {
    private promiseResolve: any;
    constructor(public props: IHexTable) {
        super(props);
        this.loadMore = this.loadMore.bind(this);
        // fake data
        const items = [];
        for (let i = 0, l = 100; i < l; i++) {
            items.push(generateRandomItem(i));
        }
        this.state = {
            items: items
        };
    }

    loadMore() {
        // simulate a request
        setTimeout(() => {
            this.actuallyLoadMore();
        }, 100);
        // we need to return a promise
        return new Promise((resolve, _reject) => {
            this.promiseResolve = resolve;
        });
    }

    actuallyLoadMore() {
        // fake new data
        const newItems = [];
        const s = this.state.items.length + 1;
        for (let i = 0, l = 100; i < l; i++) {
            newItems.push(generateRandomItem(s + i));
        }
        this.setState({ items: this.state.items.concat(newItems) });
        // resolve the promise after data where fetched
        this.promiseResolve();
    }

    render() {
        return (
            <div className='container'>
                <h1>Infinite scrolling autosize table example </h1>
                <InfiniteLoader
                    isRowLoaded={({ index }) => !!this.state.items[index]}
                    loadMoreRows={this.loadMore}
                    rowCount={1000000}
                >
                    {({ onRowsRendered, registerChild }) => (
                        <AutoSizer>
                            {({ width }) => (
                                <Table
                                    ref={registerChild}
                                    onRowsRendered={onRowsRendered}
                                    rowClassName='table-row-xxx'
                                    headerHeight={40}
                                    width={width}
                                    height={300}
                                    rowHeight={40}
                                    rowCount={this.state.items.length}
                                    rowGetter={({ index }) => this.state.items[index]}
                                >
                                    <Column label='Id' dataKey='id' width={width * 0.2} />
                                    <Column label='Name' dataKey='name' width={width * 0.4} />
                                    <Column label='E.mail' dataKey='email' width={width * 0.4} />
                                </Table>
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
