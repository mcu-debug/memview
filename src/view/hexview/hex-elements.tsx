/* eslint-disable @typescript-eslint/naming-convention */
import * as React from 'react';
import { myGlobals, frozenState } from './globals';
import * as Utils from './utils';
import { PopupHexCellEdit } from './popup-hex-cell-edit';
import {
    RecoilRoot,
    atom,
    selector,
    useRecoilState,
    useRecoilValue,
    useSetRecoilState
} from 'recoil';

type OnCellChangeFunc = (address: bigint, byteOffset: number, val: number) => void;
interface IHexCell {
    address: bigint;
    byteOffset: number;
    dirty: boolean;
    onChange?: OnCellChangeFunc;
}

export function HexCellValue(props: IHexCell): JSX.Element {
    const inRange = addrInRange(props.address, props.byteOffset);
    const val = inRange ? myGlobals.bytes[props.byteOffset] : -1;
    const origVal = inRange ? myGlobals.origBytes[props.byteOffset] : -1;
    const [frozen] = useRecoilState<boolean>(frozenState);
    const [value, setValue] = React.useState(val);

    const classNames = () => {
        return (
            'hex-cell hex-cell-value' +
            (props.dirty || frozen ? ' hex-cell-value-dirty' : '') +
            (origVal !== value ? ' hex-cell-value-changed' : '')
        );
    };

    const onValueChanged = (val: string) => {
        val = val.trim().toLowerCase();
        while (val.startsWith('0x')) {
            val = val.substring(2);
        }
        while (val.length > 1 && val.startsWith('0')) {
            val = val.substring(1);
        }
        if (val.length > 2 || val.length === 0 || /[0-9a-f]]/.test(val)) {
            return;
        }
        const intVal = parseInt(val, 16);
        if (value !== intVal) {
            setValue(intVal);
            myGlobals.bytes[props.byteOffset] = intVal;
            if (props.onChange) {
                props.onChange(props.address, props.byteOffset, intVal);
            }
        }
    };

    const handleClick = (event: any) => {
        switch (event.detail) {
            case 1: {
                break;
            }
            case 2: {
                openPopup(event);
                break;
            }
            case 3: {
                break;
            }
            default: {
                break;
            }
        }
    };

    const openPopup = (event: any) => {
        const props: IHexCellEditProps = {
            trigger: false,
            clientX: event.clientX,
            clientY: event.clientY,
            value: valueStr(),
            callback: onPopupDone
        };
        try {
            PopupHexCellEdit.open(event, props);
        } catch (e) {
            console.log(`popup exception ${e}`);
            throw e;
        }
    };

    const onPopupDone = (v: string | undefined) => {
        if (typeof v === 'string') {
            onValueChanged(v);
        }
    };

    const valueStr = () => {
        return value >= 0 ? hexValuesLookup[(value >>> 0) & 0xff] : '~~';
    };

    const editable = () => {
        return !frozen && !myGlobals.isReadonly;
    };

    /*
  return (
    <div className={classNames()}>
      <span style={{ border: "1px" }} onClick={editable() ? handleClick : undefined}>{valueStr()}</span>
    </div>
  );
  */
    return (
        <span
            tabIndex={0}
            className={classNames()}
            style={{ border: '1px' }}
            onClick={editable() ? handleClick : undefined}
        >
            {valueStr()}
        </span>
    );
}

export const HexCellAddress: React.FC<{ address: bigint }> = ({ address }) => {
    const classNames = 'hex-cell hex-cell-address';
    // const id = `hex-cell-address-${address}`;
    const valueStr = address.toString(16).padStart(16, '0').padEnd(18, ' ');
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellChar: React.FunctionComponent<{
    address: bigint;
    byteOffset: number;
}> = ({ address, byteOffset }) => {
    // const id = `hex-cell-char-${address}`
    const inRange = addrInRange(address, byteOffset);
    const val = inRange ? (myGlobals.bytes[byteOffset] >>> 0) & 0xff : -1;
    const origVal = inRange ? (myGlobals.origBytes[byteOffset] >>> 0) & 0xff : -1;
    const valueStr = val >= 0 ? charCodesLookup[val] : '~~';
    const classNames = 'hex-cell hex-cell-char' + (val !== origVal ? ' hex-cell-char-changed' : '');
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellEmpty: React.FunctionComponent<{
    length: number;
    fillChar?: string;
    cls?: string;
}> = ({ length = 1, fillChar = ' ', cls = '' }) => {
    const classNames = 'hex-cell ' + cls;
    const valueStr = fillChar.repeat(length);
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellEmptyHeader: React.FunctionComponent<{
    length?: number;
    fillChar?: string;
    cls?: string;
}> = ({ length = 1, fillChar = ' ', cls = '' }) => {
    const classNames = `hex-cell hex-cell-char-header ${cls}`;
    const valueStr = fillChar.repeat(length);
    return <span className={classNames}>{valueStr}</span>;
};

export const HexCellValueHeader: React.FunctionComponent<{
    value: number;
}> = ({ value }) => {
    const classNames = 'hex-cell hex-cell-value-header';
    // const id = `hex-cell-value-header-${value}`;
    const valueStr = hexValuesLookup[(value >>> 0) & 0xff];
    return <span className={classNames}>{valueStr}</span>;
};

interface IHexHeaderRow {
    address: bigint;
}

export function HexHeaderRow(props: IHexHeaderRow): JSX.Element {
    const classNames = 'hex-header-row';
    const ary = [];
    // let lowByte = Number(props.address % 16n);
    let lowByte = Number(BigInt.asUintN(8, props.address));
    for (let x = 0; x < 16; x++, lowByte++) {
        ary.push(lowByte & 0xff);
    }
    const decodedText = 'Decoded Bytes'.padEnd(16, ' ').split('');
    return (
        <div className={classNames}>
            <HexCellEmptyHeader
                key={1}
                length={18}
                fillChar='.'
                cls='hex-cell-address hex-cell-invisible'
            />
            {ary.map((v, i) => {
                return <HexCellValueHeader key={i + 2} value={v} />;
            })}
            <HexCellEmpty key={100} length={1} fillChar='.' cls='hex-cell-invisible' />
            {decodedText.map((v, i) => {
                return <HexCellEmptyHeader key={i + 18} fillChar={v} />;
            })}
        </div>
    );
}

interface IHexDataRow {
    address: bigint;
    byteOffset: number;
    dirty: boolean;
    onChange?: OnCellChangeFunc;
}

interface IHexDataRowState {
    counter: number;
}

export class HexDataRow extends React.Component<IHexDataRow, IHexDataRowState> {
    private onRowChangeFunc = this.rowChanged.bind(this);
    constructor(public props: IHexDataRow) {
        super(props);
        this.state = { counter: 0 };
    }

    private rowChanged(address: bigint, byteOffset: number, newVal: number) {
        this.setState({ counter: this.state.counter + 1 }); // Force an update
        if (this.props.onChange) {
            this.props.onChange(address, byteOffset, newVal);
        }
    }

    render() {
        const classNames = 'hex-data-row';
        const values = [];
        const chars = [];
        for (let ix = 0; ix < 16; ix++) {
            const addr = this.props.address + BigInt(ix);
            const offset = this.props.byteOffset + ix;
            values.push(
                <HexCellValue
                    key={ix + 2}
                    address={addr}
                    byteOffset={offset}
                    dirty={this.props.dirty}
                    onChange={this.onRowChangeFunc}
                />
            );
            chars.push(<HexCellChar address={addr} byteOffset={offset} key={ix + 18} />);
        }
        const gap = <HexCellEmpty length={1} fillChar='.' cls='hex-cell-invisible'></HexCellEmpty>;
        return (
            <div className={classNames}>
                <HexCellAddress key={1} address={this.props.address} />
                <div>
                    {values}
                    {gap}
                    {chars}
                </div>
            </div>
        );
    }
}

export interface IHexTable {
    address: bigint; // Address of first byte ie. bytes[byteOffset];
    byteStart: number;
    numBytes: number;
    dirty: boolean;
    onChange?: OnCellChangeFunc;
}

export function HexTable(props: IHexTable): JSX.Element {
    const header = <HexHeaderRow key='h' address={props.address} />;
    const rows = [];
    let offset = props.byteStart;
    const startAddr = (props.address / 16n) * 16n;
    const endAddr = ((props.address + BigInt(props.numBytes + 15)) / 16n) * 16n;
    for (let addr = startAddr; addr < endAddr; addr += 16n, offset += 16) {
        rows.push(
            <HexDataRow
                key={offset}
                address={addr}
                byteOffset={offset}
                dirty={props.dirty}
                onChange={props.onChange}
            />
        );
    }

    const timer = new Utils.Timekeeper();
    const ret = (
        <div id='hex-grid' className='hex-grid'>
            {header}
            <div className='hex-data-rows'>{rows}</div>
            <PopupHexCellEdit {...PopupHexCellEdit.globalProps}></PopupHexCellEdit>
        </div>
    );
    console.log(`Top-level:render ${timer.deltaMs()}ms`);
    return ret;
}

export interface IHexCellEditProps {
    trigger: boolean;
    clientX: number;
    clientY: number;
    value: string;
    callback: (value: string | undefined) => void;
}
export interface IHexCellEditState {
    isOpen: boolean;
    value: string;
}

const odStyleChars = [
    'nul',
    'soh',
    'stx',
    'etx',
    'eot',
    'enq',
    'ack',
    'bel',
    'bs',
    'ht',
    'nl',
    'vt',
    'ff',
    'cr',
    'so',
    'si',
    'dle',
    'dc1',
    'dc2',
    'dc3',
    'dc4',
    'nak',
    'syn',
    'etb',
    'can',
    'em',
    'sub',
    'esc',
    'fs',
    'gs',
    'rs',
    'us',
    'sp'
];

const charCodesLookup: string[] = [];
const hexValuesLookup: string[] = [];
for (let byte = 0; byte <= 255; byte++) {
    const v =
        byte <= 32
            ? odStyleChars[byte]
            : byte === 127
            ? 'del'
            : byte > 127 && byte <= 159
            ? '.'
            : String.fromCharCode(byte);
    charCodesLookup.push(v);
    hexValuesLookup.push(byte.toString(16).padStart(2, '0'));
}

function addrInRange(addr: bigint, byteOffset: number): boolean {
    // TODO: handle unsigned bigint case. Not sure if the high bit is set
    if (byteOffset >= myGlobals.bytes?.length) {
        return false;
    }
    if (addr < myGlobals.minAddress) {
        return false;
    }
    if (myGlobals.maxAddress !== undefined && addr > myGlobals.maxAddress) {
        return false;
    }
    return true;
}

/*
function bigIntMax(a: bigint, b: bigint) {
  return a > b ? a : b;
}
function bigIntMin(a: bigint, b: bigint) {
  return a < b ? a : b;
}
*/
